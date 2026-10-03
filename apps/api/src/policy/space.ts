import { createHash } from "node:crypto";
import type { PolicyAction, PolicyEvidence, PolicyFact, PolicySpaceResponse, PolicyTerm, PolicyWork, ValueSource } from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasPermission } from "../context.js";
import { HttpError } from "../errors.js";
import { pgMoney } from "../numeric.js";
import { loadIssuance } from "../placement/issuance.js";
import { load, names, type Env } from "../placement/service.js";
import { nairobiDay, overlaps, periodCover, periodWhen, policyCover, type PeriodEvidence } from "./cover.js";

/**
 * The Policy Space (4C-1): one real policy and every one of its periods, assembled server-side.
 *
 * Reuses what already exists rather than restating it: the placement and issuance loaders for
 * what was agreed, confirmed and printed; `document_applications` for a reviewed document applied
 * to a period by hand; `placement_cancellations` for the only explicit cancellation the book
 * holds. Cover state comes from `cover.ts` and nowhere else.
 *
 * `readOnly` reads without bringing Work into line — Ask's reads use it, so asking writes nothing.
 */

type Row = Record<string, unknown>;

const day = (iso: string | null | undefined) =>
  !iso ? "" : new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A renewal started from a policy is titled by that policy, so starting it twice finds the same one. */
export function renewalTitle(clientName: string, classOfBusiness: string, policyNumber: string | null): string {
  return `${clientName} — renewal, ${classOfBusiness}${policyNumber ? ` ${policyNumber}` : ""}`;
}

export const OVERLAP_REASON = "resolve_overlapping_periods";
const MONEY_STATEMENT = "Premium is shown as recorded. No invoice or payment is recorded here, so whether it has been paid is not known. Money arrives in a later stage.";

function docPath(documentId: string, page: number | null, fieldId?: string | null) {
  const q = [page ? `page=${page}` : null, fieldId ? `field=${fieldId}` : null].filter(Boolean).join("&");
  return `/documents/${documentId}${q ? `?${q}` : ""}`;
}

