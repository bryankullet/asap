import { createHash } from "node:crypto";
import {
  placementActionSchema,
  recordInstructionRequestSchema,
  type PlacementAction,
  type PlacementResponse,
  type PrepareActionRequest,
  type PrepareActionResponse,
  type PreparedActionType,
  type PreparedActionView,
  type ConfirmPreparedActionResponse,
} from "@asap/schema";
import { hasPermission } from "../context.js";
import { HttpError } from "../errors.js";
import { loadComparisonView } from "../routes/comparisons.js";
import {
  approversOf,
  executePlacementAction,
  executeRecordInstruction,
  fingerprintOf,
  load,
  names,
  toPreparedView,
  type Env,
} from "./service.js";

/**
 * Prepared actions (4B-4A): what Ask — or a screen — asks ASAP to do, held on the server until a
 * person confirms it.
 *
 *   instruction → resolve the placement and its evidence → validate the facts → prepare an exact,
 *   typed action → show what will change → a person confirms → the same validated action the
 *   screen uses executes → Work and the placement update → a receipt and an audit row are written.
 *
 * Nothing is guessed. A name ("Jubilee", "Mary") is resolved exactly against this brokerage's own
 * records or not at all; a missing fact is one short question, never a default. A prepared action
 * records the versions of everything it was built from, and if any moves before confirmation it
 * is refused as stale rather than run against facts the person never saw.
 */

const VALID_FOR_MS = 24 * 60 * 60 * 1000;

type Clarify = Extract<PrepareActionResponse, { state: "clarify" }>;
const clarify = (question: string, missing: string[], options: Clarify["options"] = []): PrepareActionResponse => ({
  state: "clarify",
  question,
  missing,
  options,
});
const refused = (reason: string): PrepareActionResponse => ({ state: "refused", reason });

const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Evidence a person gave, carried into the action verbatim. Never composed. */
function evidenceOf(params: Record<string, unknown>) {
  return {
    ...(str(params["evidenceEmailMessageId"]) === undefined ? {} : { evidenceEmailMessageId: str(params["evidenceEmailMessageId"]) }),
    ...(str(params["evidenceDocumentId"]) === undefined ? {} : { evidenceDocumentId: str(params["evidenceDocumentId"]) }),
    ...(str(params["evidenceNote"]) === undefined ? {} : { evidenceNote: str(params["evidenceNote"]) }),
  };
}
const hasEvidence = (params: Record<string, unknown>) =>
  str(params["evidenceEmailMessageId"]) !== undefined ||
  str(params["evidenceDocumentId"]) !== undefined ||
  (str(params["evidenceNote"])?.length ?? 0) >= 10;

/* =============================================================================================
 * Preparing.
 * ============================================================================================= */

export async function prepareAction(env: Env, req: PrepareActionRequest): Promise<PrepareActionResponse> {
  if (req.actionType === "record_instruction") return prepareInstruction(env, req);
  if (req.placementId === undefined) {
    return clarify("Which placement is this about? Open it, or name the client and insurer.", ["placementId"]);
  }
  const view = await load(env.db, env.ctx, env.organizationId, req.placementId);
  const built = await buildPlacementAction(env, view, req);
  if ("state" in built) return built;
  return store(env, {
    actionType: req.actionType,
    placementId: view.placement.id,
    opportunityId: view.opportunity.id,
    payload: built.payload,
    ...fingerprintOf(view),
    summary: built.summary,
    changes: built.changes,
    blockers: blockersFor(view, req.actionType),
    permitted: permittedFor(env, req.actionType),
  });
}

