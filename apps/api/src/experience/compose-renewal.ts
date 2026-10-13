import type { RenewalStage, SubjectRef, WorkspaceFocus } from "@asap/schema";
import { hasPermission } from "../context.js";
import { HttpError, mapDatabaseError } from "../errors.js";
import { pendingApprovals } from "../living/commands.js";
import { loadRenewalLivingFacts, type RenewalLivingFacts } from "../living/facts.js";
import { renewalAnswer } from "../living/focus.js";
import { resolveClient } from "../living/investigate.js";
import { changes, consequences, evidenceOf, obligations, progressOpportunities, renewalStage } from "../living/renewal.js";
import type { Env } from "../placement/service.js";
import { loadPolicySpace } from "../policy/space.js";
import { Composition, L, cut, fmtDate, money } from "./build.js";
import type { Composed } from "./types.js";

/**
 * "Help me renew Acme's motor fleet" (D-172). The experience first finds what is meant — the client
 * from the brokerage's own records, then the policy — asking only where more than one fits. Once the
 * policy is known it shows the current cover and the next useful step: start the renewal (through
 * the existing endpoint, confirmed) or, when renewal work exists, the working context composed from
 * the renewal facts the Living workspace already reads (D-156): stage, what moves it forward, who
 * holds it, what it means, and — only when the business state calls for them — quotes side by side,
 * revisions, approvals and evidence. Asking ("compare the revised terms", "what is blocking this")
 * recomposes the same context around a focus; nothing here re-derives a renewal rule.
 */
export type RenewState = {
  clientWords: string;
  coverWords: string | null;
  clientId: string | null;
  policyId: string | null;
  workItemId: string | null;
  focus: WorkspaceFocus | null;
  focusStack: WorkspaceFocus[];
  approvalsOnly: boolean;
  question: string | null;
  /** A reading of the last request that produced no focus: said back, never guessed. */
  said: { text: string; refused: boolean } | null;
};

const DAY = 86_400_000;
const SYNONYMS: Record<string, string[]> = { fleet: ["motor"], vehicle: ["motor"], vehicles: ["motor"], car: ["motor"], cars: ["motor"], health: ["medical"], property: ["fire", "property"], cargo: ["marine"] };
const STAGES: { key: RenewalStage; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "preparing", label: "Preparing" },
  { key: "awaiting_terms", label: "Waiting for terms" },
  { key: "comparing", label: "Comparing" },
  { key: "deciding", label: "Client decides" },
  { key: "placing", label: "Placing cover" },
  { key: "issuing", label: "Policy issued" },
  { key: "verified", label: "Cover verified" },
];
const TASK_WORDS: Record<string, [string, "green" | "gold" | "red" | "grey"]> = {
  needs_you: ["Needs someone at the brokerage", "gold"],
  with_party: ["Waiting on others", "gold"],
  in_progress: ["ASAP is handling", "green"],
  done: ["Done", "grey"],
};

export function initialRenewState(clientWords: string, coverWords: string | null): RenewState {
  return { clientWords, coverWords, clientId: null, policyId: null, workItemId: null, focus: null, focusStack: [], approvalsOnly: false, question: null, said: null };
}

/** Applies a record the person chose, or the experience was started from, after re-reading it. */
export async function adoptSubject(env: Env, s: RenewState, ref: SubjectRef): Promise<RenewState> {
  const org = env.organizationId;
  if (ref.type === "client") {
    const r = await env.db.from("clients").select("id").eq("organization_id", org).eq("id", ref.id).is("deleted_at", null).maybeSingle();
    if (!r.data) throw new HttpError(404, "not_found", "That client is not available.");
    return { ...s, clientId: ref.id, policyId: null, workItemId: null };
  }
  if (ref.type === "policy") {
    const r = await env.db.from("policies").select("id, client_id").eq("organization_id", org).eq("id", ref.id).is("deleted_at", null).maybeSingle();
    const row = r.data as { id: string; client_id: string } | null;
    if (!row) throw new HttpError(404, "not_found", "That policy is not available.");
    return { ...s, clientId: row.client_id, policyId: row.id, workItemId: null };
  }
  if (ref.type === "policy_period") {
    const r = await env.db.from("policy_periods").select("id, policy_id").eq("organization_id", org).eq("id", ref.id).maybeSingle();
    const row = r.data as { id: string; policy_id: string } | null;
    if (!row) throw new HttpError(404, "not_found", "That policy period is not available.");
    return adoptSubject(env, s, { type: "policy", id: row.policy_id, label: null });
  }
  if (ref.type === "work_item") {
    const r = await env.db.from("work_items").select("id, kind, client_id").eq("organization_id", org).eq("id", ref.id).is("deleted_at", null).maybeSingle();
    const row = r.data as { id: string; kind: string; client_id: string | null } | null;
    if (!row || row.kind !== "renewal") throw new HttpError(404, "not_found", "That renewal is not available.");
    return { ...s, clientId: row.client_id, workItemId: row.id };
  }
  throw new HttpError(400, "invalid_request", "A renewal starts from a client, a policy or renewal work.");
}

