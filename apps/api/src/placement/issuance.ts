import { createHash } from "node:crypto";
import {
  type ApplyPreview,
  type ApplyPreviewRequest,
  type IssuanceAction,
  type IssuanceRequestPayload,
  type IssuanceResponse,
  type IssuanceStage,
  type PlacementResponse,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPermission } from "../context.js";
import { HttpError } from "../errors.js";
import { pgMoney } from "../numeric.js";
import { emitEvent } from "../events/emit.js";
import { ISSUED_CLASS_WORDS, checkIssuedPolicy, type IssuedCheckItem, type IssuedEvidence as CheckEvidence } from "./issued-check.js";
import { actor, load, names, toPreparedView, type Ctx, type Env, type Outcome } from "./service.js";

/**
 * Policy issuance (4B-5): a placement ready for issuance, to a verified policy and period.
 *
 *   ready → request prepared (frozen, digested) → approved (that digest) → submitted (evidence)
 *   → the insurer's policy document received → its reading reviewed by a person → checked against
 *   the accepted instruction, the frozen basis and the cover confirmation → differences resolved
 *   → a person applies it: one policy and period, created or a named one updated, exactly once.
 *
 * Every step is a validated server action. The screen, a confirmed prepared action and Ask all run
 * the same function, and nothing here changes what the placement says about cover.
 */

const SENDING = "Sending from ASAP is not connected yet. Send the approved request yourself, then record how, to whom and when.";
const ISSUED_KEYS = ["insured_name", "insurer_name", "policy_number", "class_of_business", "period_start", "period_end", "currency", "premium", "premium_basis", "sum_insured"] as const;

const done = (outcome: "done" | "already" = "done", receipt: string | null = null) => ({ outcome, reason: null, receipt });
const blocked = (reason: string) => ({ outcome: "blocked" as const, reason, receipt: null });
export type IssuanceOutcome = Outcome & { receipt: string | null };

const day = (iso: string | null) =>
  iso === null ? null : new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
