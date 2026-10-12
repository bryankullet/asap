import { createHash } from "node:crypto";
import {
  ENDORSEMENT_KIND_LABELS,
  HOLDER_LABELS,
  LIVING_REGISTRY,
  WORK_ITEM_COLUMNS,
  WorkItemRow,
  type ClaimDetail,
  type EndorsementDetail,
  type LivingAction,
  type LivingBlock,
  type LivingSurface,
  type WorkflowDetail,
} from "@asap/schema";
import { hasPermission } from "../context.js";
import { HttpError, mapDatabaseError } from "../errors.js";
import type { Env } from "../placement/service.js";
import { loadWorkflowDetail } from "../routes/workflows.js";
import { loadClaimDetail, loadEndorsementDetail } from "../servicing.js";
import type { Unavailable } from "./facts.js";
import { loadCollaboration, mergeUnavailable, placeCollaboration, type Collaboration } from "./intelligence.js";

/**
 * Living workspaces for claims and policy changes (D-161), on the same contract, registry,
 * validator and renderer as the renewal workspace. Each is composed from the loaders the existing
 * claim and endorsement screens use, plus the run's own steps; its governed steps (a document
 * received, the insurer's decision on an item) go through the endpoints that already own them.
 *
 * Two rules from §45 are visible here. ASAP never decides cover: an unreviewed claim says so, it
 * does not guess. And three claim facts stay three facts: an offer is not acceptance, and
 * acceptance is not payment — each is done only when its own reference is on file.
 */

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const DAY = 86_400_000;
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }) : null);
/** Everything on file for this client, in one workspace (D-167). */
const acrossClient = (f: ServicingFacts): LivingAction | null => (f.client ? { kind: "open", label: "Everything for this client", ref: { ws: "investigation", clientId: f.client.id }, primary: false } : null);
const block = (id: string, component: LivingBlock["component"], role: LivingBlock["role"], title: string | null, props: Record<string, unknown>, actions: (LivingAction | null)[] = []): LivingBlock => {
  const a = actions.filter((x): x is LivingAction => !!x).slice(0, 4);
  return { id, component, version: LIVING_REGISTRY[component].version, role, title, props, evidence: [], actions: a, hash: hash({ props, a }) };
};

export type ServicingFacts = {
  item: WorkItemRow;
  client: { id: string; name: string } | null;
  run: WorkflowDetail | null;
  policy: { number: string | null; insurer: string | null; classOfBusiness: string | null } | null;
  claim: ClaimDetail | null;
  endorsement: EndorsementDetail | null;
  premium: { direction: string; amount: string | null; currency: string | null; reference: string | null } | null;
  canAct: boolean;
  unavailable: Unavailable[];
  /** Arrived email, handover and related work (D-166). Absent in pure fixtures. */
  collab?: Collaboration | null;
};