export async function loadPolicySpace(env: Env, policyId: string, opts: { periodId?: string | null; readOnly?: boolean; now?: Date } = {}): Promise<PolicySpaceResponse> {
  const { db, ctx } = env;
  const org = env.organizationId;
  if (!hasPermission(ctx, "policy", "view")) throw new HttpError(403, "forbidden", "You may not view policies.");
  const polQ = await db.from("policies").select("id, client_id, insurer_id, class_of_business, policy_number, created_at, deleted_at").eq("organization_id", org).eq("id", policyId).maybeSingle();
  const pol = polQ.data as Row | null;
  if (!pol || pol["deleted_at"] !== null) throw new HttpError(404, "not_found", "No policy with that id");
  const today = nairobiDay(opts.now ?? new Date());

  const [clientQ, insurerQ, periodsQ, appsQ] = await Promise.all([
    db.from("clients").select("id, name").eq("organization_id", org).eq("id", pol["client_id"] as string).maybeSingle(),
    db.from("insurers").select("id, name").eq("organization_id", org).eq("id", pol["insurer_id"] as string).maybeSingle(),
    db.from("policy_periods").select("*").eq("organization_id", org).eq("policy_id", policyId).order("period_start", { ascending: true }),
    db.from("policy_issuance_applications").select("*").eq("organization_id", org).eq("policy_id", policyId).order("applied_at", { ascending: true }),
  ]);
  const client = { id: pol["client_id"] as string, name: ((clientQ.data as Row | null)?.["name"] as string) ?? "The client" };
  const insurer = { id: pol["insurer_id"] as string, name: ((insurerQ.data as Row | null)?.["name"] as string) ?? "The insurer" };
  const periods = (periodsQ.data ?? []) as Row[];
  const periodIds = periods.map((p) => p["id"] as string);
  const apps = (appsQ.data ?? []) as Row[];
  /* Only this policy's own targets — indexed on (organization_id, target_type, target_id). */
  const docAppsQ = await db.from("document_applications").select("id, document_id, target_type, target_id, changes, applied_by, applied_at")
    .eq("organization_id", org).in("target_type", ["policy_period", "policy"]).in("target_id", [policyId, ...periodIds]);
  const docApps = ((docAppsQ.data ?? []) as Row[]).filter((a) => (a["target_type"] === "policy" && a["target_id"] === policyId) || (a["target_type"] === "policy_period" && periodIds.includes(a["target_id"] as string)));

  const placementIds = [...new Set(apps.map((a) => a["placement_id"] as string))];
  const [cancelQ, confirmQ, docsQ] = await Promise.all([
    placementIds.length === 0 ? Promise.resolve({ data: [] }) : db.from("placement_cancellations").select("*").eq("organization_id", org).in("placement_id", placementIds),
    apps.length === 0 ? Promise.resolve({ data: [] }) : db.from("placement_insurer_responses").select("id, placement_id, outcome, received_at, effective_at, expiry_at, insurer_reference, evidence_document_id, evidence_note, recorded_by").eq("organization_id", org).in("id", apps.map((a) => a["placement_insurer_response_id"] as string)),
    db.from("documents").select("id, filename, kind, extraction_state, uploaded_by, created_at").eq("organization_id", org).is("deleted_at", null).in("id", [
      ...apps.map((a) => a["document_id"] as string), ...docApps.map((a) => a["document_id"] as string),
      ...periods.map((p) => p["premium_evidence_document_id"] as string | null).filter((x): x is string => x !== null),
    ].concat(["00000000-0000-0000-0000-000000000000"])),
  ]);
  const cancellations = (cancelQ.data ?? []) as Row[];
  const confirmations = (confirmQ.data ?? []) as Row[];
  const docs = (docsQ.data ?? []) as Row[];
  const people = await names(db, [
    ...apps.map((a) => a["applied_by"] as string), ...docApps.map((a) => a["applied_by"] as string),
    ...confirmations.map((c) => c["recorded_by"] as string), ...cancellations.map((c) => c["recorded_by"] as string),
  ]);

  /* ---- Evidence per period --------------------------------------------------------------- */

  const evidenceFor = (periodId: string): { evidence: PolicyEvidence[]; cancellation: PeriodEvidence["cancellation"]; origin: "issuance" | "document" | "manual" } => {
    const out: PolicyEvidence[] = [];
    let origin: "issuance" | "document" | "manual" = "manual";
    let cancellation: PeriodEvidence["cancellation"] = null;
    for (const a of apps.filter((x) => x["policy_period_id"] === periodId)) {
      origin = "issuance";
      const conf = confirmations.find((c) => c["id"] === a["placement_insurer_response_id"]);
      if (conf && String(conf["outcome"]).startsWith("confirmed")) {
        out.push({
          kind: "cover_confirmation", label: `${insurer.name} confirmed cover${conf["insurer_reference"] ? ` (${conf["insurer_reference"] as string})` : ""}, received ${day(conf["received_at"] as string)}`,
          documentId: (conf["evidence_document_id"] as string | null) ?? null, page: null, region: null,
          path: `/placements/${a["placement_id"] as string}`, recordedByName: people.get(conf["recorded_by"] as string) ?? null, recordedAt: conf["received_at"] as string,
        });
      }
      const d = docs.find((x) => x["id"] === a["document_id"]);
      out.push({
        kind: "issued_document", label: `The insurer's issued policy${d ? `: ${d["filename"] as string}` : ""}, reviewed and applied`,
        documentId: a["document_id"] as string, page: null, region: null, path: docPath(a["document_id"] as string, null),
        recordedByName: people.get(a["applied_by"] as string) ?? null, recordedAt: a["applied_at"] as string,
      });
      out.push({
        kind: "issuance_application", label: "The issuance receipt: the policy record written from the checked policy",
        documentId: null, page: null, region: null, path: `/placements/${a["placement_id"] as string}/issuance`,
        recordedByName: people.get(a["applied_by"] as string) ?? null, recordedAt: a["applied_at"] as string,
      });
      const c = cancellations.find((x) => x["placement_id"] === a["placement_id"]);
      if (c) {
        cancellation = {
          at: c["cancelled_at"] as string,
          evidence: {
            kind: "cancellation", label: `Cancellation recorded: ${c["reason"] as string}`, documentId: (c["evidence_document_id"] as string | null) ?? null, page: null, region: null,
            path: `/placements/${a["placement_id"] as string}`, recordedByName: people.get(c["recorded_by"] as string) ?? null, recordedAt: c["recorded_at"] as string,
          },
        };
      }
    }
    for (const a of docApps.filter((x) => x["target_type"] === "policy_period" && x["target_id"] === periodId)) {
      const d = docs.find((x) => x["id"] === a["document_id"]);
      if (!d || !documentProvesCover(d["kind"] as string)) continue;
      if (origin === "manual") origin = "document";
      out.push({
        kind: "document", label: `${d["filename"] as string}, reviewed and applied to this period`,
        documentId: d["id"] as string, page: null, region: null, path: docPath(d["id"] as string, null),
        recordedByName: people.get(a["applied_by"] as string) ?? null, recordedAt: a["applied_at"] as string,
      });
    }
    return { evidence: out, cancellation, origin };
  };

  const periodEvidence: (PeriodEvidence & { origin: "issuance" | "document" | "manual" })[] = periods.map((p) => {
    const e = evidenceFor(p["id"] as string);
    return {
      id: p["id"] as string, start: p["period_start"] as string, end: p["period_end"] as string,
      evidence: e.evidence, verified: evidenceVerifiesCover(e.evidence),
      cancellation: e.cancellation, origin: e.origin,
    };
  });
  const reading = policyCover(periodEvidence, today, opts.periodId ?? null);
  const over = overlaps(periodEvidence);

  /* ---- The latest issuance behind the selected period, read through the placement's loaders -- */

  const selected = periods.find((p) => p["id"] === reading.selectedPeriodId) ?? null;
  const app = selected ? ([...apps].reverse().find((a) => a["policy_period_id"] === selected["id"]) ?? null) : null;
  const placementView = app ? await load(db, ctx, org, app["placement_id"] as string, { readOnly: true }).catch(() => null) : null;
  const issuanceView = app ? await loadIssuance(env, app["placement_id"] as string, { readOnly: true }).catch(() => null) : null;
  const issuedDoc = issuanceView?.documents.find((d) => d.documentId === app?.["document_id"]) ?? null;
  const field = (key: string) => issuedDoc?.fields.find((f) => f.key === key && f.state !== "rejected") ?? null;
  const checkItem = (fieldName: string) => issuanceView?.check?.items.find((i) => i.field === fieldName) ?? null;

  const fromDoc = (key: string, checkField: string): { value: string | null; source: ValueSource; evidence: PolicyEvidence | null } | null => {
    const f = field(key);
    if (!f || !issuedDoc) return null;
    const item = checkItem(checkField);
    const conflicting = item !== null && item.material && item.resolution === null;
    return {
      value: f.correctedValue ?? f.proposedValue,
      source: conflicting ? "conflicting" : f.state === "corrected" ? "corrected" : "extracted_accepted",
      evidence: {
        kind: "issued_document", label: `${issuedDoc.filename}${f.evidence?.page ? `, page ${f.evidence.page}` : ""}${f.state === "corrected" ? ` — read as ${f.proposedValue ?? "nothing"}, corrected by a person` : ""}`,
        documentId: issuedDoc.documentId, page: f.evidence?.page ?? null, region: f.evidence?.region ?? null,
        path: docPath(issuedDoc.documentId, f.evidence?.page ?? null, f.id), recordedByName: null, recordedAt: null,
      },
    };
  };

  /* ---- Facts -------------------------------------------------------------------------------- */

  const facts: PolicyFact[] = [];
  const periodVerified = periodEvidence.find((p) => p.id === selected?.["id"])?.verified ?? false;
  const manualSource = (v: unknown): ValueSource => (v === null || v === undefined || v === "" ? "missing" : periodVerified ? "manually_recorded" : "unverified");
  const fact = (key: string, label: string, stored: string | null, doc: ReturnType<typeof fromDoc>, note: string | null = null) => {
    if (doc) facts.push({ key, label, value: doc.value ?? stored, source: doc.source, evidence: doc.evidence, note });
    else facts.push({ key, label, value: stored, source: manualSource(stored), evidence: null, note: stored === null ? (note ?? "Not recorded.") : note });
  };
  facts.push({ key: "insured", label: "Insured", value: client.name, source: fromDoc("insured_name", "insured")?.source ?? "manually_recorded", evidence: fromDoc("insured_name", "insured")?.evidence ?? null, note: null });
  facts.push({ key: "insurer", label: "Insurer", value: insurer.name, source: fromDoc("insurer_name", "insurer")?.source ?? "manually_recorded", evidence: fromDoc("insurer_name", "insurer")?.evidence ?? null, note: null });
  fact("policy_number", "Policy number", (pol["policy_number"] as string | null) ?? null, fromDoc("policy_number", "policy_number"), pol["policy_number"] ? null : "No policy number is recorded. A policy number on its own would not prove cover.");
  fact("class", "Class of business", pol["class_of_business"] as string, fromDoc("class_of_business", "class_of_business"));
  fact("inception", "Cover begins", (selected?.["period_start"] as string | undefined) ?? null, selected ? fromDoc("period_start", "inception") : null);
  fact("expiry", "Cover ends", (selected?.["period_end"] as string | undefined) ?? null, selected ? fromDoc("period_end", "expiry") : null);
  const premium = selected ? pgMoney(selected["premium_amount"]) : null;
  const premiumEvidenceDoc = selected?.["premium_evidence_document_id"] as string | null | undefined;
  if (premium === null) {
    facts.push({ key: "premium", label: "Premium", value: null, source: "missing", evidence: null, note: "No premium is recorded for this period." });
  } else {
    const docP = fromDoc("premium", "premium");
    facts.push({
      key: "premium", label: "Premium", value: `${selected!["premium_currency"] as string} ${Number(premium).toLocaleString("en-KE")}`,
      source: docP?.source ?? (premiumEvidenceDoc && selected!["premium_verified_at"] ? "extracted_accepted" : manualSource(premium)),
      evidence: docP?.evidence ?? (premiumEvidenceDoc ? { kind: "document", label: "The document the premium was verified from", documentId: premiumEvidenceDoc, page: null, region: null, path: docPath(premiumEvidenceDoc, null), recordedByName: null, recordedAt: (selected!["premium_verified_at"] as string | null) ?? null } : null),
      note: "Recorded premium. Whether it has been paid is not known here.",
    });
  }
  facts.push({ key: "currency", label: "Currency", value: (selected?.["premium_currency"] as string | null) ?? null, source: selected?.["premium_currency"] ? (fromDoc("currency", "currency")?.source ?? manualSource(selected["premium_currency"])) : "missing", evidence: fromDoc("currency", "currency")?.evidence ?? null, note: null });
  facts.push({
    key: "premium_basis", label: "Premium basis",
    value: selected?.["premium_basis"] === "gross" ? "Gross premium" : selected?.["premium_basis"] === "total_payable" ? "Total payable" : null,
    source: selected?.["premium_basis"] ? "manually_recorded" : "missing", evidence: null,
    note: selected?.["premium_basis"] ? "Stated by a person when the premium was recorded; a document does not decide it." : null,
  });
  const si = fromDoc("sum_insured", "sum_insured");
  facts.push(si ? { key: "sum_insured", label: "Sum insured", value: si.value, source: si.source, evidence: si.evidence, note: null } : { key: "sum_insured", label: "Sum insured", value: null, source: "missing", evidence: null, note: "No sum insured is recorded for this period." });

  /* ---- Terms, four ways ----------------------------------------------------------------------- */

  const terms: PolicyTerm[] = [];
  if (placementView || issuedDoc) {
    const keyOf = (t: { termType: string; label: string }) => `${t.termType}|${t.label.trim().toLowerCase()}`;
    const keys = new Map<string, { termType: string; label: string }>();
    for (const t of placementView?.basis.terms ?? []) keys.set(keyOf(t), t);
    for (const t of placementView?.insurerResponse?.terms ?? []) keys.set(keyOf(t), t);
    for (const t of issuedDoc?.terms ?? []) if (t.state !== "rejected") keys.set(keyOf(t), t);
    for (const [k, t] of keys) {
      const agreed = placementView?.basis.terms.find((x) => keyOf(x) === k) ?? null;
      const confirmed = placementView?.insurerResponse?.terms.find((x) => keyOf(x) === k) ?? null;
      const issued = issuedDoc?.terms.find((x) => keyOf(x) === k && x.state !== "rejected") ?? null;
      const item = issuanceView?.check?.items.find((i) => i.field === "term" && `${i.termType}|${i.label.trim().toLowerCase()}` === k) ?? null;
      const issuedValue = issued ? (issued.correctedValue ?? issued.proposedValue) : null;
      terms.push({
        termType: t.termType, label: t.label,
        agreed: agreed?.value ?? null, confirmed: confirmed ? (confirmed.value ?? null) : null, issued: issuedValue,
        final: issuedValue,
        source: issued ? (item && item.material && !item.resolution ? "conflicting" : issued.state === "corrected" ? "corrected" : "extracted_accepted") : "missing",
        evidence: issued && issuedDoc ? {
          kind: "issued_document", label: `${issuedDoc.filename}${issued.evidence?.page ? `, page ${issued.evidence.page}` : ""}`, documentId: issuedDoc.documentId,
          page: issued.evidence?.page ?? null, region: issued.evidence?.region ?? null, path: docPath(issuedDoc.documentId, issued.evidence?.page ?? null, issued.id), recordedByName: null, recordedAt: null,
        } : null,
        difference: item && item.classification !== "match" ? { words: item.classificationWords, resolved: item.resolution !== null, resolution: item.resolution ? `${item.resolution.reason} (${item.resolution.resolvedByName ?? "a colleague"}, ${day(item.resolution.resolvedAt)})` : null } : null,
      });
    }
  }

  const differences = (issuanceView?.check?.items ?? []).filter((i) => i.classification !== "match" && i.classification !== "not_applicable").map((i) => ({
    label: i.label, words: i.classificationWords, agreed: i.basisValue ?? i.instructionValue, confirmed: i.confirmationValue, issued: i.issuedValue,
    resolved: i.resolution !== null || !i.material,
    resolution: i.resolution ? `${i.resolution.reason} — ${i.resolution.resolvedByName ?? "a colleague"}, ${day(i.resolution.resolvedAt)}` : i.material ? null : "Not material.",
  }));

  /* ---- Work ---------------------------------------------------------------------------------- */

  const overlapping = reading.conflicts.length > 0;
  if (!opts.readOnly) await syncOverlapWork(db, org, { policyId, clientId: client.id, insurerId: insurer.id, classOfBusiness: pol["class_of_business"] as string, title: `${client.name} — ${pol["class_of_business"] as string}${pol["policy_number"] ? ` ${pol["policy_number"] as string}` : ""}` }, overlapping);

  const [claimsQ, endoQ] = await Promise.all([
    db.from("claims").select("id, work_item_id, created_at, incident_on").eq("organization_id", org).eq("policy_id", policyId),
    db.from("endorsements").select("id, work_item_id, created_at, request_text").eq("organization_id", org).eq("policy_id", policyId),
  ]);
  const claims = (claimsQ.data ?? []) as Row[];
  const endorsements = (endoQ.data ?? []) as Row[];
  const renewalName = renewalTitle(client.name, pol["class_of_business"] as string, (pol["policy_number"] as string | null) ?? null);
  const workOr = [
    `and(source_type.eq.policy,source_id.eq.${policyId})`,
    ...placementIds.map((id) => `and(source_type.eq.placement,source_id.eq.${id})`),
    ...(periodIds.length > 0 ? [`policy_period_id.in.(${periodIds.join(",")})`] : []),
    ...[...claims, ...endorsements].map((r) => `id.eq.${r["work_item_id"] as string}`),
  ];
  const [workQ, renewQ] = await Promise.all([
    db.from("work_items").select("id, title, kind, task_status, task_party, task_since, reason, required_action, evidence_needed, outcome_after, source_type, source_id, reason_code, created_at, completed_at").eq("organization_id", org).is("deleted_at", null).or(workOr.join(",")),
    db.from("work_items").select("id, title, kind, task_status, task_party, task_since, reason, required_action, evidence_needed, outcome_after, source_type, source_id, reason_code, created_at, completed_at").eq("organization_id", org).is("deleted_at", null).eq("kind", "renewal").eq("title", renewalName),
  ]);
  const allWork = [...((workQ.data ?? []) as Row[]), ...((renewQ.data ?? []) as Row[])].filter((w, i, a) => a.findIndex((x) => x["id"] === w["id"]) === i);
  const pathOf = (w: Row) =>
    w["source_type"] === "placement" ? (String(w["reason_code"]).match(/issu|apply/) ? `/placements/${w["source_id"] as string}/issuance` : `/placements/${w["source_id"] as string}`)
      : w["source_type"] === "policy" ? `/policies/${policyId}` : `/r/${w["id"] as string}`;
  const work: PolicyWork[] = allWork.filter((w) => w["task_status"] !== "done").map((w) => ({
    id: w["id"] as string, title: w["title"] as string, kind: w["kind"] as string, taskStatus: w["task_status"] as PolicyWork["taskStatus"],
    taskParty: (w["task_party"] as string | null) ?? null, taskSince: (w["task_since"] as string | null) ?? null,
    reason: (w["reason"] as string | null) ?? null, requiredAction: (w["required_action"] as string | null) ?? null,
    evidenceNeeded: (w["evidence_needed"] as string | null) ?? null, outcomeAfter: (w["outcome_after"] as string | null) ?? null, path: pathOf(w),
  }));

  /* ---- Timeline, from dated records only ------------------------------------------------------ */

  const timeline: PolicySpaceResponse["timeline"] = [];
  const push = (id: string, at: string | null | undefined, text: string, tone: PolicySpaceResponse["timeline"][number]["tone"], path: string | null) => {
    if (at) timeline.push({ id, at, text: text.slice(0, 400), tone, path });
  };
  if (placementView) {
    const pv = placementView;
    const pid = pv.placement.id;
    push("opp", pv.opportunity ? (await db.from("opportunities").select("created_at").eq("organization_id", org).eq("id", pv.opportunity.id).maybeSingle()).data?.["created_at"] as string : null, `Quotation work opened: ${pv.opportunity.title}`, "neutral", `/opportunities/${pv.opportunity.id}`);
    push("instr", pv.instruction.instructedAt, `The client chose ${insurer.name}${pv.instruction.comparisonVersion ? ` from comparison version ${pv.instruction.comparisonVersion}` : ""}.`, "active", `/placements/${pid}`);
    if (pv.request?.approval) push("p-appr", pv.request.approval.approvedAt, `Placement request version ${pv.request.version} approved by ${pv.request.approval.approvedByName ?? "a colleague"}.`, "active", `/placements/${pid}`);
    if (pv.request?.submission) push("p-sent", pv.request.submission.sentAt, `Placement request sent to ${insurer.name}, recorded by ${pv.request.submission.recordedByName ?? "a colleague"}.`, "active", `/placements/${pid}`);
    if (pv.insurerResponse) push("p-conf", pv.insurerResponse.receivedAt, `${insurer.name}: ${pv.insurerResponse.outcome === "confirmed_as_requested" ? "cover confirmed as requested" : pv.insurerResponse.outcome === "confirmed_with_changes" ? "cover confirmed on changed terms" : pv.insurerResponse.outcome.replace(/_/g, " ")}.`, "done", `/placements/${pid}`);
    for (const c of pv.conditions) if (c.resolvedAt) push(`cond-${c.id}`, c.resolvedAt, `Client condition ${c.state.replace(/_/g, " ")}: ${c.text}`, "done", `/placements/${pid}`);
  }
  if (issuanceView && app) {
    const iv = issuanceView;
    const pid = app["placement_id"] as string;
    if (iv.request) {
      push("i-prep", iv.request.preparedAt, `Issuance request version ${iv.request.version} prepared.`, "neutral", `/placements/${pid}/issuance`);
      if (iv.request.approval) push("i-appr", iv.request.approval.approvedAt, `Issuance request approved by ${iv.request.approval.approvedByName ?? "a colleague"}.`, "active", `/placements/${pid}/issuance`);
      if (iv.request.submission) push("i-sent", iv.request.submission.sentAt, `Issuance request sent to ${iv.request.submission.recipient}, recorded by ${iv.request.submission.recordedByName ?? "a colleague"}.`, "active", `/placements/${pid}/issuance`);
    }
    for (const d of iv.documents) push(`i-doc-${d.id}`, d.receivedAt, `${insurer.name}'s policy document received: ${d.filename}.`, "active", docPath(d.documentId, null));
    if (iv.check) push("i-check", iv.check.comparedAt, iv.check.materialDifferences === 0 ? "Issued policy checked: it matches what was agreed." : `Issued policy checked: ${iv.check.materialDifferences} difference(s) from what was agreed.`, iv.check.materialDifferences === 0 ? "done" : "attention", `/placements/${pid}/issuance`);
  }
  for (const a of apps) push(`apply-${a["id"] as string}`, a["applied_at"] as string, `Policy record ${a["target_mode"] === "create" ? "created" : "updated"} from the issued policy by ${people.get(a["applied_by"] as string) ?? "a colleague"}.`, "done", `/placements/${a["placement_id"] as string}/issuance`);
  for (const a of docApps) push(`docapp-${a["id"] as string}`, a["applied_at"] as string, `A reviewed document was applied to this policy by ${people.get(a["applied_by"] as string) ?? "a colleague"}.`, "done", docPath(a["document_id"] as string, null));
  for (const p of periods) {
    const e = periodEvidence.find((x) => x.id === p["id"])!;
    if (e.verified && (p["period_end"] as string) < today && e.cancellation === null) push(`exp-${p["id"] as string}`, `${p["period_end"] as string}T21:00:00Z`, `Period ${day(p["period_start"] as string)} to ${day(p["period_end"] as string)} ended.`, "neutral", `/policies/${policyId}?period=${p["id"] as string}`);
    if (e.cancellation) push(`cancel-${p["id"] as string}`, e.cancellation.at, e.cancellation.evidence.label, "attention", e.cancellation.evidence.path);
  }
  for (const c of claims) push(`claim-${c["id"] as string}`, c["created_at"] as string, `Claim reported${c["incident_on"] ? ` for an incident on ${day(c["incident_on"] as string)}` : ""}.`, "attention", `/r/${c["work_item_id"] as string}`);
  for (const e of endorsements) push(`endo-${e["id"] as string}`, e["created_at"] as string, `Endorsement requested: ${String(e["request_text"]).slice(0, 120)}`, "neutral", `/r/${e["work_item_id"] as string}`);
  for (const w of allWork.filter((x) => x["kind"] === "renewal")) push(`renew-${w["id"] as string}`, w["created_at"] as string, "Renewal started.", "active", `/r/${w["id"] as string}`);
  push("created", pol["created_at"] as string, "Policy put on file.", "neutral", null);
  timeline.sort((a, b) => a.at.localeCompare(b.at));

  /* ---- Related, documents, actions ------------------------------------------------------------ */

  const related: PolicySpaceResponse["related"] = [{ kind: "client", id: client.id, title: client.name, path: `/clients/${client.id}` }];
  if (placementView && app) {
    related.push({ kind: "placement", id: placementView.placement.id, title: placementView.placement.title, path: `/placements/${placementView.placement.id}` });
    related.push({ kind: "issuance", id: placementView.placement.id, title: "Issuance receipt", path: `/placements/${placementView.placement.id}/issuance` });
    related.push({ kind: "quotation", id: placementView.opportunity.id, title: placementView.opportunity.title, path: `/opportunities/${placementView.opportunity.id}` });
    related.push({ kind: "comparison", id: placementView.opportunity.id, title: "The comparison the client was shown", path: `/opportunities/${placementView.opportunity.id}/comparison${placementView.instruction.comparisonVersion ? `?version=${placementView.instruction.comparisonVersion}` : ""}` });
  }
  for (const c of claims) related.push({ kind: "claim", id: c["work_item_id"] as string, title: "Claim", path: `/r/${c["work_item_id"] as string}` });
  for (const e of endorsements) related.push({ kind: "endorsement", id: e["work_item_id"] as string, title: "Endorsement", path: `/r/${e["work_item_id"] as string}` });
  for (const w of allWork.filter((x) => x["kind"] === "renewal")) related.push({ kind: "renewal", id: w["id"] as string, title: w["title"] as string, path: `/r/${w["id"] as string}` });

  const documents = docs.map((d) => ({
    id: d["id"] as string, filename: d["filename"] as string, kind: d["kind"] as string, extractionState: d["extraction_state"] as string,
    role: apps.some((a) => a["document_id"] === d["id"]) ? "Issued policy" : docApps.some((a) => a["document_id"] === d["id"]) ? "Applied to a period" : "Premium evidence",
    path: docPath(d["id"] as string, null),
  }));
  for (const d of documents) related.push({ kind: "document", id: d.id, title: d.filename, path: d.path });

  const canEdit = hasPermission(ctx, "policy", "edit");
  const canClaim = hasPermission(ctx, "claim", "create");
  const openRenewal = allWork.find((w) => w["kind"] === "renewal" && w["task_status"] !== "done");
  const actions: PolicyAction[] = [
    { key: "start_renewal", label: openRenewal ? "Open the renewal" : "Start renewal", available: canEdit || openRenewal !== undefined, reason: canEdit || openRenewal ? null : "You may not start work on a policy.", path: openRenewal ? `/r/${openRenewal["id"] as string}` : null },
    { key: "report_claim", label: "Report claim", available: canClaim, reason: canClaim ? null : "You may not report a claim.", path: `/new/claim?policy=${policyId}${reading.selectedPeriodId ? `&period=${reading.selectedPeriodId}` : ""}` },
    { key: "request_endorsement", label: "Request endorsement", available: canEdit, reason: canEdit ? null : "You may not request a change to a policy.", path: `/new/endorsement?policy=${policyId}${reading.selectedPeriodId ? `&period=${reading.selectedPeriodId}` : ""}` },
    { key: "open_servicing", label: "Open servicing work", available: false, reason: "Servicing work is not built yet; it arrives in a later stage of 4C.", path: null },
    { key: "review_documents", label: "Review documents", available: documents.length > 0, reason: documents.length > 0 ? null : "No document is linked to this policy yet.", path: documents[0]?.path ?? null },
    { key: "open_client", label: "Open client", available: true, reason: null, path: `/clients/${client.id}` },
    { key: "open_placement", label: "Open placement", available: app !== null, reason: app ? null : "This policy was not placed through ASAP, so there is no placement to open.", path: app ? `/placements/${app["placement_id"] as string}` : null },
    { key: "open_issuance", label: "Open issuance receipt", available: app !== null, reason: app ? null : "No issuance receipt: this policy was recorded directly.", path: app ? `/placements/${app["placement_id"] as string}/issuance` : null },
  ];

  /* ---- Gaps: what is not known, in words ------------------------------------------------------- */

  const gaps: string[] = [];
  for (const f of facts) if (f.source === "missing") gaps.push(`${f.label}: not recorded.`);
  if (terms.length === 0) gaps.push("No coverage terms (limits, excesses, exclusions, conditions) are recorded for this policy.");
  if (!reading.cover.verified && reading.cover.state === null && periods.length > 0 && reading.conflicts.length === 0) gaps.push("Cover has not been verified: no insurer confirmation or reviewed policy document is linked.");
  if (reading.selectedPeriodId === null && reading.conflicts.length > 0) gaps.push("Choose a period to read: the periods overlap, and ASAP does not choose one.");
  gaps.push("Endorsements affecting a period: none are applied to a period yet — endorsements arrive in a later stage.");

  const preparedQ = await db.from("prepared_actions").select("id, action_type, state, changes, blockers, permitted, expires_at, receipt").eq("organization_id", org).eq("policy_id", policyId).order("prepared_at", { ascending: false }).limit(10);

  return {
    policy: { id: policyId, classOfBusiness: pol["class_of_business"] as string, createdAt: pol["created_at"] as string },
    title: `${pol["class_of_business"] as string} — ${client.name}${pol["policy_number"] ? ` · ${pol["policy_number"] as string}` : ""}`,
    client, insurer,
    periods: periodEvidence.map((p) => {
      const row = periods.find((x) => x["id"] === p.id)!;
      const amount = pgMoney(row["premium_amount"]);
      return {
        id: p.id, start: p.start, end: p.end, cover: periodCover(p, today), origin: p.origin, when: periodWhen(p, today), overlapsWith: over.get(p.id) ?? [],
        premium: { amount, currency: (row["premium_currency"] as string | null) ?? null, basis: (row["premium_basis"] as "gross" | "total_payable" | null) ?? null, source: amount === null ? "missing" : row["premium_verified_at"] ? "extracted_accepted" : p.verified ? "manually_recorded" : "unverified" },
        createdAt: row["created_at"] as string,
      };
    }),
    selectedPeriodId: reading.selectedPeriodId,
    selection: reading.selection,
    cover: reading.cover,
    conflicts: reading.conflicts,
    facts, terms,
    clientConditions: (placementView?.conditions ?? []).map((c) => ({ text: c.text, state: c.state, evidence: c.evidence?.label ?? null })),
    differences,
    issuance: app && placementView ? {
      placementId: app["placement_id"] as string, applicationId: app["id"] as string, appliedAt: app["applied_at"] as string,
      appliedByName: people.get(app["applied_by"] as string) ?? null, targetMode: app["target_mode"] as "create" | "update",
      links: {
        clientInstructionId: app["client_instruction_id"] as string, opportunityId: placementView.opportunity.id, comparisonVersion: placementView.instruction.comparisonVersion,
        insurerResponseId: app["insurer_response_id"] as string, coverConfirmationId: app["placement_insurer_response_id"] as string,
        documentId: app["document_id"] as string, issuedPolicyCheckId: app["issued_policy_check_id"] as string, issuanceRequestId: app["issuance_request_id"] as string,
      },
    } : null,
    documents, timeline, work, related, actions, gaps,
    money: { statement: MONEY_STATEMENT },
    permissions: { canStartWork: canEdit, canEdit },
    preparedActions: ((preparedQ.data ?? []) as Row[]).map((r) => ({
      id: r["id"] as string, actionType: r["action_type"] as string, state: r["state"] as string, changes: (r["changes"] as string[]) ?? [], blockers: (r["blockers"] as string[]) ?? [],
      permitted: Boolean(r["permitted"]), expiresAt: r["expires_at"] as string, receipt: (r["receipt"] as { message: string; at: string } | null) ?? null,
    })),
  };
}