/** jsonb reorders keys, so a stored value is compared in one canonical form. */
const canonical = (v: unknown): string =>
  v === null || typeof v !== "object"
    ? JSON.stringify(v ?? null)
    : Array.isArray(v)
      ? `[${v.map(canonical).join(",")}]`
      : `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
const sha = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex");

/* =============================================================================================
 * Where issuance has got to — derived from which records exist, never stored.
 * ============================================================================================= */

type Row = Record<string, unknown>;

type Facts = {
  request: Row | null;
  history: Row[];
  approval: Row | null;
  approvals: Row[];
  submission: Row | null;
  documents: Row[];
  check: Row | null;
  items: Row[];
  resolutions: Row[];
  application: Row | null;
};

async function factsOf(db: SupabaseClient, org: string, placementId: string): Promise<Facts> {
  const [reqQ, docQ, checkQ, appQ] = await Promise.all([
    db.from("issuance_requests").select("*").eq("organization_id", org).eq("placement_id", placementId).order("version", { ascending: false }),
    db.from("issued_policy_documents").select("*").eq("organization_id", org).eq("placement_id", placementId).order("received_at", { ascending: false }),
    db.from("issued_policy_checks").select("*").eq("organization_id", org).eq("placement_id", placementId).order("compared_at", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
    db.from("policy_issuance_applications").select("*").eq("organization_id", org).eq("placement_id", placementId).maybeSingle(),
  ]);
  const history = (reqQ.data ?? []) as Row[];
  const request = history.find((r) => r["superseded_at"] === null) ?? null;
  const ids = history.map((r) => r["id"] as string);
  const [apprQ, subQ] = await Promise.all([
    ids.length === 0 ? Promise.resolve({ data: [] }) : db.from("issuance_request_approvals").select("*").eq("organization_id", org).in("issuance_request_id", ids),
    ids.length === 0 ? Promise.resolve({ data: [] }) : db.from("issuance_submissions").select("*").eq("organization_id", org).in("issuance_request_id", ids),
  ]);
  const approvals = (apprQ.data ?? []) as Row[];
  const submissions = (subQ.data ?? []) as Row[];
  const check = (checkQ.data as Row | null) ?? null;
  const [itemsQ, resQ] = await Promise.all([
    check === null ? Promise.resolve({ data: [] }) : db.from("issued_policy_check_items").select("*").eq("organization_id", org).eq("issued_policy_check_id", check["id"] as string).order("position", { ascending: true }),
    db.from("issued_policy_resolutions").select("*").eq("organization_id", org).eq("placement_id", placementId),
  ]);
  return {
    request,
    history,
    approvals,
    approval: request === null ? null : (approvals.find((a) => a["issuance_request_id"] === request["id"] && a["superseded_at"] === null) ?? null),
    submission: request === null ? null : (submissions.find((s) => s["issuance_request_id"] === request["id"]) ?? null),
    documents: (docQ.data ?? []) as Row[],
    check,
    items: (itemsQ.data ?? []) as Row[],
    resolutions: (resQ.data ?? []) as Row[],
    application: (appQ.data as Row | null) ?? null,
  };
}

/** The reviewed reading of an issued document: what a person decided each value is. */
type Reading = {
  fields: Row[];
  terms: Row[];
  complete: boolean;
  digest: string;
};

async function readingOf(db: SupabaseClient, org: string, documentId: string): Promise<Reading> {
  const [fQ, tQ] = await Promise.all([
    db.from("document_fields").select("*").eq("organization_id", org).eq("document_id", documentId),
    db.from("document_term_proposals").select("*").eq("organization_id", org).eq("document_id", documentId).order("ordinal", { ascending: true }),
  ]);
  const fields = ((fQ.data ?? []) as Row[]).filter((f) => (ISSUED_KEYS as readonly string[]).includes(f["field_key"] as string));
  const terms = (tQ.data ?? []) as Row[];
  const complete = fields.length > 0 && fields.every((f) => f["state"] !== "proposed") && terms.every((t) => t["state"] !== "proposed");
  const digest = sha({
    f: fields.map((f) => [f["id"], f["state"], f["corrected_value"] ?? f["proposed_value"]]).sort(),
    t: terms.map((t) => [t["id"], t["state"], t["corrected_value"] ?? t["proposed_value"]]).sort(),
  });
  return { fields, terms, complete, digest };
}

const valueOf = (r: Row): string | null =>
  r["state"] === "rejected" ? null : (((r["corrected_value"] as string | null) ?? (r["proposed_value"] as string | null)) ?? null);

function evidenceOf(documentId: string, r: Row, kind: "field" | "term"): IssuanceResponse["documents"][number]["fields"][number]["evidence"] {
  const page = (r["page_number"] as number | null) ?? null;
  if (page === null) return null;
  const x = r["region_x"];
  const region = x === null || x === undefined ? null : {
    x: Number(r["region_x"]), y: Number(r["region_y"]), width: Number(r["region_width"]), height: Number(r["region_height"]),
  };
  return { documentId, page, region, path: `/documents/${documentId}?page=${page}&${kind}=${r["id"] as string}` };
}

/** Is the latest check still about the facts as they stand? */
function checkCurrency(view: PlacementResponse, facts: Facts, reading: Reading | null, latestDocId: string | null): { current: boolean; reason: string | null } {
  const c = facts.check;
  if (c === null) return { current: false, reason: null };
  if (latestDocId === null || c["issued_policy_document_id"] !== latestDocId) return { current: false, reason: "A later policy document has been received." };
  if (c["client_instruction_id"] !== view.instruction.id) return { current: false, reason: "The client's instruction has changed since this check." };
  if (c["placement_insurer_response_id"] !== view.insurerResponse?.id) return { current: false, reason: "The insurer's cover confirmation has changed since this check." };
  if (reading !== null && c["review_sha256"] !== reading.digest) return { current: false, reason: "The reading of the policy document was reviewed again since this check." };
  return { current: true, reason: null };
}

export function stageOf(view: PlacementResponse, facts: Facts, currentCheck: boolean, reviewComplete: boolean): IssuanceStage {
  if (facts.application !== null) return "applied";
  if (facts.request === null) return view.readiness.state === "ready" ? "ready" : "not_ready";
  if (facts.approval === null) return "approval_required";
  if (facts.submission === null) return "submission_required";
  if (facts.documents.length === 0) return "with_insurer";
  if (!reviewComplete || !currentCheck) return "review_required";
  const unresolved = unresolvedCount(facts);
  return unresolved > 0 ? "differences_to_resolve" : "ready_to_apply";
}

function unresolvedCount(facts: Facts): number {
  return facts.items.filter((i) => i["material"] === true && !facts.resolutions.some((r) => r["issued_policy_check_item_id"] === i["id"])).length;
}

/** The small summary the placement carries, so its Work follows issuance. */
export async function issuanceSummary(db: SupabaseClient, org: string, view: PlacementResponse): Promise<PlacementResponse["issuance"]> {
  const facts = await factsOf(db, org, view.placement.id);
  if (facts.request === null && facts.application === null && view.readiness.state !== "ready") return null;
  const latest = facts.documents[0] ?? null;
  const reading = latest === null ? null : await readingOf(db, org, latest["document_id"] as string);
  const currency = checkCurrency(view, facts, reading, latest === null ? null : (latest["id"] as string));
  const stage = stageOf(view, facts, currency.current, reading?.complete ?? false);
  return {
    stage,
    since: stage === "with_insurer" ? ((facts.submission?.["sent_at"] as string | undefined) ?? null) : null,
    applicationId: (facts.application?.["id"] as string | undefined) ?? null,
    policyId: (facts.application?.["policy_id"] as string | undefined) ?? null,
  };
}

/* =============================================================================================
 * The frozen request.
 * ============================================================================================= */

/** Everything the request rests on. If any moves after approval, the approval no longer applies. */
function sourceVersionsOf(view: PlacementResponse): Record<string, unknown> {
  return {
    instruction: view.instruction.id,
    basisVersion: view.basis.version,
    coverConfirmation: view.insurerResponse?.id ?? null,
    coverMatch: view.coverMatch?.id ?? null,
    conditions: view.conditions.map((c) => `${c.id}:${c.state}`),
  };
}

async function payloadOf(db: SupabaseClient, org: string, view: PlacementResponse, input: { requestedPolicyNumber?: string | undefined; requiredDocuments: string[]; subject?: string | undefined; body?: string | undefined }): Promise<IssuanceRequestPayload> {
  const instr = (await db.from("client_instructions").select("insurer_response_id, response_revision_id").eq("organization_id", org).eq("id", view.instruction.id).maybeSingle()).data as Row | null;
  const b = view.basis;
  const ir = view.insurerResponse!;
  const end = b.expiryAt ?? b.derivedExpiryAt;
  const endBasis = b.expiryAt !== null ? "The end date the client accepted." : b.derivation ?? "No end date was accepted; the insurer's confirmed end date was accepted by the client.";
  const premium = b.premiumAmount === null ? "as confirmed" : `${b.premiumCurrency ?? ""} ${Number(b.premiumAmount).toLocaleString("en-KE")}`.trim();
  const required = input.requiredDocuments.length > 0 ? input.requiredDocuments : ["Policy schedule"];
  return {
    clientName: view.client.name,
    insurerName: view.insurer.name,
    classOfBusiness: b.classOfBusiness ?? view.opportunity.classOfBusiness,
    placementId: view.placement.id,
    clientInstructionId: view.instruction.id,
    basisVersion: b.version,
    quoteResponseId: (instr?.["insurer_response_id"] as string) ?? view.opportunity.id,
    quoteRevisionId: (instr?.["response_revision_id"] as string | null) ?? null,
    comparisonVersion: view.instruction.comparisonVersion,
    coverConfirmationId: ir.id,
    coverConfirmationReference: ir.insurerReference,
    requestedPolicyNumber: input.requestedPolicyNumber ?? null,
    inception: b.effectiveAt,
    end,
    endBasis,
    premiumAmount: b.premiumAmount,
    premiumCurrency: b.premiumCurrency,
    premiumBasis: b.premiumBasis,
    terms: b.terms.map((t) => ({ termType: t.termType, label: t.label, value: t.value })),
    conditions: view.conditions.map((c) => ({ text: c.text, state: c.state })),
    requiredDocuments: required,
    subject: input.subject ?? `Policy issuance — ${view.client.name} — ${b.classOfBusiness ?? view.opportunity.classOfBusiness}`,
    body:
      input.body ??
      [
        "Dear Underwriter,",
        "",
        `Further to your cover confirmation${ir.insurerReference ? ` ${ir.insurerReference}` : ""}, please issue the policy for ${view.client.name}.`,
        `Cover from ${day(b.effectiveAt) ?? "the confirmed date"}${end ? ` to ${day(end)}` : ""}. Premium: ${premium}.`,
        `Please send: ${required.join(", ")}.`,
        "",
        "Kind regards",
      ].join("\n"),
    evidence: [
      `Client instruction ${view.instruction.id}`,
      `Accepted basis version ${b.version}`,
      `Cover confirmation ${ir.id}${ir.insurerReference ? ` (${ir.insurerReference})` : ""}`,
    ],
    sourceVersions: sourceVersionsOf(view),
  };
}

/* =============================================================================================
 * Reading issuance.
 * ============================================================================================= */

export async function loadIssuance(env: Env, placementId: string, opts: { readOnly?: boolean } = {}): Promise<IssuanceResponse> {
  const { db, ctx } = env;
  const org = env.organizationId;
  let view = await load(db, ctx, org, placementId, opts.readOnly === true ? { readOnly: true } : {});
  let facts = await factsOf(db, org, placementId);

  /*
   * A request rests on the placement as it was. If anything it rests on moved before it was
   * submitted, the request — and any approval of it — is superseded, kept, and prepared again.
   * Never updated in place.
   */
  if (opts.readOnly !== true && facts.request !== null && facts.submission === null) {
    const frozen = (facts.request["payload"] as IssuanceRequestPayload).sourceVersions;
    if (canonical(frozen) !== canonical(sourceVersionsOf(view))) {
      const reason = "What the request rested on changed: the client's instruction, the accepted basis, the cover confirmation, the cover check or a condition.";
      await db.from("issuance_requests").update({ superseded_at: new Date().toISOString(), superseded_reason: reason })
        .eq("organization_id", org).eq("id", facts.request["id"] as string).is("superseded_at", null);
      await env.audit({
        action: facts.approval === null ? "issuance.request_superseded" : "issuance.approval_superseded",
        objectType: "placement", objectId: placementId, result: "success",
        newState: { issuanceRequestId: facts.request["id"], version: facts.request["version"], reason },
      });
      view = await load(db, ctx, org, placementId, { sync: true });
      facts = await factsOf(db, org, placementId);
    }
  }

  const latest = facts.documents[0] ?? null;
  const readings = new Map<string, Reading>();
  for (const d of facts.documents) readings.set(d["document_id"] as string, await readingOf(db, org, d["document_id"] as string));
  const reading = latest === null ? null : readings.get(latest["document_id"] as string)!;
  const currency = checkCurrency(view, facts, reading, latest === null ? null : (latest["id"] as string));
  const stage = stageOf(view, facts, currency.current, reading?.complete ?? false);

  const docIds = facts.documents.map((d) => d["document_id"] as string);
  const docs = docIds.length === 0 ? [] : (((await db.from("documents").select("id, filename, extraction_state").eq("organization_id", org).in("id", docIds)).data ?? []) as Row[]);
  const people = await names(db, [
    ...facts.history.map((r) => r["prepared_by"] as string),
    ...facts.approvals.map((a) => a["approved_by"] as string),
    facts.submission?.["recorded_by"] as string,
    facts.check?.["compared_by"] as string,
    ...facts.resolutions.map((r) => r["recorded_by"] as string),
    facts.application?.["applied_by"] as string,
  ]);

  const evidenceForItem = (it: Row): IssuanceResponse["documents"][number]["fields"][number]["evidence"] => {
    const docId = latest?.["document_id"] as string | undefined;
    if (docId === undefined || !reading) return null;
    const src = it["document_field_id"] !== null
      ? reading.fields.find((f) => f["id"] === it["document_field_id"])
      : reading.terms.find((t) => t["id"] === it["document_term_proposal_id"]);
    return src === undefined ? null : evidenceOf(docId, src, it["document_field_id"] !== null ? "field" : "term");
  };

  let application: IssuanceResponse["application"] = null;
  if (facts.application !== null) {
    const a = facts.application;
    const pol = (await db.from("policies").select("policy_number").eq("organization_id", org).eq("id", a["policy_id"] as string).maybeSingle()).data as Row | null;
    const per = (await db.from("policy_periods").select("period_start, period_end").eq("organization_id", org).eq("id", a["policy_period_id"] as string).maybeSingle()).data as Row | null;
    application = {
      id: a["id"] as string,
      targetMode: a["target_mode"] as "create" | "update",
      policyId: a["policy_id"] as string,
      policyPeriodId: a["policy_period_id"] as string,
      policyNumber: (pol?.["policy_number"] as string | null) ?? null,
      periodStart: (per?.["period_start"] as string) ?? "",
      periodEnd: (per?.["period_end"] as string) ?? "",
      appliedAt: a["applied_at"] as string,
      appliedByName: people.get(a["applied_by"] as string) ?? null,
      changes: (a["changes"] as Record<string, unknown>[]) ?? [],
      links: {
        placementId, clientInstructionId: a["client_instruction_id"] as string, basisVersionId: a["basis_version_id"] as string,
        insurerResponseId: a["insurer_response_id"] as string, coverConfirmationId: a["placement_insurer_response_id"] as string,
        documentId: a["document_id"] as string, issuedPolicyCheckId: a["issued_policy_check_id"] as string, issuanceRequestId: a["issuance_request_id"] as string,
      },
    };
  }

  const candidatesQ = await db.from("policies").select("id, policy_number, insurer_id, policy_periods ( id, period_start, period_end )").eq("organization_id", org).eq("client_id", view.client.id).is("deleted_at", null);
  const insurerNames = new Map<string, string>();
  const candRows = (candidatesQ.data ?? []) as unknown as { id: string; policy_number: string | null; insurer_id: string; policy_periods: { id: string; period_start: string; period_end: string }[] | null }[];
  for (const iid of new Set(candRows.map((c) => c.insurer_id))) {
    const n = (await db.from("insurers").select("name").eq("organization_id", org).eq("id", iid).maybeSingle()).data as Row | null;
    insurerNames.set(iid, (n?.["name"] as string) ?? "An insurer");
  }
  const candidates = candRows.flatMap((c) => (c.policy_periods ?? []).map((p) => ({
    policyId: c.id, periodId: p.id, policyNumber: c.policy_number, periodStart: p.period_start, periodEnd: p.period_end, insurerName: insurerNames.get(c.insurer_id) ?? "An insurer",
  })));

  const optionsQ = await db.from("documents").select("id, filename, kind, created_at").eq("organization_id", org).eq("client_id", view.client.id).is("deleted_at", null).order("created_at", { ascending: false }).limit(30);
  const documentOptions = ((optionsQ.data ?? []) as Row[])
    .filter((o) => !facts.documents.some((x) => x["document_id"] === o["id"]))
    .map((o) => ({ id: o["id"] as string, filename: o["filename"] as string, kind: (o["kind"] as string) ?? "other", createdAt: (o["created_at"] as string) ?? "" }));

  const issuanceWork = view.work.filter((w) => ISSUANCE_REASONS.includes(w.reason));
  const unresolved = unresolvedCount(facts);
  const r = facts.request;
  const response: IssuanceResponse = {
    placement: { id: view.placement.id, title: view.placement.title },
    client: view.client,
    insurer: view.insurer,
    stage,
    cover: view.cover,
    readiness: { state: view.readiness.state, reasons: view.readiness.reasons },
    request: r === null ? null : {
      id: r["id"] as string,
      version: r["version"] as number,
      sha256: r["sha256"] as string,
      payload: r["payload"] as IssuanceRequestPayload,
      preparedAt: r["prepared_at"] as string,
      preparedByName: r["prepared_by"] ? (people.get(r["prepared_by"] as string) ?? null) : r["prepared_by_run_id"] ? "ASAP, from the issuance work" : null,
      approval: facts.approval === null ? null : { approvedByName: people.get(facts.approval["approved_by"] as string) ?? null, approvedAt: facts.approval["approved_at"] as string },
      submission: facts.submission === null ? null : {
        method: facts.submission["method"] as string,
        recipient: facts.submission["recipient"] as string,
        sentAt: facts.submission["sent_at"] as string,
        providerMessageId: (facts.submission["provider_message_id"] as string | null) ?? null,
        evidence: facts.submission["evidence_document_id"] !== null
          ? { kind: "document", id: facts.submission["evidence_document_id"] as string, label: "The attached evidence", path: `/documents/${facts.submission["evidence_document_id"] as string}` }
          : { kind: "note", id: null, label: (facts.submission["evidence_note"] as string) ?? "Recorded by a person.", path: null },
        recordedByName: people.get(facts.submission["recorded_by"] as string) ?? null,
      },
    },
    requestHistory: facts.history.filter((h) => h["id"] !== r?.["id"]).map((h) => ({
      version: h["version"] as number,
      preparedAt: h["prepared_at"] as string,
      approvedAt: (facts.approvals.find((a) => a["issuance_request_id"] === h["id"])?.["approved_at"] as string | undefined) ?? null,
      supersededAt: (h["superseded_at"] as string | null) ?? null,
      supersededReason: (h["superseded_reason"] as string | null) ?? null,
    })),
    documents: facts.documents.map((d) => {
      const docId = d["document_id"] as string;
      const rd = readings.get(docId)!;
      const meta = docs.find((x) => x["id"] === docId);
      return {
        id: d["id"] as string,
        documentId: docId,
        filename: (meta?.["filename"] as string) ?? "Policy document",
        receivedAt: d["received_at"] as string,
        extractionState: (meta?.["extraction_state"] as string) ?? "not_started",
        fields: rd.fields.map((f) => ({
          id: f["id"] as string, key: f["field_key"] as string, proposedValue: (f["proposed_value"] as string | null) ?? null,
          correctedValue: (f["corrected_value"] as string | null) ?? null, state: f["state"] as string, condition: f["condition"] as string,
          evidence: evidenceOf(docId, f, "field"),
        })),
        terms: rd.terms.map((t) => ({
          id: t["id"] as string, termType: t["term_type"] as string, label: t["label"] as string, proposedValue: (t["proposed_value"] as string | null) ?? null,
          correctedValue: (t["corrected_value"] as string | null) ?? null, state: t["state"] as string, reviewedFor: t["reviewed_for"] as string,
          evidence: evidenceOf(docId, t, "term"),
        })),
        reviewComplete: rd.complete,
      };
    }),
    check: facts.check === null ? null : {
      id: facts.check["id"] as string,
      current: currency.current,
      staleReason: currency.reason,
      comparedAt: facts.check["compared_at"] as string,
      comparedByName: facts.check["compared_by"] === null ? (facts.check["compared_by_run_id"] ? "ASAP, from the issuance work" : null) : (people.get(facts.check["compared_by"] as string) ?? null),
      materialDifferences: facts.check["material_differences"] as number,
      unresolved,
      items: facts.items.map((it) => {
        const res = facts.resolutions.find((x) => x["issued_policy_check_item_id"] === it["id"]);
        return {
          id: it["id"] as string,
          field: it["field"] as string,
          termType: (it["term_type"] as string | null) ?? null,
          label: it["label"] as string,
          instructionValue: (it["instruction_value"] as string | null) ?? null,
          basisValue: (it["basis_value"] as string | null) ?? null,
          confirmationValue: (it["confirmation_value"] as string | null) ?? null,
          issuedValue: (it["issued_value"] as string | null) ?? null,
          classification: it["classification"] as IssuedCheckItem["classification"],
          classificationWords: ISSUED_CLASS_WORDS[it["classification"] as IssuedCheckItem["classification"]],
          material: Boolean(it["material"]),
          calculation: (it["calculation"] as string | null) ?? null,
          evidence: evidenceForItem(it),
          resolution: res === undefined ? null : {
            resolution: res["resolution"] as string,
            reason: res["reason"] as string,
            evidence: res["evidence_document_id"] !== null
              ? { kind: "document", id: res["evidence_document_id"] as string, label: "The attached evidence", path: `/documents/${res["evidence_document_id"] as string}` }
              : res["evidence_email_message_id"] !== null
                ? { kind: "email", id: res["evidence_email_message_id"] as string, label: "The linked email", path: null }
                : { kind: "note", id: null, label: (res["evidence_note"] as string) ?? "", path: null },
            resolvedByName: people.get(res["recorded_by"] as string) ?? null,
            resolvedAt: res["resolved_at"] as string,
          },
        };
      }),
    },
    application,
    candidates,
    documentOptions,
    work: issuanceWork,
    blockers: [],
    nextAction: "",
    permissions: {
      canPrepare: hasPermission(ctx, "placement", "edit"),
      canApprove: hasPermission(ctx, "placement", "approve"),
      canSubmit: hasPermission(ctx, "placement", "send_external"),
      canApply: hasPermission(ctx, "placement", "approve"),
    },
    sending: { available: false, reason: SENDING },
    preparedActions: view.preparedActions.filter((a) => ISSUANCE_ACTIONS.includes(a.actionType)),
  };
  response.blockers = blockersOf(response);
  response.nextAction = NEXT[stage];
  return response;
}

export const ISSUANCE_REASONS = [
  "issue_policy", "approve_issuance_request", "submit_issuance_request", "obtain_issued_policy",
  "review_issued_policy", "resolve_issued_policy_differences", "apply_issued_policy",
];
const ISSUANCE_ACTIONS = ["prepare_issuance_request", "approve_issuance_request", "record_issuance_submission", "resolve_issued_policy_difference", "apply_issued_policy"];

const NEXT: Record<IssuanceStage, string> = {
  not_ready: "Resolve what blocks issuance on the placement first.",
  ready: "Prepare the issuance request.",
  approval_required: "Approve the current version of the issuance request.",
  submission_required: "Send the approved request yourself, then record how it was sent.",
  with_insurer: "Record the insurer's policy document when it arrives.",
  review_required: "Review what was read from the policy document, then check it against what was agreed.",
  differences_to_resolve: "Resolve each difference with a reason and evidence.",
  ready_to_apply: "Preview, then apply the issued policy to the policy record.",
  applied: "Nothing further: the policy record was written from the issued policy.",
};

function blockersOf(v: IssuanceResponse): string[] {
  const out: string[] = [];
  if (v.stage === "not_ready") out.push(...v.readiness.reasons.map((r) => r.message));
  if (v.stage === "review_required") {
    const doc = v.documents[0];
    if (doc && !doc.reviewComplete) out.push("Some values read from the policy document have not been reviewed.");
    if (v.check && !v.check.current) out.push(`The check is out of date: ${v.check.staleReason ?? "an input moved."}`);
    if (doc?.reviewComplete && v.check === null) out.push("The policy document has been reviewed but not yet checked against what was agreed.");
  }
  if (v.stage === "differences_to_resolve" && v.check) {
    const open = v.check.items.filter((i) => i.material && i.resolution === null);
    out.push(`The issued policy differs from what was agreed: ${open.map((i) => i.label).join(", ")}. Each needs a decision with evidence before the policy record can be written.${v.cover.state === "active" ? " Cover remains in force meanwhile." : ""}`.slice(0, 600));
  }
  return out;
}

/* =============================================================================================
 * Acting.
 * ============================================================================================= */

async function executeIssuanceActionInner(env: Env, placementId: string, input: IssuanceAction): Promise<IssuanceOutcome> {
  const { db, ctx } = env;
  const org = env.organizationId;
  const current = await loadIssuance(env, placementId);
  const view = await load(db, ctx, org, placementId);
  const facts = await factsOf(db, org, placementId);
  const now = new Date().toISOString();
  const sync = async () => {
    await load(db, ctx, org, placementId, { sync: true });
  };

  switch (input.action) {
    case "prepare_issuance_request": {
      if (!hasPermission(ctx, "placement", "edit")) return blocked("You may not prepare an issuance request.");
      if (facts.application !== null) return blocked("The policy has already been applied from this placement.");
      if (view.readiness.state !== "ready") return blocked(`The placement is not ready for issuance: ${view.readiness.reasons.map((r) => r.message).join(" ")}`);
      if (facts.submission !== null) return blocked("This request was already submitted. A changed request is a new conversation with the insurer.");
      const payload = await payloadOf(db, org, view, input);
      if (facts.request !== null && canonical(facts.request["payload"]) === canonical(payload)) return done("already");
      const inserted = await db.from("issuance_requests").insert({
        organization_id: org, placement_id: placementId, version: 1, payload, sha256: "0".repeat(64), ...actor(env, "prepared_by"),
      }).select("id, version, sha256").maybeSingle();
      if (inserted.error || !inserted.data) return blocked("The issuance request could not be prepared. Try again.");
      const row = inserted.data as Row;
      await env.audit({
        action: "issuance.request_prepared", objectType: "placement", objectId: placementId, result: "success",
        newState: { issuanceRequestId: row["id"], version: row["version"], sha256: row["sha256"], supersededApproval: facts.approval !== null },
      });
      if (facts.approval !== null) {
        await env.audit({ action: "issuance.approval_superseded", objectType: "placement", objectId: placementId, result: "success", newState: { issuanceRequestId: facts.request?.["id"], reason: "A new version of the issuance request was prepared." } });
      }
      await sync();
      return done("done", `Issuance request version ${row["version"] as number} prepared. It has not been sent.`);
    }

    case "approve_issuance_request": {
      if (!hasPermission(ctx, "placement", "approve")) return blocked("You may not approve an issuance request.");
      if (facts.request === null || facts.request["id"] !== input.issuanceRequestId) return blocked("That is not the current version of the issuance request.");
      if (facts.approval !== null) return done("already");
      const ins = await db.from("issuance_request_approvals").insert({
        organization_id: org, issuance_request_id: input.issuanceRequestId, sha256: facts.request["sha256"], approved_by: env.userId,
      });
      if (ins.error) return blocked("That version could not be approved. It may have changed — look at it again.");
      await env.audit({ action: "issuance.request_approved", objectType: "placement", objectId: placementId, result: "success", newState: { issuanceRequestId: input.issuanceRequestId, version: facts.request["version"], sha256: facts.request["sha256"] } });
      await sync();
      return done("done", `Version ${facts.request["version"] as number} approved. It has not been sent.`);
    }

    case "record_issuance_submission": {
      if (!hasPermission(ctx, "placement", "send_external")) return blocked("You may not record that an issuance request was sent.");
      const prior = await db.from("issuance_submissions").select("id").eq("organization_id", org).eq("idempotency_key", input.idempotencyKey).maybeSingle();
      if (prior.data) return done("already");
      if (facts.request === null || facts.request["id"] !== input.issuanceRequestId) return blocked("That is not the current version of the issuance request.");
      if (facts.approval === null) return blocked("This request has not been approved. A draft is not sent, and cannot be recorded as sent.");
      if (facts.submission !== null) return done("already");
      if (input.evidenceDocumentId === undefined && (input.evidenceNote ?? "").trim().length < 10) {
        return blocked("Say how you know it was sent: attach the sent message, or write down when, from where and to whom.");
      }
      const ins = await db.from("issuance_submissions").insert({
        organization_id: org, issuance_request_id: input.issuanceRequestId, sha256: facts.request["sha256"], method: input.method,
        recipient: input.recipient, sent_at: input.sentAt, evidence_document_id: input.evidenceDocumentId ?? null,
        evidence_note: input.evidenceNote ?? null, recorded_by: env.userId, idempotency_key: input.idempotencyKey,
      });
      if (ins.error) return blocked("The submission could not be recorded. The approval may no longer be current.");
      await env.audit({ action: "issuance.submission_recorded", objectType: "placement", objectId: placementId, result: "success", newState: { issuanceRequestId: input.issuanceRequestId, method: input.method, sentAt: input.sentAt } });
      await sync();
      return done("done", `Recorded as sent to ${input.recipient} on ${day(input.sentAt)}, by you, outside ASAP.`);
    }

    case "record_issued_policy_document": {
      if (!hasPermission(ctx, "placement", "edit")) return blocked("You may not record the insurer's policy document.");
      if (facts.submission === null) return blocked("No issuance request has been recorded as sent, so there is nothing for this document to answer.");
      if (facts.application !== null) return blocked("The policy has already been applied. A later document is an endorsement.");
      const doc = (await db.from("documents").select("id, deleted_at").eq("organization_id", org).eq("id", input.documentId).maybeSingle()).data as Row | null;
      if (doc === null || doc["deleted_at"] !== null) return blocked("That document is not in this brokerage's files.");
      if (facts.documents.some((d) => d["document_id"] === input.documentId)) return done("already");
      const ins = await db.from("issued_policy_documents").insert({
        organization_id: org, placement_id: placementId, document_id: input.documentId, issuance_request_id: facts.request?.["id"] ?? null,
        received_at: input.receivedAt, ...actor(env, "recorded_by"), note: input.note ?? null,
      });
      if (ins.error) return done("already");
      await env.audit({ action: "issuance.policy_document_received", objectType: "placement", objectId: placementId, result: "success", newState: { documentId: input.documentId, receivedAt: input.receivedAt } });
      await sync();
      return done("done", "The insurer's policy document is recorded. Review what was read from it.");
    }

    case "review_issued_field": {
      if (!hasPermission(ctx, "document", "edit") && !hasPermission(ctx, "placement", "edit")) return blocked("You may not review what was read from a document.");
      const f = (await db.from("document_fields").select("*").eq("organization_id", org).eq("id", input.documentFieldId).maybeSingle()).data as Row | null;
      if (f === null || !facts.documents.some((d) => d["document_id"] === f["document_id"])) return blocked("That value is not on this placement's policy document.");
      if (input.decision === "correct" && !input.correctedValue) return blocked("A correction needs the corrected value.");
      const repeat = (input.decision === "accept" && f["state"] === "accepted") || (input.decision === "reject" && f["state"] === "rejected")
        || (input.decision === "correct" && f["state"] === "corrected" && f["corrected_value"] === input.correctedValue);
      if (repeat) return done("already");
      const patch = input.decision === "correct" ? { state: "corrected", corrected_value: input.correctedValue, condition: "known" }
        : input.decision === "accept" ? { state: "accepted", condition: "known" } : { state: "rejected", condition: "missing" };
      await db.from("document_fields").update({ ...patch, reviewed_by: env.userId, reviewed_at: now }).eq("organization_id", org).eq("id", input.documentFieldId);
      await env.audit({
        action: `document.field_${input.decision}ed`, objectType: "document_field", objectId: input.documentFieldId, result: "success",
        previousState: { state: f["state"], field: f["field_key"] }, newState: { state: patch.state, field: f["field_key"] },
      });
      await sync();
      return done();
    }

    case "review_issued_term": {
      if (!hasPermission(ctx, "placement", "edit")) return blocked("You may not review what was read from a document.");
      const t = (await db.from("document_term_proposals").select("*").eq("organization_id", org).eq("id", input.proposalId).maybeSingle()).data as Row | null;
      if (t === null || !facts.documents.some((d) => d["document_id"] === t["document_id"])) return blocked("That term is not on this placement's policy document.");
      if (t["reviewed_for"] === "quotation" && t["state"] !== "proposed") return blocked("That term was already decided as part of a quotation.");
      if (input.decision === "correct" && !input.correctedValue) return blocked("A correction needs the corrected value.");
      const state = input.decision === "correct" ? "corrected" : input.decision === "accept" ? "accepted" : "rejected";
      if (t["state"] === state && (state !== "corrected" || t["corrected_value"] === input.correctedValue)) return done("already");
      await db.from("document_term_proposals").update({
        state, corrected_value: input.decision === "correct" ? input.correctedValue : null,
        reviewed_by: env.userId, reviewed_at: now, reviewed_for: "issued_policy",
      }).eq("organization_id", org).eq("id", input.proposalId);
      await env.audit({ action: `issuance.term_${state}`, objectType: "document_term_proposal", objectId: input.proposalId, result: "success", newState: { state, label: t["label"] } });
      await sync();
      return done();
    }

    case "run_issued_policy_check": {
      if (!hasPermission(ctx, "placement", "edit")) return blocked("You may not run the issued-policy check.");
      const latest = facts.documents[0];
      if (latest === undefined) return blocked("No policy document has been received yet.");
      const reading = await readingOf(db, org, latest["document_id"] as string);
      if (!reading.complete) return blocked("Review every value read from the policy document first: accept it, correct it, or reject it.");
      if (current.check?.current) return done("already");
      const ir = view.insurerResponse;
      if (ir === null) return blocked("There is no cover confirmation to check against.");
      const fieldEvidence = (f: Row): CheckEvidence => ({ documentFieldId: f["id"] as string, documentTermProposalId: null, page: (f["page_number"] as number | null) ?? null });
      const issued: Record<string, { value: string | null; evidence: CheckEvidence }> = {};
      for (const f of reading.fields) issued[f["field_key"] as string] = { value: valueOf(f), evidence: fieldEvidence(f) };
      const payload = (facts.request?.["payload"] as IssuanceRequestPayload | undefined) ?? null;
      const items = checkIssuedPolicy({
        clientName: view.client.name,
        insurerName: view.insurer.name,
        requestedPolicyNumber: payload?.requestedPolicyNumber ?? null,
        instruction: { conditions: view.conditions.map((c) => ({ text: c.text, state: c.state })) },
        basis: {
          version: view.basis.version, acceptedChanges: view.basis.origin === "client_accepted_changes",
          classOfBusiness: view.basis.classOfBusiness, effectiveAt: view.basis.effectiveAt, expiryAt: view.basis.expiryAt,
          derivedExpiryAt: view.basis.derivedExpiryAt, derivation: view.basis.derivation,
          premiumAmount: view.basis.premiumAmount, premiumCurrency: view.basis.premiumCurrency, premiumBasis: view.basis.premiumBasis,
          sumInsured: null,
          terms: view.basis.terms.map((t) => ({ termType: t.termType, label: t.label, value: t.value })),
        },
        confirmation: {
          insurerName: view.insurer.name, classOfBusiness: ir.confirmedClassOfBusiness, effectiveAt: ir.effectiveAt, expiryAt: ir.expiryAt,
          premiumAmount: ir.confirmedPremiumAmount, premiumCurrency: ir.confirmedPremiumCurrency, premiumBasis: ir.confirmedPremiumBasis,
          terms: ir.terms.map((t) => ({ termType: t.termType, label: t.label, value: t.value })),
        },
        issued,
        issuedTerms: reading.terms.filter((t) => t["state"] !== "rejected").map((t) => ({
          termType: t["term_type"] as string, label: t["label"] as string, value: valueOf(t),
          evidence: { documentFieldId: null, documentTermProposalId: t["id"] as string, page: (t["page_number"] as number | null) ?? null },
        })),
      });
      const material = items.filter((i) => i.material).length;
      const check = await db.from("issued_policy_checks").insert({
        organization_id: org, placement_id: placementId, issued_policy_document_id: latest["id"], client_instruction_id: view.instruction.id,
        basis_version_id: (await basisVersionId(db, org, placementId, view.basis.version)), placement_insurer_response_id: ir.id,
        review_sha256: reading.digest, ...(env.runId ? { compared_by_run_id: env.runId } : { compared_by: env.userId }), material_differences: material,
        unclear_count: items.filter((i) => i.classification === "unclear").length,
      }).select("id").maybeSingle();
      const checkId = (check.data as Row | null)?.["id"] as string | undefined;
      if (checkId === undefined) return blocked("The check could not be recorded. Try again.");
      for (const [position, i] of items.entries()) {
        await db.from("issued_policy_check_items").insert({
          organization_id: org, issued_policy_check_id: checkId, position, field: i.field, term_type: i.termType, label: i.label,
          instruction_value: i.instructionValue, basis_value: i.basisValue, confirmation_value: i.confirmationValue, issued_value: i.issuedValue,
          document_field_id: i.evidence?.documentFieldId ?? null, document_term_proposal_id: i.evidence?.documentTermProposalId ?? null,
          page_number: i.evidence?.page ?? null, classification: i.classification, material: i.material, calculation: i.calculation,
        });
      }
      await env.audit({ action: "issuance.policy_checked", objectType: "placement", objectId: placementId, result: "success", newState: { issuedPolicyCheckId: checkId, materialDifferences: material } });
      if (material > 0) {
        await env.audit({
          action: "issuance.discrepancy_recorded", objectType: "placement", objectId: placementId, result: "success",
          newState: { issuedPolicyCheckId: checkId, differences: items.filter((i) => i.material).map((i) => ({ label: i.label, classification: i.classification })) },
        });
      }
      await sync();
      return done("done", material === 0 ? "The issued policy matches what was agreed." : `The issued policy differs from what was agreed in ${material} ${material === 1 ? "place" : "places"}.`);
    }

    case "resolve_issued_policy_difference": {
      if (!hasPermission(ctx, "placement", input.resolution === "client_accepted_issued_value" ? "create" : "edit")) return blocked("You may not resolve an issued-policy difference.");
      const check = current.check;
      if (check === null || !check.current) return blocked("There is no current check to resolve a difference on. Run the check again.");
      const item = check.items.find((i) => i.id === input.itemId);
      if (item === undefined) return blocked("That difference is not on the current check.");
      if (!item.material) return blocked("That line matches, or is not material. There is nothing to resolve.");
      if (item.resolution !== null) return done("already");
      if (input.evidenceEmailMessageId === undefined && input.evidenceDocumentId === undefined && (input.evidenceNote ?? "").trim().length < 10) {
        return blocked("A difference is resolved with evidence: link the email, attach the document, or write down who decided what, and when.");
      }
      const ins = await db.from("issued_policy_resolutions").insert({
        organization_id: org, placement_id: placementId, issued_policy_check_item_id: input.itemId, resolution: input.resolution, reason: input.reason,
        evidence_email_message_id: input.evidenceEmailMessageId ?? null, evidence_document_id: input.evidenceDocumentId ?? null,
        evidence_note: input.evidenceNote ?? null, resolved_at: input.resolvedAt, recorded_by: env.userId,
      });
      if (ins.error) return done("already");
      await env.audit({ action: "issuance.discrepancy_resolved", objectType: "placement", objectId: placementId, result: "success", newState: { itemId: input.itemId, label: item.label, resolution: input.resolution } });
      await sync();
      return done("done", `${item.label}: resolved.`);
    }

    case "apply_issued_policy": {
      if (!hasPermission(ctx, "placement", "approve")) return blocked("You may not apply an issued policy to the policy record. Someone who may approve placements must.");
      if (facts.application !== null) {
        await env.audit({ action: "issuance.apply_replayed", objectType: "placement", objectId: placementId, result: "success", newState: { applicationId: facts.application["id"], repeat: true } });
        return done("already", receiptOf(current));
      }
      const preview = await previewApply(env, placementId, { mode: input.mode, ...(input.policyId ? { policyId: input.policyId } : {}), ...(input.periodId ? { periodId: input.periodId } : {}), ...(input.premiumBasis ? { premiumBasis: input.premiumBasis } : {}) }, { audit: false });
      if (!preview.canApply) return blocked([...preview.blocked, ...preview.conflicts].join(" ") || "The issued policy cannot be applied yet.");
      if (input.mode === "update" && canonical(input.expected ?? {}) !== canonical(preview.expected)) {
        return blocked("The target policy has changed since the preview. Preview again and check what will change.");
      }
      const values = valuesFor(preview, input.premiumBasis ?? null);
      const res = await db.rpc("policy_issuance_apply", {
        p_placement_id: placementId, p_check_id: current.check!.id, p_request_id: current.request!.id, p_mode: input.mode,
        p_policy_id: input.policyId ?? null, p_period_id: input.periodId ?? null,
        p_expected: input.mode === "update" ? preview.expected : null, p_values: values, p_idempotency_key: input.idempotencyKey,
      });
      if (res.error) {
        const m = res.error.message ?? "";
        if (m.startsWith("policy_number_conflict")) return blocked("Another policy in this brokerage already carries that policy number. Nothing was merged; check which policy it is.");
        if (m.startsWith("stale_target")) return blocked("The target policy has changed since the preview. Preview again.");
        if (m.startsWith("differences_unresolved")) return blocked("A material difference is still unresolved.");
        if (m.startsWith("check_not_current")) return blocked("The check is no longer the latest. Run it again.");
        if (m.startsWith("not_permitted") || m.startsWith("not_a_member")) return blocked("You may not apply an issued policy to the policy record.");
        if (m.startsWith("period_required")) return blocked("The issued policy's period was not read, or ends before it begins. Correct the reading first.");
        if (m.startsWith("premium_needs_currency_and_basis")) return blocked("The premium needs its currency and whether it is gross or the total payable.");
        if (m.startsWith("request_not_submitted")) return blocked("The issuance request has not been recorded as sent.");
        if (m.startsWith("target_")) return blocked("That policy or period is not this client's. Choose the target again.");
        throw new HttpError(500, "database_error", "The policy could not be applied.");
      }
      const out = res.data as { repeat: boolean; application_id: string };
      if (out.repeat) {
        await env.audit({ action: "issuance.apply_replayed", objectType: "placement", objectId: placementId, result: "success", newState: { applicationId: out.application_id, repeat: true } });
      }
      await env.audit({ action: "issuance.policy_applied", objectType: "placement", objectId: placementId, result: "success", newState: { applicationId: out.application_id, mode: input.mode } });
      await sync();
      // The insurer's issued policy is on the record (D-140): the issuance run writes its receipt.
      if (!out.repeat) {
        const pw = await db.from("placements").select("work_item_id").eq("id", placementId).maybeSingle();
        await emitEvent(db, null, {
          organizationId: env.organizationId, eventType: "policy.issued", entityType: "placement", entityId: placementId, actor: "user", actorUserId: env.userId,
          payload: { placementId, applicationId: out.application_id, workItemId: (pw.data as { work_item_id: string | null } | null)?.work_item_id ?? null },
          dedupeKey: out.application_id,
        });
      }
      return done(out.repeat ? "already" : "done", receiptOf(await loadIssuance(env, placementId)));
    }
  }
}

function receiptOf(v: IssuanceResponse): string {
  const a = v.application;
  if (a === null) return "The policy record was not written.";
  return `Policy ${a.policyNumber ?? "(no number)"} ${a.targetMode === "create" ? "created" : "updated"}, period ${day(a.periodStart)} to ${day(a.periodEnd)}, from the insurer's issued policy — by ${a.appliedByName ?? "a colleague"} on ${day(a.appliedAt)}.`;
}