async function prepareInstruction(env: Env, req: PrepareActionRequest): Promise<PrepareActionResponse> {
  if (req.opportunityId === undefined) return clarify("Which quotation work did the client answer?", ["opportunityId"]);
  const view = await loadComparisonView(env.db, env.ctx, env.organizationId, req.opportunityId);
  const comparison = view.comparison;
  if (comparison === null) return refused("No comparison has been made for this quotation work, so there is nothing the client could have chosen from.");

  const options = comparison.columns.map((c) => ({ label: c.insurerName, value: c.insurerName }));
  if (req.insurerName === undefined) return clarify("Which insurer did the client choose?", ["insurerName"], options);
  const matches = comparison.columns.filter((c) => same(c.insurerName, req.insurerName!));
  if (matches.length !== 1) {
    return clarify(
      matches.length === 0
        ? `"${req.insurerName}" is not one of the quotes the client was shown. Which did they choose?`
        : `More than one quote is from ${req.insurerName}. Which one?`,
      ["insurerName"],
      options,
    );
  }
  const column = matches[0]!;

  const p = req.params;
  const missing: string[] = [];
  if (str(p["source"]) === undefined) missing.push("source");
  if (!hasEvidence(p)) missing.push("evidence");
  if (str(p["instructedAt"]) === undefined) missing.push("instructedAt");
  if (str(p["requestedEffectiveAt"]) === undefined) missing.push("requestedEffectiveAt");
  if (missing.length > 0) {
    return clarify(
      `To record that the client chose ${column.insurerName}, say ${[
        missing.includes("source") || missing.includes("evidence") ? "how the instruction arrived (link the email, attach the document, or note the call)" : null,
        missing.includes("instructedAt") ? "when they gave it" : null,
        missing.includes("requestedEffectiveAt") ? "when cover should begin" : null,
      ].filter(Boolean).join(", ")}.`,
      missing,
    );
  }

  const parsed = recordInstructionRequestSchema.safeParse({
    insurerResponseId: column.responseId,
    source: str(p["source"]),
    instructedAt: str(p["instructedAt"]),
    requestedEffectiveAt: str(p["requestedEffectiveAt"]),
    ...(str(p["requestedExpiryAt"]) === undefined ? {} : { requestedExpiryAt: str(p["requestedExpiryAt"]) }),
    ...(str(p["clientConditions"]) === undefined ? {} : { clientConditions: str(p["clientConditions"]) }),
    ...evidenceOf(p),
  });
  if (!parsed.success) return refused(`That instruction could not be prepared: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")} is not valid.`);

  const fp = instructionFingerprint(view.comparison, await liveInstructionId(env, req.opportunityId));
  const blockers: string[] = [];
  if (!comparison.presentable.can) blockers.push(`The comparison cannot be relied on: ${comparison.presentable.reason ?? "it is out of date."}`);
  if (comparison.presentedAt === null) blockers.push("This comparison has not been recorded as sent to the client.");

  return store(env, {
    actionType: "record_instruction",
    placementId: null,
    opportunityId: req.opportunityId,
    payload: parsed.data,
    ...fp,
    summary: `Record that the client chose ${column.insurerName}`,
    changes: [
      `A client instruction for ${column.insurerName}'s quote (comparison version ${comparison.version}), with its evidence.`,
      `A placement with ${column.insurerName}, cover to begin ${day(parsed.data.requestedEffectiveAt)}.`,
      "What the client accepted is frozen from the quote as it stands.",
      "Work: prepare the placement request.",
    ],
    blockers,
    permitted: hasPermission(env.ctx, "placement", "create"),
  });
}

type Built = { payload: PlacementAction; summary: string; changes: string[] };