function coverMatch(cover: string | null, cls: string, number: string | null): boolean {
  if (!cover) return true;
  const hay = `${cls} ${number ?? ""}`.toLowerCase();
  return cover.split(/\s+/).some((w) => [w, ...(SYNONYMS[w] ?? [])].some((x) => hay.includes(x)));
}

/** Resolves as far as the records allow; returns the state and, when a person must choose, what to show. */
export async function composeRenewal(env: Env, s0: RenewState, now: Date): Promise<{ state: RenewState; composed: Composed }> {
  let s = { ...s0 };
  const c = new Composition();

  // 1. Which client.
  if (!s.clientId && !s.workItemId && !s.policyId) {
    if (!s.clientWords) return { state: s, composed: askClient(c, "Which client's cover should ASAP renew?") };
    const found = await resolveClient(env, s.clientWords);
    if (found.clientId) s = { ...s, clientId: found.clientId };
    else if (found.candidates.length) {
      const choices = found.candidates.map((x) => {
        const ref = { type: "client" as const, id: x.id, label: x.name };
        c.allow(ref);
        return { ref, detail: null, action: c.action(`pick-${x.id.slice(0, 8)}`, x.name, { kind: "ui.select", target: "choose", ref }) };
      });
      const choose = c.put("choose", "RecordChoice", { prompt: found.unclear ?? "Which client?", choices }, { actions: choices.map((x) => x.action) });
      return { state: s, composed: { title: `Renew — which ${s.clientWords}?`, progress: "waiting_input", primary: null, layout: L.stack("root", [choose]), composition: c, missing: ["Which client"], resolution: "ambiguous" } };
    } else return { state: s, composed: askClient(c, `${found.unclear ?? "No client matches."} Which client do you mean?`) };
  }

  // 2. Which policy (unless renewal work is already known).
  if (!s.workItemId && !s.policyId && s.clientId) {
    const pr = await env.db.from("policies").select("id, policy_number, class_of_business").eq("organization_id", env.organizationId).eq("client_id", s.clientId).is("deleted_at", null).order("class_of_business").limit(40);
    if (pr.error) throw mapDatabaseError(pr.error);
    const cl = await env.db.from("clients").select("id, name").eq("organization_id", env.organizationId).eq("id", s.clientId).maybeSingle();
    const client = cl.data as { id: string; name: string } | null;
    if (!client) throw new HttpError(404, "not_found", "That client is not available.");
    const clientRef = { type: "client" as const, id: client.id, label: client.name };
    c.allow(clientRef);
    const all = (pr.data ?? []) as { id: string; policy_number: string | null; class_of_business: string }[];
    const fit = all.filter((p) => coverMatch(s.coverWords, p.class_of_business, p.policy_number));
    if (fit.length === 1) s = { ...s, policyId: fit[0]!.id };
    else {
      if (!all.length) {
        const addAnother = c.action("explore", "Policies expiring this month", { kind: "experience.start", text: "Show policies expiring this month", subject: null });
        const none = c.put("none", "Confirmation", { heading: `${client.name} has no policies on file`, lines: ["There is nothing to renew for this client in the brokerage's records."], tone: "grey", next: [addAnother] }, { actions: [addAnother] });
        return { state: s, composed: { title: `Renew — ${client.name}`, progress: "blocked", primary: clientRef, layout: L.stack("root", [none]), composition: c, missing: [], resolution: "needs_input" } };
      }
      const list = fit.length ? fit : all;
      const choices = list.slice(0, 8).map((p) => {
        const ref = { type: "policy" as const, id: p.id, label: cut(`${p.class_of_business}${p.policy_number ? ` · ${p.policy_number}` : ""}`, 200) };
        c.allow(ref);
        return { ref, detail: null, action: c.action(`pick-${p.id.slice(0, 8)}`, ref.label!, { kind: "ui.select", target: "choose", ref }) };
      });
      const prompt = fit.length ? `${client.name} has ${fit.length} policies that fit. Which one?` : `No policy of ${client.name} matches “${s.coverWords}”. Which one should ASAP renew?`;
      const choose = c.put("choose", "RecordChoice", { prompt: cut(prompt, 500), choices }, { actions: choices.map((x) => x.action) });
      return { state: s, composed: { title: `Renew — ${client.name}`, progress: "waiting_input", primary: clientRef, layout: L.stack("root", [choose]), composition: c, missing: ["Which policy"], resolution: "ambiguous" } };
    }
  }

  // 3. A policy without renewal work: its cover now, and starting the renewal.
  if (!s.workItemId && s.policyId) {
    const v = await loadPolicySpace(env, s.policyId, { readOnly: true, now });
    const open = v.work.find((w) => w.kind === "renewal" && w.taskStatus !== "done");
    if (open) s = { ...s, workItemId: open.id, clientId: v.client.id };
    else {
      const policyRef = { type: "policy" as const, id: v.policy.id, label: cut(v.title, 200) };
      const clientRef = { type: "client" as const, id: v.client.id, label: v.client.name };
      c.allow(policyRef, clientRef);
      const period = v.periods.find((p) => p.id === v.selectedPeriodId) ?? v.periods[v.periods.length - 1] ?? null;
      const days = period ? Math.ceil((new Date(`${period.end}T23:59:59Z`).getTime() - now.getTime()) / DAY) : null;
      const periodSource = period ? { label: "Policy period", reference: `${fmtDate(period.start)} – ${fmtDate(period.end)}`, documentId: null, recordedAt: null } : null;
      const summary = c.put("cover", "ContextSummary", {
        eyebrow: "Current cover",
        heading: cut(`${v.client.name} · ${v.policy.classOfBusiness}`, 200),
        status: { label: cut(v.cover.label, 80), tone: v.cover.verified ? "green" : "gold" },
        facts: [
          { label: "Insurer", value: v.insurer.name, source: null },
          { label: "Cover ends", value: period ? `${fmtDate(period.end)}${days !== null ? ` (${days >= 0 ? `in ${days} days` : `${-days} days ago`})` : ""}` : "No period on file", source: periodSource },
          { label: "Premium", value: period?.premium.amount ? money(period.premium.amount, period.premium.currency)! : "Not recorded", source: period?.premium.amount ? periodSource : null },
          { label: "Cover", value: cut(v.cover.reason, 500), source: null },
        ],
      }, { sources: periodSource ? [periodSource] : [] });
      const allowed = v.permissions.canStartWork && hasPermission(env.ctx, "policy", "edit");
      const start = c.action("start", "Start the renewal", { kind: "renewal.start", policyId: v.policy.id }, {
        primary: true,
        confirm: { heading: `Start the renewal of ${cut(v.title, 150)}?`, effects: [`A renewal is opened as Work for ${v.client.name}, and ASAP prepares it.`, "Nothing is sent to the client or any insurer until a person approves it.", "Starting twice opens the same work; nothing is duplicated."] },
        disabledReason: allowed ? null : "Your role cannot start renewal work. A colleague with policy access can.",
      });
      const governed = c.put("start", "GovernedAction", {
        heading: "No renewal is open for this policy",
        explanation: "Starting it opens the renewal as Work and lets ASAP prepare the request for terms.",
        effects: ["Opens the renewal as Work", "Nothing leaves the brokerage without approval"],
        action: start,
      }, { actions: [start] });
      const gaps = v.gaps.length ? c.put("gaps", "Consequences", { items: v.gaps.slice(0, 6).map((g) => ({ certainty: "missing" as const, text: cut(g, 500) })) }, { priority: "secondary", narrow: "collapse" }) : null;
      return {
        state: s,
        composed: { title: cut(`Renew ${v.client.name} · ${v.policy.classOfBusiness}`, 200), progress: "waiting_input", primary: policyRef, related: [clientRef], layout: L.split("root", L.stack("now", [summary, gaps]), governed, "2:1"), composition: c, missing: [] },
      };
    }
  }

  // 4. Renewal work: the evolving working context.
  if (!s.workItemId) throw new HttpError(404, "not_found", "That renewal is not available.");
  const f = await loadRenewalLivingFacts(env, s.workItemId);
  return { state: s, composed: composeWorking(c, f, s, now) };
}

