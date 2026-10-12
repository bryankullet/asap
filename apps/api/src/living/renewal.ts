import { createHash } from "node:crypto";
import {
  LIVING_REGISTRY,
  RENEWAL_STAGES,
  type LivingAction,
  type LivingBlock,
  type LivingComponent,
  type LivingEvidence,
  type LivingSurface,
  type RenewalStage,
} from "@asap/schema";
import type { RenewalLivingFacts } from "./facts.js";

/**
 * The Living renewal surface (D-156), composed deterministically from the facts.
 *
 * Every derivation here reads a value the owning module already produced — the run's operational
 * reading, the quotation's derived stage per insurer, the placement's cover line, the issuance's
 * stage and check — and arranges it. Nothing is guessed: a premium is the stored amount; a cover
 * state is the server's cover reading; a consequence is "confirmed" only when records prove it,
 * "potential" when a relationship implies it, "missing" when a fact is absent. No model runs.
 *
 * The composition differs by stage, because the work does: insurer answers lead while terms are
 * awaited; the comparison and its revisions lead once there is something to compare; the placement
 * leads once a client has instructed; the cover check leads at issuance.
 */

const DAY = 86_400_000;
/** A source that could not be read — never to be presented as an absent fact (D-157). */
const gap = (f: RenewalLivingFacts, part: RenewalLivingFacts["unavailable"][number]["part"]) => f.unavailable.some((g) => g.part === part);
export const PART_WORDS: Record<RenewalLivingFacts["unavailable"][number]["part"], string> = {
  client: "The client", owner: "Who owns this work", run: "The renewal run", quotation: "The quotation", period: "The policy period",
  revisions: "Revised insurer answers", placement: "The placement", issuance: "The policy issuance", history: "Recent history",
};
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }) : null;
const money = (amount: string | null, currency: string | null) =>
  amount == null ? null : `${currency ?? ""} ${Number(amount).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim();
const ACTION_WORDS: [RegExp, string][] = [
  [/approv/, "approved"], [/reject/, "rejected"], [/prepar|draft/, "prepared"], [/deliver|sent|send/, "recorded as delivered"],
  [/record/, "recorded"], [/creat|open|start/, "opened"], [/assign/, "assigned"], [/follow|chase/, "followed up"], [/applied|apply/, "applied"],
];

/** The stage, from what the records say has happened — never from what a model believes. */
export function renewalStage(f: RenewalLivingFacts): RenewalStage {
  if (f.run?.state === "exception" || f.run?.state === "cancelled") return f.placement ? stageAfterQuotes(f) : "stopped";
  if (f.issuance?.stage === "applied") return "verified";
  if (f.placement) return stageAfterQuotes(f);
  const quoted = (f.opportunity?.insurers ?? []).filter((i) => i.stage === "quoted").length;
  const step = f.run?.currentStep ?? null;
  if (step === "hand_over" || f.run?.state === "done") return quoted ? "deciding" : "comparing";
  if (step === "compare" || quoted >= 1) return "comparing";
  if (step === "open_terms" || step === "await_terms" || (f.opportunity?.insurers ?? []).some((i) => i.stage === "with_insurer" || i.stage === "approved_to_deliver")) return "awaiting_terms";
  if (step === "pack" || step === "communications" || step === "approval") return "preparing";
  return "attention";
}
function stageAfterQuotes(f: RenewalLivingFacts): RenewalStage {
  if (f.issuance?.stage === "applied") return "verified";
  if (f.issuance && f.issuance.stage !== "not_ready") return "issuing";
  return "placing";
}

const openQuote = (f: RenewalLivingFacts): LivingAction | null => (f.opportunity ? { kind: "open", label: "Open the quotation", ref: { ws: "quote", opportunityId: f.opportunity.opportunity.id }, primary: false } : null);
const openRun = (f: RenewalLivingFacts, label = "Open the renewal steps"): LivingAction | null => (f.run ? { kind: "open", label, ref: { ws: "renewal", runId: f.run.id }, primary: false } : null);
const primary = (a: LivingAction | null): LivingAction | null => (a && a.kind === "open" ? { ...a, primary: true } : a);

/** What could move the work forward now: each with why, who holds it, and what blocks it. */
export function progressOpportunities(f: RenewalLivingFacts) {
  const items: { id: string; title: string; why: string; responsible: string | null; deadline: string | null; actionableNow: boolean; requiresApproval: boolean; blockedBy: string[]; tone: "green" | "gold" | "red" | "grey"; action: LivingAction | null }[] = [];
  const op = f.run?.operational;
  if (f.run && op) {
    if (f.run.state === "waiting_approval")
      items.push({ id: "run-approval", title: f.run.approval?.title ?? "Approve the renewal bundle", why: op.needsFromYou ?? "Nothing leaves the brokerage until a person approves its exact content.", responsible: op.owner?.name ?? null, deadline: f.period?.periodEnd ?? null, actionableNow: f.run.permissions.canApprove, requiresApproval: true, blockedBy: f.run.permissions.canApprove ? [] : ["Your role cannot approve; a principal officer can."], tone: "gold", action: primary(openRun(f, "Review the bundle")) });
    else if (f.run.state === "exception")
      items.push({ id: "run-exception", title: f.run.exception?.message ?? "ASAP stopped and needs a person", why: f.run.exception?.needs ?? "The renewal cannot continue until this is resolved.", responsible: op.owner?.name ?? null, deadline: f.period?.periodEnd ?? null, actionableNow: f.run.permissions.canAct, requiresApproval: false, blockedBy: op.blockers.filter((b) => b.blocking).map((b) => b.label), tone: "red", action: primary(openRun(f, "Resolve it")) });
    else if (op.needsFromYou)
      items.push({ id: "run-needs", title: op.needsFromYou, why: op.attentionReason ?? op.currentWork.detail, responsible: op.owner?.name ?? null, deadline: op.nextFollowUpAt, actionableNow: true, requiresApproval: false, blockedBy: op.blockers.filter((b) => b.blocking).map((b) => b.label), tone: "gold", action: primary(openRun(f)) });
  }
  const next = f.opportunity?.next;
  if (next && next.holder !== "outside_party" && !f.placement)
    items.push({ id: "quote-next", title: next.what, why: next.why, responsible: next.holder === "brokerage" ? "Your brokerage" : null, deadline: next.checkAt ?? null, actionableNow: next.holder === "brokerage", requiresApproval: /\bapprov(e|al)\b/i.test(next.what), blockedBy: next.missing, tone: next.missing.length ? "gold" : "green", action: primary(openQuote(f)) });
  if (f.placement && f.issuance?.stage !== "applied") {
    const p = f.placement;
    items.push({ id: "placement-next", title: f.issuance && f.issuance.stage !== "not_ready" ? issuanceWords(f.issuance.stage) : p.nextAction, why: p.cover.line, responsible: p.workItem.taskParty, deadline: p.placement.requestedEffectiveAt, actionableNow: p.workItem.taskStatus === "needs_you", requiresApproval: /\bapprov(e|al)\b/i.test(p.nextAction), blockedBy: [...p.blockers, ...(f.issuance?.readiness.state === "blocked" ? f.issuance.readiness.reasons.map((r) => r.message) : [])].slice(0, 6), tone: p.blockers.length ? "gold" : "green", action: primary(openQuote(f)) });
  }
  return items.slice(0, 4);
}

function issuanceWords(stage: string): string {
  return ({
    ready: "Prepare the request for the policy document",
    approval_required: "Approve the policy document request",
    submission_required: "Record how the approved request was sent",
    with_insurer: "The insurer is to issue the policy document",
    review_required: "Review what ASAP read from the issued policy",
    differences_to_resolve: "Resolve the differences between the issued policy and what was agreed",
    ready_to_apply: "Apply the checked policy to the record",
  } as Record<string, string>)[stage] ?? "Continue the issuance";
}

/** Who holds the next step, since when — outside parties named, colleagues named, ASAP's runs said. */
export function obligations(f: RenewalLivingFacts) {
  const out: { party: string; what: string; since: string | null; due: string | null; kind: "outside" | "brokerage" | "asap" }[] = [];
  const op = f.run?.operational;
  // Once a client has instructed, the placement holds the work: the run's earlier waiting is history.
  if (op?.waitingFor && !f.placement) out.push({ party: op.waitingFor.party, what: op.currentWork.title, since: op.waitingFor.since, due: op.nextFollowUpAt, kind: "outside" });
  for (const i of f.opportunity?.insurers ?? [])
    if (i.stage === "with_insurer" && !out.some((o) => o.party === i.insurerName))
      out.push({ party: i.insurerName, what: "Terms for the renewal", since: i.request?.approvedAt ?? i.addedAt, due: null, kind: "outside" });
  if (f.placement && f.placement.workItem.taskStatus === "with_party" && f.placement.workItem.taskParty)
    out.push({ party: f.placement.workItem.taskParty, what: f.issuance && f.issuance.stage !== "not_ready" ? issuanceWords(f.issuance.stage) : f.placement.nextAction, since: f.placement.workItem.taskSince, due: null, kind: "outside" });
  if (f.run && f.run.state === "running" && !f.placement) out.push({ party: "ASAP", what: op?.currentWork.title ?? "Working on the renewal", since: null, due: op?.nextFollowUpAt ?? null, kind: "asap" });
  if (f.item.task_status === "needs_you" && f.ownerName) out.push({ party: f.ownerName, what: f.item.required_action ?? "The next step on this renewal", since: f.item.task_since ?? null, due: f.item.due_on ?? null, kind: "brokerage" });
  return out.slice(0, 8);
}

/** Every insurer answer revised after it was first recorded: earlier and revised values, side by side. */
export function changes(f: RenewalLivingFacts) {
  const byInsurer = new Map<string, typeof f.revisions>();
  for (const r of f.revisions) byInsurer.set(r.insurerName, [...(byInsurer.get(r.insurerName) ?? []), r]);
  const out: { subject: string; field: string; earlier: string | null; revised: string | null; revision: number; receivedAt: string | null; affects: string[]; documentId: string | null }[] = [];
  const instructedAt = f.placement?.instruction.instructedAt ?? null;
  for (const [insurer, revs] of byInsurer) {
    if (revs.length < 2) continue;
    const prev = revs[revs.length - 2]!;
    const last = revs[revs.length - 1]!;
    const affects = ["The comparison shown to the client must be reviewed against this revision."];
    if (instructedAt && last.receivedAt && last.receivedAt > instructedAt) affects.push("It arrived after the client's instruction: the instruction was given on the earlier figures.");
    const pairs: [string, string | null, string | null][] = [
      ["Premium", money(prev.premiumAmount, prev.premiumCurrency), money(last.premiumAmount, last.premiumCurrency)],
      ["Valid until", fmtDate(prev.validUntil), fmtDate(last.validUntil)],
      ["Answer", prev.outcome, last.outcome],
    ];
    for (const [field, earlier, revised] of pairs)
      if (earlier !== revised) out.push({ subject: insurer, field, earlier, revised, revision: last.revision, receivedAt: last.receivedAt, affects, documentId: last.documentId });
  }
  return out.slice(0, 10);
}

/** What a change or a gap means — confirmed from records, potential from a relationship, or unknown. */
export function consequences(f: RenewalLivingFacts, now: Date) {
  const out: { certainty: "confirmed" | "potential" | "missing"; text: string }[] = [];
  const end = f.period?.periodEnd ?? null;
  const days = end ? Math.ceil((new Date(`${end}T23:59:59Z`).getTime() - now.getTime()) / DAY) : null;
  const coverState = f.placement?.cover.state ?? null;
  const coverUnknown = gap(f, "placement") || gap(f, "issuance") || gap(f, "quotation");
  if (coverUnknown) out.push({ certainty: "missing", text: "Renewed cover cannot be stated here: part of the placement record could not be read for you." });
  if (!coverUnknown && end && days !== null && days >= 0 && !["confirmed", "active"].includes(coverState ?? ""))
    out.push({ certainty: "potential", text: `The current cover ends on ${fmtDate(end)} (${days} day${days === 1 ? "" : "s"}). Nothing on file yet confirms cover from that date.` });
  if (!coverUnknown && end && days !== null && days < 0 && !["confirmed", "active"].includes(coverState ?? ""))
    out.push({ certainty: "confirmed", text: `The previous period ended on ${fmtDate(end)} and no renewed cover is confirmed on file.` });
  for (const c of changes(f).filter((x) => x.field === "Premium"))
    out.push({ certainty: "confirmed", text: `${c.subject} revised its premium from ${c.earlier ?? "nothing recorded"} to ${c.revised ?? "nothing recorded"} (revision ${c.revision}).` });
  if (f.placement?.drift && (f.placement.drift as { stale?: boolean }).stale)
    out.push({ certainty: "confirmed", text: "The placement basis no longer matches the latest terms; it must be reviewed before it is used." });
  if (coverState === "requested" || coverState === "submitted")
    out.push({ certainty: "confirmed", text: "Placement is requested, not confirmed: cover counts only from the insurer's written confirmation." });
  for (const i of f.opportunity?.insurers ?? [])
    if (i.stage === "quoted" && i.response && i.response.premiumAmount == null)
      out.push({ certainty: "missing", text: `${i.insurerName} quoted without a premium on file — the comparison cannot include its price until one is recorded.` });
  if (f.issuance?.check && f.issuance.check.unresolved > 0)
    out.push({ certainty: "confirmed", text: `The issued policy differs from what was agreed in ${f.issuance.check.unresolved} place${f.issuance.check.unresolved === 1 ? "" : "s"} still to resolve.` });
  if (gap(f, "period")) out.push({ certainty: "missing", text: "The policy period could not be read for you, so its expiry is not checked here." });
  else if (!f.period) out.push({ certainty: "missing", text: "No policy period is linked to this renewal, so its expiry cannot be checked." });
  return out.slice(0, 6);
}

function evidenceOf(f: RenewalLivingFacts): LivingEvidence[] {
  const out: LivingEvidence[] = [];
  for (const i of f.opportunity?.insurers ?? []) {
    const s = i.response?.source;
    if (s) out.push({ label: `${i.insurerName}'s answer`, reference: s.label, documentId: s.kind === "document" ? s.id : null, recordedAt: i.response?.receivedAt ?? null });
    for (const t of i.response?.terms ?? []) if (t.evidence?.kind === "document" && out.length < 16) out.push({ label: `${i.insurerName} — ${t.label}`, reference: t.evidence.label, documentId: t.evidence.id, recordedAt: null });
  }
  const ins = f.placement?.instruction;
  if (ins) out.push({ label: "Client instruction", reference: ins.evidence.label, documentId: ins.evidence.kind === "document" ? ins.evidence.id : null, recordedAt: ins.instructedAt });
  for (const d of f.issuance?.documents ?? []) out.push({ label: "Issued policy document", reference: d.filename, documentId: d.documentId, recordedAt: d.receivedAt });
  for (const s of f.item.steps) for (const r of s.recorded.slice(-1)) if (out.length < 20) out.push({ label: s.label, reference: r.reference, documentId: null, recordedAt: r.recordedAt });
  return out.slice(0, 20);
}