async function basisVersionId(db: SupabaseClient, org: string, placementId: string, version: number): Promise<string> {
  const { data } = await db.from("placement_basis_versions").select("id").eq("organization_id", org).eq("placement_id", placementId).eq("version", version).maybeSingle();
  if (!data) throw new HttpError(409, "basis_missing", "The accepted basis for this placement could not be read.");
  return (data as Row)["id"] as string;
}


/* =============================================================================================
 * The preview, generated by the server before anything is written.
 * ============================================================================================= */

export async function previewApply(env: Env, placementId: string, req: ApplyPreviewRequest, opts: { audit: boolean } = { audit: true }): Promise<ApplyPreview> {
  const { db } = env;
  const org = env.organizationId;
  const v = await loadIssuance(env, placementId);
  const blockedReasons: string[] = [];
  const conflicts: string[] = [];
  if (v.stage !== "ready_to_apply") blockedReasons.push(v.stage === "applied" ? "The policy has already been applied." : `Not ready to apply: ${NEXT[v.stage]}`);
  if (!v.permissions.canApply) blockedReasons.push("You may not apply an issued policy to the policy record.");

  const doc = v.documents[0];
  const field = (key: string) => doc?.fields.find((f) => f.key === key);
  const issued = (key: string) => { const f = field(key); return f === undefined || f.state === "rejected" ? null : (f.correctedValue ?? f.proposedValue); };
  const ev = (key: string) => field(key)?.evidence ?? null;

  let current: Record<string, string | null> = { policy_number: null, period_start: null, period_end: null, premium: null };
  let label = "A new policy and its first period";
  if (req.mode === "update") {
    if (!req.policyId || !req.periodId) {
      blockedReasons.push("Name the policy and period to update.");
    } else {
      const cand = v.candidates.find((c) => c.policyId === req.policyId && c.periodId === req.periodId);
      if (cand === undefined) {
        blockedReasons.push("That policy and period are not this client's.");
      } else {
        const per = (await db.from("policy_periods").select("period_start, period_end, premium_amount").eq("organization_id", org).eq("id", req.periodId).maybeSingle()).data as Row | null;
        current = {
          policy_number: cand.policyNumber,
          period_start: (per?.["period_start"] as string | null) ?? null,
          period_end: (per?.["period_end"] as string | null) ?? null,
          premium: pgMoney(per?.["premium_amount"]),
        };
        label = `Policy ${cand.policyNumber ?? "(no number)"} with ${cand.insurerName}, period ${day(cand.periodStart)} to ${day(cand.periodEnd)}`;
      }
    }
  } else if (req.policyId || req.periodId) {
    blockedReasons.push("Creating a policy takes no existing target.");
  }

  const number = issued("policy_number");
  if (number !== null) {
    const clash = await db.from("policies").select("id, policy_number, client_id").eq("organization_id", org).is("deleted_at", null).ilike("policy_number", number.replace(/[\\%_]/g, (c) => `\\${c}`));
    const others = ((clash.data ?? []) as Row[]).filter((p) => req.mode === "create" || p["id"] !== req.policyId);
    if (others.length > 0) conflicts.push(`Policy number ${number} is already on another policy in this brokerage. Nothing will be merged: open that policy, or correct the reading.`);
  }
  const premium = issued("premium");
  const currency = issued("currency");
  if (premium !== null && currency === null) blockedReasons.push("The premium's currency was not read from the policy document. Correct the reading first.");
  if (premium !== null && !req.premiumBasis) blockedReasons.push("Say whether the issued premium is the gross premium or the total payable. The document does not decide it.");

  const accepted: Record<string, string | null> = {
    policy_number: v.request?.payload.requestedPolicyNumber ?? null,
    period_start: v.request?.payload.inception?.slice(0, 10) ?? null,
    period_end: v.request?.payload.end?.slice(0, 10) ?? null,
    premium: v.request?.payload.premiumAmount ?? null,
  };
  const rows: ApplyPreview["rows"] = (["policy_number", "period_start", "period_end", "premium"] as const).map((key) => {
    const iv = key === "period_start" || key === "period_end" ? (issued(key) === null ? null : /^\d{4}-\d{2}-\d{2}/.exec(issued(key)!)?.[0] ?? issued(key)) : issued(key);
    const cur = current[key] ?? null;
    const same = (cur ?? "") === (iv ?? "") || (key === "premium" && cur !== null && iv !== null && Number(cur) === Number(iv.replace(/,/g, "")));
    return {
      field: key,
      label: { policy_number: "Policy number", period_start: "Cover begins", period_end: "Cover ends", premium: "Premium" }[key],
      current: cur, issued: iv, accepted: accepted[key] ?? null, evidence: ev(key),
      status: iv === null && key !== "premium" ? "blocked" : same ? "unchanged" : "will_change",
      note: iv === null && key !== "premium" ? "Not read from the policy document." : null,
    };
  });
  if (premium !== null && currency !== null) {
    rows.push({ field: "currency", label: "Currency", current: null, issued: currency.toUpperCase(), accepted: v.request?.payload.premiumCurrency ?? null, evidence: ev("currency"), status: "will_change", note: null });
  }
  if (rows.some((r) => r.status === "blocked" && (r.field === "period_start" || r.field === "period_end"))) blockedReasons.push("The policy document's period was not read. Correct the reading first.");

  const preview: ApplyPreview = {
    target: { mode: req.mode, policyId: req.policyId ?? null, periodId: req.periodId ?? null, label },
    rows, conflicts, blocked: blockedReasons, expected: current,
    canApply: blockedReasons.length === 0 && conflicts.length === 0,
  };
  if (opts.audit) {
    await env.audit({ action: "issuance.apply_previewed", objectType: "placement", objectId: placementId, result: "success", newState: { mode: req.mode, policyId: req.policyId ?? null, canApply: preview.canApply } });
  }
  return preview;
}