export async function loadServicingFacts(env: Env, item: WorkItemRow): Promise<ServicingFacts> {
  const { db, organizationId: org } = env;
  const gaps: Unavailable[] = [];
  const soft = async <T>(part: Unavailable["part"], p: PromiseLike<T>): Promise<T | null> => {
    try { return await p; } catch (e) { gaps.push({ part, reason: e instanceof HttpError && (e.status === 403 || e.status === 404) ? "restricted" : "failed" }); return null; }
  };
  const [client, runRows] = await Promise.all([
    item.client_id ? db.from("clients").select("id, name").eq("organization_id", org).eq("id", item.client_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from("workflow_runs").select("id").eq("organization_id", org).eq("work_item_id", item.id).order("started_at", { ascending: false }).limit(1),
  ]);
  if (client.error) gaps.push({ part: "client", reason: "failed" });
  if (runRows.error) gaps.push({ part: "run", reason: "failed" });
  const runId = ((runRows.data ?? []) as { id: string }[])[0]?.id ?? null;
  const run = runId ? await soft("run", loadWorkflowDetail(db, runId, { canApprove: hasPermission(env.ctx, "email", "approve"), canAct: hasPermission(env.ctx, "space", "create") })) : null;
  const claim = item.kind === "claim" ? await soft("quotation", loadClaimDetail(db, item.id)) : null;
  const endorsement = item.kind === "endorsement" ? await soft("quotation", loadEndorsementDetail(db, item.id)) : null;
  const policyId = claim?.claim.policy_id ?? endorsement?.endorsement.policy_id ?? null;
  let policy: ServicingFacts["policy"] = null;
  if (policyId) {
    const p = await db.from("policies").select("policy_number, class_of_business, insurers(name)").eq("organization_id", org).eq("id", policyId).maybeSingle();
    if (p.error) gaps.push({ part: "period", reason: "failed" });
    const row = p.data as unknown as { policy_number: string | null; class_of_business: string | null; insurers: { name: string } | null } | null;
    if (row) policy = { number: row.policy_number, insurer: row.insurers?.name ?? null, classOfBusiness: row.class_of_business };
  }
  let premium: ServicingFacts["premium"] = null;
  if (endorsement) {
    const a = await db.from("endorsement_premium_adjustments").select("direction, amount, currency, reference, recorded_at").eq("organization_id", org).eq("endorsement_id", endorsement.endorsement.id).order("recorded_at", { ascending: false }).limit(1);
    if (a.error) gaps.push({ part: "placement", reason: (a.error as { code?: string }).code === "42501" ? "restricted" : "failed" });
    const row = ((a.data ?? []) as { direction: string; amount: string | null; currency: string | null; reference: string | null }[])[0];
    if (row) premium = { direction: row.direction, amount: row.amount != null ? String(row.amount) : null, currency: row.currency, reference: row.reference };
  }
  // Offered exactly where the database will allow it (0085, D-164): claim:edit for claims, policy:edit for policy changes.
  const canAct = item.kind === "claim" ? hasPermission(env.ctx, "claim", "edit") : hasPermission(env.ctx, "policy", "edit");
  const collab = await loadCollaboration(env, [], { item, subjectIds: [claim?.claim.id ?? "", endorsement?.endorsement.id ?? ""], policyId, waitingOn: [], canRecordResponse: false });
  return { item, client: (client.data as { id: string; name: string } | null) ?? null, run, policy, claim, endorsement, premium, canAct, unavailable: gaps, collab };
}

export async function loadWorkItem(env: Env, workItemId: string): Promise<WorkItemRow> {
  const w = await env.db.from("work_items").select(WORK_ITEM_COLUMNS).eq("organization_id", env.organizationId).eq("id", workItemId).is("deleted_at", null).maybeSingle();
  if (w.error) throw mapDatabaseError(w.error);
  if (!w.data) throw new HttpError(404, "not_found", "That work is not available.");
  return WorkItemRow.parse(w.data);
}

const STEP_STATE: Record<string, "done" | "now" | "next" | "waiting" | "stopped" | "skipped"> = { done: "done", running: "now", waiting: "waiting", failed: "stopped", skipped: "skipped", pending: "next" };
function journey(f: ServicingFacts, fallback: string) {
  const op = f.run?.operational;
  return block("journey", "WorkJourney", "lead", null, {
    steps: (f.run?.steps ?? []).slice(0, 16).map((s) => ({ key: s.key.slice(0, 60), label: s.label.slice(0, 200), state: STEP_STATE[s.state] ?? "next" })),
    summary: (op ? `${op.currentWork.title}. ${op.completed}` : fallback).slice(0, 500),
  });
}
function nextFromRun(f: ServicingFacts) {
  const op = f.run?.operational;
  if (!f.run || !op) return [];
  if (f.run.state === "exception") return [{ id: "run-exception", title: (f.run.exception?.message ?? "ASAP stopped and needs a person").slice(0, 500), why: (f.run.exception?.needs ?? "The work cannot continue until this is resolved.").slice(0, 500), responsible: op.owner?.name ?? null, deadline: null, actionableNow: f.canAct, requiresApproval: false, blockedBy: op.blockers.filter((b) => b.blocking).map((b) => b.label.slice(0, 500)).slice(0, 6), tone: "red" as const }];
  if (op.needsFromYou) return [{ id: "run-needs", title: op.needsFromYou.slice(0, 500), why: (op.attentionReason ?? op.currentWork.detail).slice(0, 500), responsible: op.owner?.name ?? null, deadline: op.nextFollowUpAt, actionableNow: f.canAct, requiresApproval: false, blockedBy: [], tone: "gold" as const }];
  return [];
}
function obligationsFromRun(f: ServicingFacts) {
  const op = f.run?.operational;
  const out: { party: string; what: string; since: string | null; due: string | null; kind: "outside" | "brokerage" | "asap" }[] = [];
  if (op?.waitingFor) out.push({ party: op.waitingFor.party.slice(0, 200), what: op.currentWork.title.slice(0, 500), since: op.waitingFor.since, due: op.nextFollowUpAt, kind: "outside" });
  if (f.run?.state === "running") out.push({ party: "ASAP", what: (op?.currentWork.title ?? "Working on it").slice(0, 500), since: null, due: null, kind: "asap" });
  return out;
}
const openSteps = (f: ServicingFacts): LivingAction | null => (f.run ? { kind: "open", label: "Open the steps", ref: { ws: "workitem", workItemId: f.item.id }, primary: false } : null);

function surface(f: ServicingFacts, purpose: "claim" | "endorsement", composed: LivingBlock[], now: Date, aiAvailable: boolean): LivingSurface {
  const blocks = placeCollaboration(composed, f.collab, f.item, purpose);
  return {
    version: 1, surfaceId: `${purpose}:${f.item.id}`, purpose, subject: { kind: "work_item", id: f.item.id, title: f.item.title.slice(0, 200) }, stage: null,
    generatedAt: now.toISOString(), fingerprint: hash([blocks.map((b) => [b.id, b.hash]), f.unavailable, f.collab?.unavailable ?? []]), blocks, ai: { available: aiAvailable },
    unavailable: mergeUnavailable(f.unavailable.map((g) => ({ part: g.part === "quotation" ? (purpose === "claim" ? "The claim" : "The policy change") : g.part === "period" ? "The policy" : g.part === "run" ? "The workflow" : g.part === "placement" ? "The premium adjustment" : "The client", reason: g.reason })), f.collab),
  };
}

export function composeClaimSurface(f: ServicingFacts, opts: { now: Date; aiAvailable: boolean }): LivingSurface {
  const d = f.claim;
  const blocks: LivingBlock[] = [];
  const c = d?.claim;
  const status = !c ? { label: "Not readable", tone: "grey" as const } : c.status === "draft" ? { label: "Draft — not registered", tone: "gold" as const } : c.status === "registered" ? { label: "Registered with the insurer", tone: "green" as const } : { label: "Closed", tone: "grey" as const };
  const clock = d?.clock;
  const daysLeft = clock?.started ? Math.ceil((new Date(`${clock.dueOn}T23:59:59Z`).getTime() - opts.now.getTime()) / DAY) : null;
  blocks.push(block("header", "ContextHeader", "lead", null, {
    eyebrow: "Claim", title: f.item.title.slice(0, 200), client: f.client,
    facts: [
      ...(c ? [{ label: "Incident", value: fmt(c.incident_on)! }] : []),
      ...(f.policy ? [{ label: "Policy", value: `${f.policy.number ?? "No number"}${f.policy.insurer ? ` · ${f.policy.insurer}` : ""}`.slice(0, 500) }] : []),
      ...(c ? [{ label: "Insurer reference", value: c.insurer_reference ?? "Not registered yet" }] : []),
      ...(clock?.started ? [{ label: "Notice due", value: `${fmt(clock.dueOn)} · ${daysLeft! >= 0 ? `${daysLeft} days left` : `${-daysLeft!} days late`}` }] : []),
    ].slice(0, 6),
    status, owner: f.run?.operational.owner?.name ?? null,
  }, [openSteps(f), acrossClient(f)]));
  blocks.push(journey(f, c ? (c.status === "draft" ? "A draft claim. Nothing has been sent to the insurer." : "The claim is with the insurer.") : "The claim could not be read."));

  const outstanding = (d?.documents ?? []).filter((x) => !x.received_at);
  const next = [
    ...nextFromRun(f),
    ...(outstanding.length ? [{ id: "documents", title: `${outstanding.length} document${outstanding.length === 1 ? "" : "s"} still to collect`, why: "The insurer assesses the claim on the documents it holds. Each one is recorded with its reference when it arrives.", responsible: null, deadline: clock?.started ? clock.dueOn : null, actionableNow: f.canAct, requiresApproval: false, blockedBy: [], tone: "gold" as const }] : []),
    ...(clock && !clock.started ? [{ id: "clock", title: "Set the notice clock from the policy wording", why: clock.reason.slice(0, 500), responsible: null, deadline: null, actionableNow: f.canAct, requiresApproval: false, blockedBy: [], tone: "gold" as const }] : []),
  ].slice(0, 6);
  if (next.length) blocks.push(block("next", "ProgressOpportunity", "main", "What moves this forward", { items: next }));

  if (d) {
    const receive = f.canAct
      ? outstanding.slice(0, 3).map((x): LivingAction => ({
          kind: "command", label: `Record “${x.label}” received`.slice(0, 200), command: "claim.receive_document", target: c!.id, tone: "default", confirm: null,
          payload: { action: "receive_document", documentId: x.id },
          inputs: [{ name: "reference", label: "What proves it arrived", kind: "text", required: true, options: [], hint: "e.g. emailed by the client on 12 Oct, filed as KDA-482A-logbook.pdf" }],
        }))
      : [];
    blocks.push(block("documents", "WorkChecklist", "main", "Documents", {
      items: d.documents.slice(0, 40).map((x) => ({ key: x.id, label: x.label.slice(0, 200), detail: x.reference?.slice(0, 500) ?? null, state: x.received_at ? "done" : "outstanding", party: x.received_at ? null : `With ${HOLDER_LABELS[x.holder as keyof typeof HOLDER_LABELS] ?? x.holder}`, since: x.received_at ?? x.requested_at })),
      note: d.documents.length ? null : "No documents are listed for this claim yet.",
    }, receive));
    blocks.push(block("settlement", "WorkChecklist", "main", "Offer, acceptance and payment", {
      items: [
        { key: "offer", label: "Insurer's offer", detail: c!.offer_reference?.slice(0, 500) ?? null, state: c!.offer_reference ? "done" : "outstanding", party: null, since: c!.offer_recorded_at },
        { key: "acceptance", label: "Client's acceptance", detail: c!.acceptance_reference?.slice(0, 500) ?? null, state: c!.acceptance_reference ? "done" : "outstanding", party: null, since: c!.acceptance_recorded_at },
        { key: "payment", label: "Payment received", detail: c!.payment_reference?.slice(0, 500) ?? null, state: c!.payment_reference ? "done" : "outstanding", party: null, since: c!.payment_recorded_at },
      ],
      note: "Three separate facts, each done only when its own reference is on file: an offer is not acceptance, and acceptance is not payment.",
    }));
  }

  const cons: { certainty: "confirmed" | "potential" | "missing"; text: string }[] = [];
  if (clock?.started) cons.push({ certainty: daysLeft! < 0 ? "confirmed" : "potential", text: `${daysLeft! < 0 ? "Notice was due" : "Notice must reach the insurer by"} ${fmt(clock.dueOn)} under ${clock.clause} (page ${clock.page}).`.slice(0, 500) });
  if (c && !c.cover_review) cons.push({ certainty: "missing", text: "Cover has not been reviewed against the policy wording. ASAP does not decide cover; the insurer does." });
  if (c?.status === "draft") cons.push({ certainty: "confirmed", text: "This is a draft: the insurer has not been told about the loss through ASAP." });
  if (c && !c.policy_period_id) cons.push({ certainty: "missing", text: "No policy period is matched to the incident date yet." });
  if (cons.length) blocks.push(block("consequences", "ConsequencePanel", "side", "What this means", { items: cons.slice(0, 8) }));
  const obs = [...obligationsFromRun(f), ...outstanding.slice(0, 4).map((x) => ({ party: (HOLDER_LABELS[x.holder as keyof typeof HOLDER_LABELS] ?? x.holder).replace(/^the /, "").replace(/^\w/, (m) => m.toUpperCase()).slice(0, 200), what: x.label.slice(0, 500), since: x.requested_at, due: null, kind: "outside" as const }))];
  if (obs.length) blocks.push(block("obligations", "ObligationTracker", "side", "Who holds the next step", { items: obs.slice(0, 10) }));
  if (d?.notes.length) blocks.push(block("recent", "Timeline", "side", "Notes and calls", { events: d.notes.slice(0, 10).map((n) => ({ at: n.noted_at, text: `${n.kind === "call_note" ? `Call with ${n.spoke_with ?? "someone"}` : "Note"}: ${n.body}`.slice(0, 500), actor: null })) }));
  return surface(f, "claim", blocks, opts.now, opts.aiAvailable);
}

export function composeEndorsementSurface(f: ServicingFacts, opts: { now: Date; aiAvailable: boolean }): LivingSurface {
  const d = f.endorsement;
  const e = d?.endorsement;
  const blocks: LivingBlock[] = [];
  const decided = (e?.items ?? []).filter((i) => i.decision !== "pending").length;
  const applied = Boolean(e?.applied_version_id);
  blocks.push(block("header", "ContextHeader", "lead", null, {
    eyebrow: "Policy change", title: f.item.title.slice(0, 200), client: f.client,
    facts: [
      ...(e?.kind ? [{ label: "Change", value: ENDORSEMENT_KIND_LABELS[e.kind] }] : []),
      ...(f.policy ? [{ label: "Policy", value: `${f.policy.number ?? "No number"}${f.policy.insurer ? ` · ${f.policy.insurer}` : ""}`.slice(0, 500) }] : []),
      ...(e ? [{ label: "Effective", value: fmt(e.effective_on) ?? "Not set" }] : []),
      ...(e ? [{ label: "Insurer decisions", value: `${decided} of ${e.items.length}` }] : []),
    ].slice(0, 6),
    status: applied ? { label: "Applied to the policy", tone: "green" } : e?.response_reference ? { label: "Insurer has answered", tone: "gold" } : { label: "Not yet decided by the insurer", tone: "gold" },
    owner: f.run?.operational.owner?.name ?? null,
  }, [openSteps(f), acrossClient(f)]));
  blocks.push(journey(f, e ? "The requested change, item by item, waits for the insurer's written decision." : "The policy change could not be read."));
  const next = [...nextFromRun(f), ...(d?.missing.length ? [{ id: "missing", title: "Complete what the request still needs", why: d.missing.join(" ").slice(0, 500), responsible: null, deadline: null, actionableNow: f.canAct, requiresApproval: false, blockedBy: d.missing.map((m) => m.slice(0, 500)).slice(0, 6), tone: "gold" as const }] : [])].slice(0, 6);
  if (next.length) blocks.push(block("next", "ProgressOpportunity", "main", "What moves this forward", { items: next }));
  if (e) {
    const decide = f.canAct
      ? e.items.filter((i) => i.decision === "pending").slice(0, 3).map((i): LivingAction => ({
          kind: "command", label: `Record the insurer's decision on “${i.label}”`.slice(0, 200), command: "endorsement.decide_item", target: e.id, tone: "default", confirm: null,
          payload: { action: "decide_item", itemId: i.id },
          inputs: [
            { name: "decision", label: "The insurer's decision", kind: "select", required: true, options: [{ value: "accepted", label: "Accepted" }, { value: "rejected", label: "Rejected" }], hint: null },
            { name: "responseReference", label: "Where they said so", kind: "text", required: true, options: [], hint: "Their email or letter reference — the decision must be in writing." },
            { name: "note", label: "Their note (optional)", kind: "textarea", required: false, options: [], hint: null },
          ],
        }))
      : [];
    blocks.push(block("items", "WorkChecklist", "main", "What was asked, item by item", {
      items: e.items.slice(0, 40).map((i) => ({ key: i.id.slice(0, 80), label: i.label.slice(0, 200), detail: `${i.before ?? "New"} → ${i.after ?? "Removed"}${i.note ? ` · Insurer: ${i.note}` : ""}`.slice(0, 500), state: i.decision === "accepted" ? "done" : i.decision === "rejected" ? "rejected" : "pending", party: i.decision === "pending" ? "With the insurer" : null, since: null })),
      note: "Each item is decided by the insurer in writing; the policy changes only when the accepted items are applied as a new version.",
    }, decide));
  }
  const cons: { certainty: "confirmed" | "potential" | "missing"; text: string }[] = [];
  if (e && !applied) cons.push({ certainty: "confirmed", text: "The policy has not changed yet: a request is not a change until the insurer's accepted items are applied." });
  if (applied) cons.push({ certainty: "confirmed", text: "The accepted items are applied to the policy as a new version." });
  if (f.premium) cons.push({ certainty: "confirmed", text: (f.premium.direction === "none" ? "The insurer said no premium adjustment applies" : `A ${f.premium.direction === "additional" ? "additional" : "return"} premium of ${f.premium.currency ?? ""} ${f.premium.amount ?? "(amount not stated)"} is recorded`).trim() + (f.premium.reference ? ` (${f.premium.reference}).` : ".") });
  else if (e && decided > 0) cons.push({ certainty: "missing", text: "No premium adjustment is recorded yet — none is assumed." });
  for (const m of (d?.missing ?? []).slice(0, 3)) cons.push({ certainty: "missing", text: m.slice(0, 500) });
  if (cons.length) blocks.push(block("consequences", "ConsequencePanel", "side", "What this means", { items: cons.slice(0, 8) }));
  const obs = obligationsFromRun(f);
  if (obs.length) blocks.push(block("obligations", "ObligationTracker", "side", "Who holds the next step", { items: obs }));
  return surface(f, "endorsement", blocks, opts.now, opts.aiAvailable);
}