async function buildPlacementAction(env: Env, view: PlacementResponse, req: PrepareActionRequest): Promise<Built | PrepareActionResponse> {
  const p = req.params;
  const insurer = view.insurer.name;

  /* A named insurer must be this placement's insurer; ASAP does not quietly act on another. */
  if (req.insurerName !== undefined && !same(req.insurerName, insurer)) {
    return refused(`This placement is with ${insurer}, not ${req.insurerName}.`);
  }

  switch (req.actionType) {
    case "prepare_request": {
      const b = view.basis;
      const premium = b.premiumAmount === null ? "as quoted" : `${b.premiumCurrency ?? ""} ${Number(b.premiumAmount).toLocaleString("en-KE")}`.trim();
      const cover = str(p["coverRequested"]) ?? `${view.opportunity.classOfBusiness} cover for ${view.client.name}, on ${insurer}'s quoted terms`;
      const body =
        str(p["body"]) ??
        [
          "Dear Underwriter,",
          "",
          `On behalf of our client ${view.client.name}, please place ${view.opportunity.classOfBusiness} cover on the terms you quoted.`,
          `Premium: ${premium}. Cover to begin ${day(view.placement.requestedEffectiveAt)}${view.placement.requestedExpiryAt === null ? "" : ` and end ${day(view.placement.requestedExpiryAt)}`}.`,
          ...(b.clientConditions === null ? [] : [`The client's conditions: ${b.clientConditions}`]),
          "",
          "Please confirm cover in writing.",
          "",
          "Kind regards",
        ].join("\n");
      return {
        payload: {
          action: "prepare_request",
          subject: str(p["subject"]) ?? `Placement request — ${view.client.name} — ${view.opportunity.classOfBusiness}`,
          body,
          coverRequested: cover,
          ...(str(p["outstandingConditions"]) === undefined ? {} : { outstandingConditions: str(p["outstandingConditions"]) }),
        },
        summary: `Prepare the placement request to ${insurer}`,
        changes: [
          view.request === null ? "A draft placement request, version 1." : `A new version of the request, replacing version ${view.request.version}; its approval, if any, no longer applies.`,
          "Nothing is sent. The draft needs approval by someone permitted.",
        ],
      };
    }

    case "request_approval": {
      const approvers = await approversOf(env.db, env.organizationId);
      const options = approvers.map((a) => ({ label: a.name, value: a.name }));
      if (view.request === null) return refused("There is no placement request to approve yet. Prepare it first.");
      if (req.approverName === undefined) return clarify("Who should approve it?", ["approverName"], options);
      const found = approvers.filter((a) => same(a.name, req.approverName!));
      if (found.length !== 1) {
        return clarify(
          found.length === 0 ? `${req.approverName} may not approve placements here. Choose someone who may.` : `More than one person is called ${req.approverName}. Which one?`,
          ["approverName"],
          options,
        );
      }
      return {
        payload: { action: "request_approval", approverUserId: found[0]!.userId },
        summary: `Ask ${found[0]!.name} to approve the placement request`,
        changes: [`Work for ${found[0]!.name}: approve version ${view.request.version} of the request.`, "Nothing is approved by asking."],
      };
    }

    case "approve_request": {
      if (view.request === null) return refused("There is no placement request to approve.");
      return {
        payload: { action: "approve_request", placementRequestId: view.request.id },
        summary: `Approve version ${view.request.version} of the placement request`,
        changes: [`Approval of this exact version (${view.request.sha256.slice(0, 12)}…). A later edit needs approving again.`, "It is not sent by approving it."],
      };
    }

    case "record_submission": {
      if (view.request === null) return refused("There is no placement request to record as sent.");
      const missing: string[] = [];
      if (str(p["recipient"]) === undefined) missing.push("recipient");
      if (str(p["sentAt"]) === undefined) missing.push("sentAt");
      if (!hasEvidence(p)) missing.push("evidence");
      if (missing.length > 0) {
        return clarify(
          "To record that it was sent outside ASAP, say to whom, when, and how you know — attach the sent message or note from which mailbox it went.",
          missing,
        );
      }
      const method = str(p["method"]) ?? "recorded_manual_email";
      return {
        payload: {
          action: "record_submission",
          placementRequestId: view.request.id,
          method: method as "recorded_manual_email",
          recipient: str(p["recipient"])!,
          sentAt: str(p["sentAt"])!,
          ...(str(p["evidenceDocumentId"]) === undefined ? {} : { evidenceDocumentId: str(p["evidenceDocumentId"]) }),
          ...(str(p["evidenceNote"]) === undefined ? {} : { evidenceNote: str(p["evidenceNote"]) }),
          idempotencyKey: `prepared:${view.request.id}:${str(p["sentAt"])}`,
        },
        summary: `Record that the request went to ${insurer} on ${day(str(p["sentAt"])!)}`,
        changes: [
          `A record that version ${view.request.version} was sent to ${str(p["recipient"])}, by a person, outside ASAP.`,
          `Work: with ${insurer} from ${day(str(p["sentAt"])!)} — cover confirmation requested.`,
        ],
      };
    }

    case "record_insurer_response": {
      const outcome = str(p["outcome"]) ?? "confirmed_as_requested";
      const confirmed = outcome.startsWith("confirmed");
      const missing: string[] = [];
      if (str(p["receivedAt"]) === undefined) missing.push("receivedAt");
      if (confirmed && str(p["effectiveAt"]) === undefined) missing.push("effectiveAt");
      if (!hasEvidence(p)) missing.push("evidence");
      if (missing.length > 0) {
        return clarify(
          `To record ${insurer}'s answer, say ${[
            missing.includes("receivedAt") ? "when it arrived" : null,
            missing.includes("effectiveAt") ? "when cover begins" : null,
            missing.includes("evidence") ? "where it is (link the email, attach the letter, or note the call)" : null,
          ].filter(Boolean).join(", ")}.`,
          missing,
        );
      }
      const payload = {
        action: "record_insurer_response",
        outcome,
        receivedAt: str(p["receivedAt"]),
        ...(str(p["effectiveAt"]) === undefined ? {} : { effectiveAt: str(p["effectiveAt"]) }),
        ...(str(p["expiryAt"]) === undefined ? {} : { expiryAt: str(p["expiryAt"]) }),
        ...(str(p["insurerReference"]) === undefined ? {} : { insurerReference: str(p["insurerReference"]) }),
        ...(str(p["changesNote"]) === undefined ? {} : { changesNote: str(p["changesNote"]) }),
        ...(str(p["confirmedPremiumAmount"]) === undefined ? {} : { confirmedPremiumAmount: str(p["confirmedPremiumAmount"]) }),
        ...(str(p["informationRequired"]) === undefined ? {} : { informationRequired: str(p["informationRequired"]) }),
        ...(str(p["declineReason"]) === undefined ? {} : { declineReason: str(p["declineReason"]) }),
        ...(Array.isArray(p["termChanges"]) ? { termChanges: p["termChanges"] } : {}),
        ...evidenceOf(p),
      };
      const parsed = placementActionSchema.safeParse(payload);
      if (!parsed.success) return refused(`That answer could not be prepared: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")} is not valid.`);
      return {
        payload: parsed.data,
        summary: confirmed ? `Record that ${insurer} confirmed cover` : `Record ${insurer}'s answer`,
        changes: confirmed
          ? [
              `${insurer}'s confirmation, cover beginning ${day(str(p["effectiveAt"])!)}${outcome === "confirmed_with_changes" ? ", on changed terms" : ""}.`,
              "ASAP then checks the confirmation against what the client accepted, field by field.",
              "Nothing about the client's agreement is assumed from the insurer's answer.",
            ]
          : [`${insurer}'s answer: ${outcome === "declined" ? "declined" : "more information required"}.`],
      };
    }

    case "record_client_acceptance": {
      const m = view.coverMatch;
      if (m === null || !m.current) return refused("There is no current cover check for the client to answer. Check the confirmation first.");
      if (m.materialDifferences === 0) return refused("The confirmation matches what the client accepted; there is nothing for them to accept.");
      const decision = str(p["decision"]) ?? "accept_all";
      const missing: string[] = [];
      if (str(p["source"]) === undefined) missing.push("source");
      if (str(p["decidedAt"]) === undefined) missing.push("decidedAt");
      if (!hasEvidence(p)) missing.push("evidence");
      if (decision === "partial" && !Array.isArray(p["items"])) missing.push("items");
      if (missing.length > 0) {
        return clarify(
          `To record the client's answer to ${insurer}'s changes, say how it arrived, when, and where the evidence is${decision === "partial" ? ", and what they decided on each difference" : ""}.`,
          missing,
        );
      }
      const parsed = placementActionSchema.safeParse({
        action: "record_client_acceptance",
        coverMatchId: m.id,
        decision,
        source: str(p["source"]),
        decidedAt: str(p["decidedAt"]),
        ...(Array.isArray(p["items"]) ? { items: p["items"] } : {}),
        ...evidenceOf(p),
      });
      if (!parsed.success) return refused(`That decision could not be prepared: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")} is not valid.`);
      const labels = m.items.filter((i) => i.material).map((i) => i.label).join(", ");
      return {
        payload: parsed.data,
        summary:
          decision === "accept_all"
            ? `Record that the client accepted ${insurer}'s changes`
            : decision === "reject"
              ? `Record that the client rejected ${insurer}'s changes`
              : `Record the client's partial answer to ${insurer}'s changes`,
        changes:
          decision === "accept_all"
            ? [
                `The client's acceptance of: ${labels}.`,
                "A new client instruction, keeping the original.",
                `What the client accepted becomes version ${view.basis.version + 1}, from ${insurer}'s confirmation; the cover is checked again.`,
              ]
            : [
                `The client's decision on: ${labels}. What the client accepted does not change.`,
                "Cover stays as the insurer confirmed it. Policy issuance stays blocked.",
                "A draft to the insurer is prepared. It is not sent.",
              ],
      };
    }

    case "prepare_issuance":
      return {
        payload: { action: "prepare_issuance" },
        summary: "Prepare policy issuance",
        changes: ["Work: issue the policy from the confirmed cover. No policy is created now."],
      };

    case "record_instruction":
      return refused("An instruction is recorded against the quotation work, not a placement.");
  }
}