/** One reason-keyed Work item while periods overlap; resolved once they no longer do. */
async function syncOverlapWork(db: SupabaseClient, org: string, w: { policyId: string; clientId: string; insurerId: string; classOfBusiness: string; title: string }, overlapping: boolean) {
  if (overlapping) {
    await db.rpc("work_item_ensure", {
      p_organization_id: org, p_source_type: "policy", p_source_id: w.policyId, p_reason_code: OVERLAP_REASON, p_kind: "exception",
      p_title: `${w.title} — settle overlapping periods`,
      p_reason: "Two periods on this policy overlap. Only one can be on cover for any day, and ASAP does not choose.",
      p_required_action: "Check the insurer's documents and correct the period that is wrong.",
      p_evidence_needed: "The insurer's schedule or confirmation for each period.",
      p_outcome_after: "The policy states its cover again once one period covers each day.",
      p_task_status: "needs_you", p_task_party: null, p_task_since: null, p_task_next_check: null, p_owner_id: null,
      p_client_id: w.clientId, p_insurer_id: w.insurerId, p_class_of_business: w.classOfBusiness,
    });
  } else {
    await db.rpc("work_item_resolve", { p_organization_id: org, p_source_type: "policy", p_source_id: w.policyId, p_reason_code: OVERLAP_REASON });
  }
}