function askClient(c: Composition, question: string): Composed {
  const ask = c.put("which", "Clarification", { question: cut(question, 500), options: [], allowText: true });
  return { title: "Renew a client's cover", progress: "waiting_input", primary: null, layout: L.stack("root", [ask]), composition: c, missing: ["Which client"], resolution: "needs_input" };
}

function composeWorking(c: Composition, f: RenewalLivingFacts, s: RenewState, now: Date): Composed {
  const workRef = { type: "work_item" as const, id: f.item.id, label: cut(f.item.title, 200) };
  const clientRef = f.client ? { type: "client" as const, id: f.client.id, label: f.client.name } : null;
  c.allow(workRef, clientRef);
  const stage = renewalStage(f, now);
  const p = f.period;
  const days = p ? Math.ceil((new Date(`${p.periodEnd}T23:59:59Z`).getTime() - now.getTime()) / DAY) : null;
  const periodSource = p ? { label: "Expiring period", reference: `${p.policyNumber ?? p.classOfBusiness}, ${fmtDate(p.periodStart)} – ${fmtDate(p.periodEnd)}`, documentId: null, recordedAt: null } : null;
  const [statusLabel, statusTone] = TASK_WORDS[f.item.task_status] ?? ["Open", "grey"];

  const once = <T,>(f: () => T): (() => T) => {
    let v: { r: T } | null = null;
    return () => (v ??= { r: f() }).r;
  };
  const summary = once(() => c.put("summary", "ContextSummary", {
    eyebrow: "Renewal",
    heading: cut(`${f.client?.name ?? f.item.title}${p ? ` · ${p.classOfBusiness}${p.policyNumber ? ` ${p.policyNumber}` : ""}` : ""}`, 200),
    status: { label: cut(`Recorded: ${statusLabel}`, 80), tone: statusTone },
    facts: [
      ...(p ? [{ label: "Insurer now", value: p.insurerName, source: periodSource }] : []),
      { label: "Cover ends", value: p ? `${fmtDate(p.periodEnd)}${days !== null ? ` (${days >= 0 ? `in ${days} days` : `${-days} days ago`})` : ""}` : "No period linked", source: periodSource },
      ...(p?.premiumAmount ? [{ label: "Expiring premium", value: money(p.premiumAmount, p.premiumCurrency)!, source: periodSource }] : []),
      { label: "Handled by", value: f.ownerName ?? "Nobody assigned", source: null },
    ],
  }));

  const idx = STAGES.findIndex((x) => x.key === stage);
  const milestones = once(() => stage === "stopped"
    ? c.put("stages", "Milestones", { steps: [{ key: "stopped", label: "Stopped", state: "now" }], summary: cut(f.run?.exception?.message ?? "The renewal stopped and needs a person.", 500) })
    : c.put("stages", "Milestones", {
        steps: STAGES.map((x, i) => ({ key: x.key, label: x.label, state: stage === "continuing" || i < idx ? ("done" as const) : i === idx ? ("now" as const) : ("next" as const) })),
        summary: cut(stage === "continuing" ? "The renewed cover is in force." : (f.run?.operational?.currentWork.title ?? f.item.required_action ?? "No renewal run is attached to this work yet."), 500),
      }));

  // An approval waiting on the run, shown in full with the governed decision.
  const runApproval = pendingApprovals(f).find((a) => a.key === "run") ?? null;
  const approvalOnce = once(() => {
    if (!runApproval || !f.run?.approval) return null;
    const can = f.run.permissions.canApprove;
    const appr = { kind: "approval.decide" as const, approvalId: f.run.approval.id, bundleSha256: f.run.approval.bundleSha256 };
    c.allow({ type: "approval", id: f.run.approval.id });
    const approve = c.action("approve", "Approve and send", { ...appr, decision: "approve" }, { primary: true, confirm: { heading: "Approve and send?", effects: [`${runApproval.items.length} message${runApproval.items.length === 1 ? "" : "s"} will leave the brokerage exactly as shown.`] }, disabledReason: can ? null : runApproval.approverNote });
    const ret = c.action("return", "Return with a reason", { ...appr, decision: "reject" }, { confirm: { heading: "Return it?", effects: ["Nothing is sent. The renewal waits for a corrected version."] }, disabledReason: can ? null : runApproval.approverNote });
    return c.put("approval", "ApprovalReview", { heading: cut(runApproval.title, 200), why: runApproval.why, items: runApproval.items, approve, ret }, { actions: [approve, ret], title: "For your approval" });
  });
  const hasApproval = !!(runApproval && f.run?.approval);

  const opps = progressOpportunities(f);
  const next = once(() => c.put("next", "NextSteps", {
    items: opps.map((o) => ({ title: cut(o.title, 500), why: cut(o.why, 500), responsible: o.responsible, blockedBy: o.blockedBy.slice(0, 6), tone: o.tone, action: null })),
    empty: "Nothing is waiting on the brokerage right now.",
  }, { title: "What moves this forward" }));

  const obl = obligations(f);
  const obligationsSlot = once(() => (obl.length ? c.put("holders", "Obligations", { items: obl, empty: "Nobody holds an open step." }, { title: "Who holds it", priority: "secondary", narrow: "collapse" }) : null));
  const cons = consequences(f, now);
  const consequencesSlot = once(() => (cons.length ? c.put("means", "Consequences", { items: cons }, { title: "What it means", priority: "secondary", narrow: "collapse" }) : null));

  const evidence = evidenceOf(f).map((e) => ({ label: cut(e.label, 200), reference: cut(e.reference, 500), documentId: e.documentId, recordedAt: e.recordedAt }));
  for (const e of evidence) if (e.documentId) c.allow({ type: "document", id: e.documentId });
  const sources = once(() => c.put("sources", "SourceList", { items: evidence.slice(0, 20), empty: "No document is attached to this renewal yet." }, { title: "Evidence", priority: "secondary", narrow: "collapse", actions: evidence.filter((e) => e.documentId).slice(0, 8).map((e) => c.action(`doc-${e.documentId!.slice(0, 8)}`, "Open", { kind: "document.open", documentId: e.documentId! })) }));

  const insurers = (f.opportunity?.insurers ?? []).filter((i) => i.stage !== "removed" && !i.removedAt);
  const responded = insurers.filter((i) => i.response);
  const comparison = once(() => {
    if (!insurers.length) return null;
    const labels = [...new Set(responded.flatMap((i) => (i.response?.terms ?? []).map((t) => t.label)))].slice(0, 14);
    const term = (i: (typeof insurers)[number], l: string) => (i.response?.terms ?? []).find((t) => t.label === l);
    return c.put("compare", "Comparison", {
      caption: "Insurer answers side by side",
      columns: insurers.slice(0, 6).map((i) => ({ label: cut(i.insurerName, 80), detail: cut(i.stageLabel, 120) })),
      rows: [
        { label: "Premium", values: insurers.slice(0, 6).map((i) => (i.response ? money(i.response.premiumAmount, i.response.premiumCurrency) : null)), unclear: insurers.slice(0, 6).map(() => false) },
        { label: "Valid until", values: insurers.slice(0, 6).map((i) => fmtDate(i.response?.validUntil ?? null)), unclear: insurers.slice(0, 6).map(() => false) },
        ...labels.map((l) => ({
          label: cut(l, 80),
          values: insurers.slice(0, 6).map((i) => {
            const t = term(i, l);
            return t ? cut(t.correctedValue ?? t.extractedValue ?? (t.amount ? money(t.amount, t.currency) ?? "" : "") ?? "", 200) || null : null;
          }),
          unclear: insurers.slice(0, 6).map((i) => term(i, l)?.unclear ?? false),
        })),
      ],
      note: "Named facts from each insurer's own answer, as recorded on the quotation. ASAP does not pick one; the client decides.",
      hypothetical: false,
    }, { title: "Quotes", sources: evidence.filter((e) => /answer| — /.test(e.label)).slice(0, 10) });
  });
  const chg = changes(f);
  const changeList = once(() => c.put("changes", "ChangeList", { items: chg.map(({ documentId: _d, receivedAt: _r, ...x }) => ({ ...x, subject: cut(x.subject, 200), field: cut(x.field, 80) })), empty: "No insurer has revised an answer on file." }, { title: "Revised since first recorded" }));
  const timeline = once(() => c.put("history", "Timeline", { events: f.recent.slice(0, 15).map((e) => ({ at: e.at, text: cut(e.action.replace(/[._]/g, " "), 500), actor: e.actor })) }, { title: "What happened" }));

  const answerFor = once(() => {
    const focus = s.focus!;
    const a = renewalAnswer(f, focus, now);
    return c.put("answer", "Answer", {
      question: s.question ? cut(s.question, 500) : null,
      text: cut(a.items.length ? a.understood : a.empty ?? a.understood, 500),
      items: a.items.slice(0, 10).map((i) => ({ label: cut(i.label, 200), detail: i.detail ? cut(i.detail, 500) : null, tone: i.tone })),
      source: "records",
      refused: false,
    });
  });
  const said = s.said ? c.put("said", "Answer", { question: s.question ? cut(s.question, 500) : null, text: cut(s.said.text, 500), items: [], source: "rules", refused: s.said.refused }) : null;

  const notices: Composed["notices"] = [];
  if (f.unavailable.length) notices.push({ tone: "gold", text: "Part of this renewal could not be read for you; what is shown says so where it matters." });

  let layout;
  if (s.approvalsOnly) {
    const nothing = hasApproval ? null : c.put("nothing", "Answer", { question: s.question, text: "Nothing on this renewal waits for your approval.", items: [], source: "records", refused: false });
    layout = L.focus("root", L.stack("primary", [said, approvalOnce() ?? nothing]), [summary()], "The renewal");
  } else if (s.focus) {
    const fx = s.focus.intent;
    const primaryParts =
      fx === "compare_quotes" || fx === "explore" ? [L.split("cmp", comparison() ?? answerFor(), sources(), "2:1")]
      : fx === "compare_revisions" ? [chg.length ? L.split("rev", changeList(), comparison() ?? answerFor(), "1:1") : answerFor()]
      : fx === "evidence" ? [answerFor(), sources()]
      : fx === "history" ? [timeline()]
      : fx === "obligations" ? [answerFor(), obligationsSlot()]
      : fx === "consequences" ? [answerFor(), consequencesSlot()]
      : [answerFor(), approvalOnce(), next()];
    layout = L.focus("root", L.stack("primary", [said, ...primaryParts]), [summary(), milestones()], "The renewal");
  } else {
    // Progressive by stage: quotes when terms are arriving or compared, revisions when they exist.
    const showQuotes = (stage === "awaiting_terms" || stage === "comparing" || stage === "deciding") && responded.length > 0;
    const main = L.stack("main", [said, summary(), milestones(), approvalOnce(), next(), showQuotes ? comparison() : null, chg.length ? changeList() : null]);
    const side = L.group("side", [obligationsSlot(), consequencesSlot(), evidence.length ? sources() : null], "normal");
    layout = side ? L.dock("root", main, side, "end") : main;
  }

  return {
    title: cut(`Renewal · ${f.client?.name ?? f.item.title}${p ? ` · ${p.classOfBusiness}` : ""}`, 200),
    progress: stage === "verified" || stage === "continuing" ? "complete" : stage === "stopped" ? "blocked" : hasApproval ? "waiting_input" : "working",
    primary: workRef,
    related: clientRef ? [clientRef] : [],
    layout,
    composition: c,
    missing: [],
    notices,
    unavailable: f.unavailable.map((u) => `The ${u.part} ${u.reason === "restricted" ? "is not available to your role" : "could not be read"}.`),
    permissions: { canApprove: f.run?.permissions.canApprove ?? false, canControlRun: f.viewer.canControlRun },
  };
}