function permittedFor(env: Env, type: PreparedActionType): boolean {
  switch (type) {
    case "record_instruction":
    case "record_client_acceptance":
      return hasPermission(env.ctx, "placement", "create");
    case "approve_request":
      return hasPermission(env.ctx, "placement", "approve");
    case "record_submission":
      return hasPermission(env.ctx, "placement", "send_external");
    default:
      return hasPermission(env.ctx, "placement", "edit");
  }
}

/** What will stop it, known now. Confirmation re-runs every check regardless. */
function blockersFor(view: PlacementResponse, type: PreparedActionType): string[] {
  const out: string[] = [];
  if (view.instruction.supersededAt !== null && type !== "record_client_acceptance") out.push("The client's instruction behind this placement was superseded.");
  if (view.drift.stale && (type === "prepare_request" || type === "approve_request" || type === "record_submission")) {
    out.push("The quotation changed after the client accepted it.");
  }
  if (type === "approve_request" && view.request?.approval != null) out.push("This version is already approved.");
  if (type === "record_submission" && view.request?.approval == null) out.push("The request has not been approved. A draft cannot be recorded as sent.");
  if (type === "record_insurer_response" && view.request?.submission == null) out.push("Nothing has been sent to the insurer yet.");
  if (type === "prepare_issuance") out.push(...view.readiness.reasons.map((r) => r.message));
  return out;
}