/** Everything a prepared policy action rests on: moving any makes it stale. */
export function policyFingerprint(v: PolicySpaceResponse): { versions: Record<string, unknown>; fingerprint: string } {
  const versions = {
    periods: v.periods.map((p) => `${p.id}:${p.start}:${p.end}`),
    cover: v.cover.state,
    openRenewal: v.work.filter((w) => w.kind === "renewal").map((w) => w.id),
  };
  return { versions, fingerprint: createHash("sha256").update(JSON.stringify(versions)).digest("hex") };
}

/**
 * Which documents can stand as proof of cover once reviewed and applied to a period: the insurer's
 * schedule or certificate. A logbook, a proposal, a client's request, a quotation or an email is
 * information about a risk, never confirmation that an insurer covers it.
 */
export const COVER_DOCUMENT_KINDS: readonly string[] = ["policy_schedule", "certificate"];
export function documentProvesCover(kind: string | null | undefined): boolean {
  return COVER_DOCUMENT_KINDS.includes(kind ?? "");
}

/** A period is verified only by the insurer's confirmation, its issued policy, or a reviewed schedule/certificate. */
export function evidenceVerifiesCover(evidence: { kind: string }[]): boolean {
  return evidence.some((x) => x.kind === "cover_confirmation" || x.kind === "issued_document" || x.kind === "document");
}