function valuesFor(p: ApplyPreview, premiumBasis: string | null) {
  const get = (k: string) => p.rows.find((r) => r.field === k)?.issued ?? null;
  return {
    policy_number: get("policy_number"),
    period_start: get("period_start"),
    period_end: get("period_end"),
    premium: get("premium"),
    premium_currency: get("currency"),
    premium_basis: get("premium") === null ? null : premiumBasis,
    changes: p.rows.filter((r) => r.status === "will_change").map((r) => ({
      field_key: r.field, from: r.current, to: r.issued, accepted: r.accepted,
      document_field_id: r.evidence?.path ? new URL(`https://x${r.evidence.path}`).searchParams.get("field") : null,
      page: r.evidence?.page ?? null, region: r.evidence?.region ?? null,
    })),
  };
}

/** Everything a prepared issuance action rests on: moving any makes it stale. */
export function issuanceFingerprint(v: IssuanceResponse): { versions: Record<string, unknown>; fingerprint: string } {
  const versions = {
    stage: v.stage,
    request: v.request?.id ?? null,
    digest: v.request?.sha256 ?? null,
    approved: v.request?.approval?.approvedAt ?? null,
    submitted: v.request?.submission?.sentAt ?? null,
    documents: v.documents.map((d) => d.id),
    check: v.check?.id ?? null,
    checkCurrent: v.check?.current ?? null,
    resolved: v.check?.items.filter((i) => i.resolution !== null).map((i) => i.id) ?? [],
    application: v.application?.id ?? null,
  };
  return { versions, fingerprint: sha(versions) };
}

export { toPreparedView };
export type { Ctx };


/**
 * executeIssuanceAction, and then the fact that the placement moved (D-142): the placement or issuance run waiting
 * on it looks again. Every caller — the route, a confirmed prepared action, a workflow step — goes
 * through here, so none can change a placement without the run noticing.
 */
export async function executeIssuanceAction(env: Env, placementId: string, input: IssuanceAction): Promise<IssuanceOutcome> {
  const out = await executeIssuanceActionInner(env, placementId, input);
  if (out.outcome === "done") {
    await emitEvent(env.db, null, {
      organizationId: env.organizationId, eventType: "placement.changed", entityType: "placement", entityId: placementId,
      actor: env.runId ? "automation" : "user", actorUserId: env.runId ? null : env.userId,
      payload: { placementId, action: input.action, scope: "issuance" },
    });
  }
  return out;
}