function block(id: string, component: LivingComponent, role: LivingBlock["role"], title: string | null, props: Record<string, unknown>, extra: { evidence?: LivingEvidence[]; actions?: (LivingAction | null)[] } = {}): LivingBlock {
  const actions = (extra.actions ?? []).filter((a): a is LivingAction => !!a).slice(0, 4);
  const evidence = (extra.evidence ?? []).slice(0, 10);
  return { id, component, version: LIVING_REGISTRY[component].version, role, title, props, evidence, actions, hash: hash({ props, evidence, actions }) };
}

/** The surface for one renewal, composed for its stage. */
export function composeRenewalSurface(f: RenewalLivingFacts, opts: { now: Date; aiAvailable: boolean }): LivingSurface {
  const stage = renewalStage(f);
  const stageIndex = RENEWAL_STAGES.findIndex((s) => s.key === stage);
  const stageLabel = stage === "stopped" ? "Stopped" : RENEWAL_STAGES[stageIndex]!.label;
  const op = f.run?.operational;
  const days = f.period ? Math.ceil((new Date(`${f.period.periodEnd}T23:59:59Z`).getTime() - opts.now.getTime()) / DAY) : null;
  const statusTone = stage === "verified" ? "green" : stage === "stopped" || f.run?.state === "exception" ? "red" : f.item.task_status === "with_party" ? "gold" : f.item.task_status === "needs_you" ? "gold" : "green";
  const blocks: LivingBlock[] = [];

  blocks.push(block("header", "ContextHeader", "lead", null, {
    eyebrow: "Renewal",
    title: f.period ? `${f.client?.name ?? "Client"} — ${f.period.classOfBusiness}${f.period.policyNumber ? ` ${f.period.policyNumber}` : ""}` : f.item.title,
    client: f.client,
    facts: [
      ...(f.period ? [{ label: "Expiring insurer", value: f.period.insurerName }, { label: "Cover ends", value: fmtDate(f.period.periodEnd)! + (days !== null && days >= 0 ? ` · ${days} days` : "") }] : []),
      ...(f.opportunity ? [{ label: "Insurers approached", value: String(f.opportunity.insurers.filter((i) => i.stage !== "removed").length) }] : []),
      ...(op ? [{ label: "ASAP", value: op.status }] : []),
    ].slice(0, 6),
    status: { label: stageLabel, tone: statusTone },
    owner: f.ownerName,
  }, { actions: [f.client ? { kind: "open", label: "Open the client", ref: { ws: "client", clientId: f.client.id }, primary: false } : null, openRun(f)] }));

  blocks.push(block("journey", "RenewalJourney", "lead", null, {
    stages: RENEWAL_STAGES.map((s, i) => ({ key: s.key, label: s.label, state: stage === "stopped" ? (i < 1 ? "done" : "next") : i < stageIndex ? "done" : i === stageIndex ? "now" : "next" })),
    summary: (f.placement
      ? `${f.issuance && f.issuance.stage !== "not_ready" ? issuanceWords(f.issuance.stage) : f.placement.nextAction}. ${f.issuance?.cover.line ?? f.placement.cover.line}`
      : op
        ? `${op.currentWork.title}. ${op.completed}`
        : gap(f, "run")
          ? "The renewal run could not be read, so its progress is not shown."
          : f.item.required_action ?? "No renewal run is attached to this work yet."
    ).slice(0, 500),
  }));

  const opps = progressOpportunities(f);
  if (opps.length)
    blocks.push(block("next", "ProgressOpportunity", "main", "What moves this forward", { items: opps.map(({ action: _a, ...rest }) => rest) }, { actions: opps.map((o) => o.action) }));

  // The working column changes with the stage.
  const quoteBlock = () =>
    f.opportunity && f.opportunity.insurers.length
      ? block("quotes", "QuoteComparison", "main", stage === "awaiting_terms" ? "Insurer answers" : "Quotes side by side", {
          insurers: f.opportunity.insurers.filter((i) => i.stage !== "removed").map((i) => ({
            name: i.insurerName,
            stage: i.stageLabel,
            premium: i.response ? money(i.response.premiumAmount, i.response.premiumCurrency) : null,
            validUntil: i.response?.validUntil ?? null,
            revision: Math.max(0, ...f.revisions.filter((r) => r.insurerName === i.insurerName).map((r) => r.revision)) || null,
            terms: (i.response?.terms ?? []).slice(0, 20).map((t) => ({ label: t.label, value: t.correctedValue ?? t.extractedValue ?? (t.amount ? money(t.amount, t.currency) : null), unclear: t.unclear })),
            declineReason: i.response?.declineReason ?? null,
          })),
          note: "Named facts from each insurer's own answer. ASAP does not pick a winner; the client decides.",
        }, { evidence: [...evidenceOf(f).filter((e) => /answer| — /.test(e.label)), { label: "Quotation", reference: `Insurer answers as recorded on the quotation “${f.opportunity.opportunity.title}”`, documentId: null, recordedAt: null }], actions: [openQuote(f)] })
      : null;

  const chg = changes(f);
  if (chg.length) blocks.push(block("changes", "ChangeComparison", "main", "Revised since first recorded", { items: chg.map(({ documentId: _d, ...c }) => c) }, { evidence: chg.map((c) => ({ label: `${c.subject} revision ${c.revision}`, reference: c.documentId ? "Revised answer document" : "Revised answer as recorded", documentId: c.documentId, recordedAt: c.receivedAt })) }));

  if (stage === "awaiting_terms" || stage === "comparing" || stage === "deciding") {
    const q = quoteBlock();
    if (q) blocks.push(q);
  }
  if (stage === "placing" || stage === "issuing" || stage === "verified") {
    const p = f.placement!;
    const iss = f.issuance;
    blocks.push(block("placement", "PlacementProgress", "main", "Placement and issuance", {
      insurerName: p.insurer.name,
      steps: [
        { label: "Client instruction recorded", state: "done", note: fmtDate(p.instruction.instructedAt) },
        { label: "Placement request approved", state: p.request?.approval ? "done" : p.request ? "now" : "next", note: p.request?.approval ? fmtDate(p.request.approval.approvedAt) : null },
        { label: "Request sent to the insurer", state: p.request?.submission ? "done" : p.request?.approval ? "now" : "next", note: null },
        { label: "Insurer confirmation", state: p.insurerResponse ? "done" : p.request?.submission ? "now" : "next", note: p.insurerResponse ? fmtDate(p.insurerResponse.receivedAt) : null },
        { label: "Policy document issued and checked", state: iss?.stage === "applied" ? "done" : iss && iss.stage !== "not_ready" ? (iss.stage === "differences_to_resolve" ? "blocked" : "now") : "next", note: iss?.check ? `${iss.check.unresolved} unresolved difference${iss.check.unresolved === 1 ? "" : "s"}` : null },
      ],
      coverLine: (iss?.cover.line ?? p.cover.line).slice(0, 500),
      blockers: p.blockers.slice(0, 6),
    }, { actions: [primary(openQuote(f))] }));
  }

  const cons = consequences(f, opts.now);
  if (cons.length) blocks.push(block("consequences", "ConsequencePanel", "side", "What this means", { items: cons }));

  const obs = obligations(f);
  if (obs.length) blocks.push(block("obligations", "ObligationTracker", "side", "Who holds the next step", { items: obs }));

  blocks.push(block("cover", "CoverageEffectiveState", "side", "Cover", {
    expiring: f.period ? { periodStart: f.period.periodStart, periodEnd: f.period.periodEnd, insurerName: f.period.insurerName, policyNumber: f.period.policyNumber } : null,
    renewed: f.placement && !gap(f, "issuance") ? { state: (f.issuance?.cover.state ?? f.placement.cover.state) ?? null, line: (f.issuance?.cover.line ?? f.placement.cover.line).slice(0, 500) } : null,
    daysToExpiry: days,
    statement: gap(f, "placement") || gap(f, "issuance") || gap(f, "quotation")
      ? "Renewed cover is not stated: part of the placement record could not be read for you. That is not the same as no cover."
      : f.placement
      ? "The renewed cover is stated exactly as the placement's cover check reads it. A request, a quote or a draft is never cover."
      : "No renewed cover is on file. A quotation or a request does not create cover; only the insurer's written confirmation does.",
  }));

  const ev = evidenceOf(f);
  if (ev.length) blocks.push(block("evidence", "EvidenceInspector", "side", "Evidence", { items: ev }));

  if (f.recent.length)
    blocks.push(block("recent", "Timeline", "side", "Recent changes", {
      events: f.recent.slice(0, 10).map((e) => {
        const verb = (ACTION_WORDS.find(([re]) => re.test(e.action)) ?? [null, e.action.replace(/^[a-z_]+\./, "").replace(/[._]/g, " ")])[1];
        const what = e.action.split(".")[0]!.replace(/_/g, " ");
        return { at: e.at, text: `${what[0]!.toUpperCase()}${what.slice(1)} ${verb}`.slice(0, 500), actor: e.actor };
      }),
    }));

  return {
    version: 1,
    surfaceId: `renewal:${f.item.id}`,
    purpose: "renewal",
    subject: { kind: "work_item", id: f.item.id, title: f.item.title.slice(0, 200) },
    stage: { key: stage, label: stageLabel },
    generatedAt: opts.now.toISOString(),
    fingerprint: hash([blocks.map((b) => [b.id, b.hash]), f.unavailable]),
    blocks,
    ai: { available: opts.aiAvailable },
    unavailable: f.unavailable.map((g) => ({ part: PART_WORDS[g.part], reason: g.reason })),
  };
}