async function liveInstructionId(env: Env, opportunityId: string): Promise<string | null> {
  const { data } = await env.db
    .from("client_instructions")
    .select("id")
    .eq("organization_id", env.organizationId)
    .eq("opportunity_id", opportunityId)
    .is("superseded_at", null)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

function instructionFingerprint(
  comparison: { id: string; version: number; stale: boolean; presentedAt: string | null } | null,
  liveInstruction: string | null,
) {
  const versions = {
    comparison: comparison?.id ?? null,
    comparisonVersion: comparison?.version ?? null,
    comparisonStale: comparison?.stale ?? null,
    presentedAt: comparison?.presentedAt ?? null,
    liveInstruction,
  };
  return { versions, fingerprint: createHash("sha256").update(JSON.stringify(versions)).digest("hex") };
}

async function store(
  env: Env,
  a: {
    actionType: PreparedActionType;
    placementId: string | null;
    opportunityId: string | null;
    payload: unknown;
    versions: Record<string, unknown>;
    fingerprint: string;
    summary: string;
    changes: string[];
    blockers: string[];
    permitted: boolean;
  },
): Promise<PrepareActionResponse> {
  if (!a.permitted) {
    /* Prepared anyway, so the person sees exactly what it would do — and that they may not. */
    a.blockers = [...a.blockers, "You may not do this. Someone with the permission must confirm it."];
  }
  const idempotencyKey = createHash("sha256")
    .update([env.userId, a.actionType, a.placementId ?? a.opportunityId, a.fingerprint, JSON.stringify(a.payload)].join("|"))
    .digest("hex");

  const existing = await env.db
    .from("prepared_actions")
    .select("*")
    .eq("organization_id", env.organizationId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.data) return { state: "prepared", action: await viewOf(env, existing.data as Record<string, unknown>) };

  const inserted = await env.db
    .from("prepared_actions")
    .insert({
      organization_id: env.organizationId,
      placement_id: a.placementId,
      opportunity_id: a.opportunityId,
      action_type: a.actionType,
      payload: a.payload,
      source_versions: a.versions,
      fingerprint: a.fingerprint,
      changes: [a.summary, ...a.changes],
      blockers: a.blockers,
      permitted: a.permitted,
      requires_confirmation: true,
      idempotency_key: idempotencyKey,
      prepared_by: env.userId,
      expires_at: new Date(Date.now() + VALID_FOR_MS).toISOString(),
    })
    .select("*")
    .maybeSingle();
  if (inserted.error || !inserted.data) return refused("The action could not be prepared. Try again.");
  const row = inserted.data as Record<string, unknown>;
  await env.audit({
    action: "prepared_action.prepared",
    objectType: "prepared_action",
    objectId: row["id"] as string,
    result: "success",
    newState: { actionType: a.actionType, placementId: a.placementId, opportunityId: a.opportunityId, fingerprint: a.fingerprint },
  });
  return { state: "prepared", action: await viewOf(env, row) };
}

async function viewOf(env: Env, row: Record<string, unknown>): Promise<PreparedActionView> {
  return toPreparedView(row, await names(env.db, [row["prepared_by"] as string, row["decided_by"] as string]));
}

/* =============================================================================================
 * Confirming.
 * ============================================================================================= */

async function readRow(env: Env, id: string): Promise<Record<string, unknown>> {
  const { data } = await env.db.from("prepared_actions").select("*").eq("organization_id", env.organizationId).eq("id", id).maybeSingle();
  if (!data) throw new HttpError(404, "not_found", "No prepared action with that id");
  return data as Record<string, unknown>;
}

async function decide(env: Env, id: string, state: "executed" | "stale" | "refused" | "discarded" | "expired", receipt: { message: string; at: string } | null) {
  const now = new Date().toISOString();
  const { data } = await env.db
    .from("prepared_actions")
    .update({
      state,
      decided_by: state === "expired" ? null : env.userId,
      decided_at: state === "expired" ? null : now,
      receipt,
    })
    .eq("organization_id", env.organizationId)
    .eq("id", id)
    .eq("state", "prepared")
    .select("*")
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

export async function confirmPreparedAction(env: Env, id: string): Promise<ConfirmPreparedActionResponse> {
  const row = await readRow(env, id);
  const state = row["state"] as string;
  if (state === "executed") return { outcome: "already", reason: null, action: await viewOf(env, row) };
  if (state !== "prepared") {
    return { outcome: "refused", reason: `This action was ${state === "stale" ? "out of date" : state} and cannot be confirmed. Prepare it again.`, action: await viewOf(env, row) };
  }

  const refuse = async (to: "stale" | "refused" | "expired", reason: string): Promise<ConfirmPreparedActionResponse> => {
    const after = await decide(env, id, to, null);
    await env.audit({
      action: `prepared_action.${to}`,
      objectType: "prepared_action",
      objectId: id,
      result: "denied",
      newState: { reason },
    });
    return { outcome: "refused", reason, action: await viewOf(env, after ?? (await readRow(env, id))) };
  };

  if (new Date(row["expires_at"] as string).getTime() <= Date.now()) {
    return refuse("expired", "This action was prepared too long ago. Prepare it again against the placement as it stands.");
  }

  const type = row["action_type"] as PreparedActionType;
  const placementId = (row["placement_id"] as string | null) ?? null;

  /* The facts it was built from must be the facts now. */
  let current: string;
  if (placementId === null) {
    const opportunityId = row["opportunity_id"] as string;
    const view = await loadComparisonView(env.db, env.ctx, env.organizationId, opportunityId);
    current = instructionFingerprint(view.comparison, await liveInstructionId(env, opportunityId)).fingerprint;
  } else {
    current = fingerprintOf(await load(env.db, env.ctx, env.organizationId, placementId)).fingerprint;
  }
  if (current !== row["fingerprint"]) {
    return refuse("stale", "The placement changed after this was prepared, so it was not run. Look at it as it stands and prepare it again.");
  }
  if (!permittedFor(env, type)) {
    return refuse("refused", "You may not do this. Someone with the permission must confirm it.");
  }

  /* The same validated path the screen uses. Its own checks run again, in full. */
  let outcome: { outcome: "done" | "already" | "blocked"; reason: string | null };
  if (type === "record_instruction") {
    const parsed = recordInstructionRequestSchema.parse(row["payload"]);
    outcome = await executeRecordInstruction(env, row["opportunity_id"] as string, parsed);
  } else {
    const parsed = placementActionSchema.parse(row["payload"]);
    outcome = await executePlacementAction(env, placementId!, parsed);
  }
  if (outcome.outcome === "blocked") return refuse("refused", outcome.reason ?? "It could not be done.");

  const receipt = {
    message: `${((row["changes"] as string[] | null) ?? [])[0] ?? "Done"}${outcome.outcome === "already" ? " — it had already been recorded; nothing was duplicated." : " — done."}`,
    at: new Date().toISOString(),
  };
  const after = await decide(env, id, "executed", receipt);
  await env.audit({
    action: "prepared_action.executed",
    objectType: "prepared_action",
    objectId: id,
    result: "success",
    newState: { actionType: type, placementId, outcome: outcome.outcome },
  });
  return { outcome: outcome.outcome === "already" ? "already" : "done", reason: null, action: await viewOf(env, after ?? (await readRow(env, id))) };
}

export async function discardPreparedAction(env: Env, id: string): Promise<ConfirmPreparedActionResponse> {
  const row = await readRow(env, id);
  if (row["state"] !== "prepared") return { outcome: "already", reason: null, action: await viewOf(env, row) };
  const after = await decide(env, id, "discarded", null);
  await env.audit({ action: "prepared_action.discarded", objectType: "prepared_action", objectId: id, result: "success", newState: {} });
  return { outcome: "done", reason: null, action: await viewOf(env, after ?? row) };
}
