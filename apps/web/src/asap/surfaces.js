/**
 * The adaptive shell's full-width surfaces (D-155) — Home, Work, Automations and Activity — read
 * from the same records the Spaces read: the brokerage's Work items, its workflow runs as the
 * server supervises them (GET /supervision), its automations and their real firings, and its audit
 * history. Nothing here is composed by a model, and nothing is a business value of its own: every
 * status, party, date and count is the server's, sorted and worded for the surface.
 */
import * as S from "./engine/store.js";

const DAY = 86_400_000;
const fmt = (iso) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : null);
const weekday = (iso) => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? iso + "T12:00:00Z" : iso);
  const days = Math.round((d.getTime() - Date.now()) / DAY);
  if (days < 0) return "overdue since " + fmt(iso);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return fmt(iso);
};
const plural = (n, one, many) => n + " " + (n === 1 ? one : many);

/** One shape for Work items in both modes: the live hydration carries the server's task status. */
function taskStatusOf(w) {
  if (w.taskStatus) return w.taskStatus;
  if (w.state === "Completed") return "done";
  if ((w.parties || []).length) return "with_party";
  return "needs_you";
}

function personName(id) {
  return id ? S.byId("users", id)?.name || "A former member" : null;
}

function refForItem(w) {
  if (w.opportunityId) return { ws: "quote", opportunityId: w.opportunityId, clientId: w.clientId || undefined };
  return { ws: "workitem", workItemId: w.id };
}

/** Where a run opens: a renewal's own Space, otherwise the Work item it drives. */
export function runRef(r) {
  if (r.workflow === "renewal") return { ws: "renewal", runId: r.id };
  if (r.workItemId) return { ws: "workitem", workItemId: r.workItemId };
  return { ws: "renewal" };
}

function runsByWorkItem(supervision) {
  const m = new Map();
  for (const r of supervision?.items || []) if (r.workItemId && !m.has(r.workItemId)) m.set(r.workItemId, r);
  return m;
}

/**
 * Work, as the operational inbox: one row per unfinished outcome, in the view it is genuinely in.
 *  - Needs me: a person must act, and it is mine or nobody's — including a run asking for approval.
 *  - ASAP is handling: a run of ASAP's is live on it and nobody needs to act.
 *  - Waiting on others: an outside party holds it — named, since a date — or a colleague owns the
 *    next step, named.
 *  - Upcoming: work whose next check or due date is still ahead.
 *  - Done: finished.
 */
export function workInbox({ supervision, meId }) {
  const runs = runsByWorkItem(supervision);
  const rows = S.all("workItems").map((w) => {
    const status = taskStatusOf(w);
    const run = runs.get(w.id) || null;
    const live = run && run.state !== "done" && run.state !== "cancelled";
    const op = run?.operational || null;
    const mine = !w.assigneeId || w.assigneeId === meId;
    const colleague = !mine && status !== "done" && status !== "with_party" ? personName(w.assigneeId) : null;
    const party = status === "with_party" ? (w.parties?.[0]?.name || null) : op?.waitingFor?.party || colleague || null;
    const since = status === "with_party" ? w.parties?.[0]?.since || null : null;
    const next = w.nextCheckAt || w.dueAt || null;
    let view;
    if (status === "done") view = "done";
    else if (live && run.views?.includes("needs_me")) view = "needs_me";
    else if (status === "with_party") view = "waiting";
    else if (live && run.views?.includes("asap_handling")) view = "handling";
    else if (status === "needs_you" && mine) view = "needs_me";
    else if (colleague) view = "waiting";
    else if (next && new Date(next).getTime() > Date.now()) view = "upcoming";
    else view = "needs_me";
    const client = w.clientId ? S.sel.client(w.clientId) : null;
    const overdue = next && new Date(next).getTime() < Date.now() && status !== "done";
    const urgency = status === "done" ? "none" : overdue || w.priority === "high" || run?.state === "exception" ? "high" : w.priority === "low" ? "low" : "medium";
    const statusText =
      status === "done" ? "Done" :
      run?.state === "exception" ? "Blocked — " + (run.exception?.message || "ASAP stopped and needs a person") :
      run?.state === "waiting_approval" ? "Needs your approval" :
      party ? "With " + party + (since ? " since " + fmt(since) : "") :
      live ? op?.currentWork?.title || "ASAP is working on it" :
      w.nextStep ? w.nextStep : w.statusLabel || "Open";
    return {
      id: w.id,
      view,
      title: w.title,
      client: client ? { id: client.id, name: client.name } : null,
      kind: w.kind,
      statusText,
      owner: personName(w.assigneeId),
      party,
      when: status === "done" ? null : next ? (overdue ? "Overdue since " + fmt(next) : (status === "with_party" ? "Follow-up " : "Due ") + weekday(next)) : null,
      urgency,
      action: { label: run?.state === "waiting_approval" ? "Review" : "Open", ref: run ? runRef(run) : refForItem(w) },
      sortAt: next || w.createdAt || "",
    };
  });
  const order = { high: 0, medium: 1, low: 2, none: 3 };
  rows.sort((a, b) => order[a.urgency] - order[b.urgency] || (a.sortAt < b.sortAt ? -1 : 1));
  const views = [
    ["needs_me", "Needs me"],
    ["handling", "ASAP is handling"],
    ["waiting", "Waiting on others"],
    ["upcoming", "Upcoming"],
    ["done", "Done"],
  ].map(([key, label]) => ({ key, label, rows: rows.filter((r) => r.view === key) }));
  return { views };
}

/**
 * Home: what matters today (a few genuine attention items, each with why and one action), what
 * ASAP is handling, and whether this is a brokerage with nothing in it yet.
 */
export function homeSurface({ supervision, meId, waitingDocuments = [], automationFailures = [] }) {
  const inbox = workInbox({ supervision, meId });
  const attention = [];
  for (const r of supervision?.items || []) {
    if (r.state === "done" || r.state === "cancelled") continue;
    if (r.state === "waiting_approval")
      attention.push({ kind: "approval", title: r.title, why: "ASAP prepared it and nothing goes out until you approve" + (r.priorityReason && r.priorityReason !== "on track" ? " · " + r.priorityReason : "") + ".", action: { label: "Review", ref: runRef(r) }, weight: 90 + (r.priority || 0) });
    else if (r.state === "exception")
      attention.push({ kind: "blocked", title: r.title, why: (r.exception?.message || "ASAP stopped and needs a person.") + (r.exception?.needs ? " " + r.exception.needs : ""), action: { label: "Open", ref: runRef(r) }, weight: 85 + (r.priority || 0) });
    else if (r.operational?.attention && /follow-up is due|overdue/i.test(r.operational.attentionReason || ""))
      attention.push({ kind: "overdue", title: r.title, why: r.operational.attentionReason + ".", action: { label: "Open", ref: runRef(r) }, weight: 70 + (r.priority || 0) });
  }
  const runItems = new Set((supervision?.items || []).map((r) => r.workItemId).filter(Boolean));
  for (const row of inbox.views.find((v) => v.key === "needs_me").rows) {
    if (runItems.has(row.id) || row.urgency !== "high") continue;
    attention.push({ kind: "deadline", title: row.title, why: (row.when ? row.when + " — " : "") + row.statusText + ".", action: { label: "Open", ref: row.action.ref }, weight: 60 });
  }
  if (waitingDocuments.length)
    attention.push({ kind: "discrepancy", title: plural(waitingDocuments.length, "document is", "documents are") + " waiting for review", why: "ASAP read them; the values only count once a person confirms them.", action: { label: "Review", ref: { ws: "document", documentId: waitingDocuments[0] } }, weight: 55 });
  for (const f of automationFailures.slice(0, 2))
    attention.push({ kind: "automation", title: f.name + " could not finish", why: f.reason || "Its last firing failed and needs a person.", action: { label: "Open", ref: { ws: "automation", automationId: f.id } }, weight: 50 });
  attention.sort((a, b) => b.weight - a.weight);

  const handling = (supervision?.items || [])
    .filter((r) => r.views?.includes("asap_handling") || r.views?.includes("waiting_on_others"))
    .slice(0, 6)
    .map((r) => {
      const next = r.operational?.upcoming?.[0] || null;
      return {
        title: r.title,
        doing: r.operational?.currentWork?.title || r.stateLabel || "Working",
        record: r.client?.name || null,
        state: r.operational?.waitingFor ? "Waiting on " + r.operational.waitingFor.party : r.stateLabel || "Running",
        next: next ? next.label + " " + weekday(next.at) : null,
        safe: !r.operational?.attention,
        ref: runRef(r),
      };
    });
  const firstUse = S.all("clients").length === 0 && S.all("workItems").length === 0;
  return { attention: attention.slice(0, 5), more: Math.max(0, attention.length - 5), handling, firstUse };
}

/** Automations: what is running, what it is responsible for, whether it is healthy, what next, and whether it needs a person. */
export function automationsBoard({ supervision }) {
  const engines = new Map();
  const NAMES = { renewal: "Renewal Autopilot", quotation: "Quotation chasing", placement: "Placement follow-through", issuance: "Policy issuance", claim: "Claim follow-up", endorsement: "Policy changes" };
  for (const r of supervision?.items || []) {
    const key = r.workflow || "renewal";
    const e = engines.get(key) || { key, name: NAMES[key] || key[0].toUpperCase() + key.slice(1), live: 0, exceptions: 0, approvals: 0, waiting: 0, done: 0, next: null };
    const live = r.state !== "done" && r.state !== "cancelled";
    if (live) e.live++; else e.done++;
    if (r.state === "exception") e.exceptions++;
    if (r.state === "waiting_approval") e.approvals++;
    if (r.operational?.waitingFor) e.waiting++;
    for (const u of r.operational?.upcoming || []) if (!e.next || u.at < e.next.at) e.next = { at: u.at, label: u.label };
    engines.set(key, e);
  }
  const workflows = [...engines.values()].map((e) => ({
    id: "workflow:" + e.key,
    name: e.name,
    state: e.exceptions ? "Needs attention" : e.live ? "Running" : "Idle",
    tone: e.exceptions ? "red" : e.live ? "green" : "grey",
    lines: [
      plural(e.live, e.key === "renewal" ? "renewal in progress" : "run in progress", e.key === "renewal" ? "renewals in progress" : "runs in progress"),
      e.approvals ? plural(e.approvals, "waiting for approval", "waiting for approval") : null,
      e.waiting ? plural(e.waiting, "waiting on an outside party", "waiting on outside parties") : null,
      e.exceptions ? plural(e.exceptions, "exception", "exceptions") : null,
      e.done ? plural(e.done, "finished", "finished") : null,
    ].filter(Boolean),
    next: e.next ? e.next.label + " " + weekday(e.next.at) : "Nothing scheduled",
    ref: { ws: "renewal", workflow: e.key },
    canPause: false,
  }));
  const standing = S.all("automations").map((a) => {
    const runs = a.history || [];
    const failures = runs.filter((x) => x.outcome === "could_not_finish" || x.outcome === "exception");
    const last = runs[0] || null;
    const broken = !!a.legacyConditions;
    return {
      id: a.id,
      name: a.name,
      state: broken ? "Cannot run" : a.on ? (failures.length && failures[0] === last ? "Needs attention" : "Running") : "Paused",
      tone: broken || (failures.length && failures[0] === last) ? "red" : a.on ? "green" : "grey",
      lines: [
        "When " + (a.trigger || "its trigger fires"),
        runs.length ? plural(runs.length, "firing recorded", "firings recorded") : "Has not fired yet",
        failures.length ? plural(failures.length, "failure", "failures") : null,
        last ? "Last fired " + fmt(last.started_at) : null,
      ].filter(Boolean),
      next: a.on ? "Watching for the next " + (a.trigger || "event") : "Paused — it will not fire",
      ref: { ws: "automation", automationId: a.id },
      canPause: !broken,
      on: !!a.on,
      failure: failures[0] && failures[0] === last ? { id: a.id, name: a.name, reason: failures[0].reason } : null,
    };
  });
  return { workflows, standing };
}

const ACTION_WORDS = [
  [/approv/i, "approved"], [/reject|declin/i, "declined"], [/prepared|draft/i, "prepared"], [/sent|deliver/i, "sent"],
  [/record/i, "recorded"], [/created|opened|reported/i, "opened"], [/assign/i, "assigned"], [/schedul|follow_up|chase/i, "scheduled a follow-up on"],
  [/applied|apply/i, "applied"], [/cleared|clear/i, "cleared"], [/upload|filed/i, "filed"], [/import/i, "imported"],
];
const TECHNICAL = /^(conversation\.|work_item\.step_by_run$|workflow\.(step|tick|wake)|event\.|session\.|auth\.)/;

/** Activity: meaningful actions, newest first, in sentences; raw ids and technical events left out. */
export function activityLog({ filter = {} }) {
  const events = S.sel.audit().filter((a) => !TECHNICAL.test(a.action || ""));
  const rows = events.map((a) => {
    const asap = a.actorType === "automation" || a.actorType === "system" || /^workflow\./.test(a.action || "");
    const who = asap ? "ASAP" : a.actorName || "A person no longer in this brokerage";
    const verb = (ACTION_WORDS.find(([re]) => re.test(a.action || "")) || [null, (a.action || "").replace(/^[a-z_]+\./, "").replace(/[._]/g, " ")])[1];
    const what = a.record?.label || (a.action || "").split(".")[0].replace(/_/g, " ");
    const failed = a.result && a.result !== "success";
    return {
      id: a.id,
      at: a.at,
      when: new Date(a.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }),
      sentence: failed ? who + " tried to " + verb.replace(/ed$/, "") + " " + what + " — " + (a.result === "denied" ? "refused" : "it failed") : who + " " + verb + " " + what + ".",
      client: a.client || null,
      asap,
      approval: /approv/i.test(a.action || ""),
      external: !!a.external,
      workflow: /^workflow\.|run/i.test(a.action || "") || !!a.workItemId,
      ref: a.record?.kind === "client" ? { ws: "client", clientId: a.record.id } : a.workItemId ? { ws: "workitem", workItemId: a.workItemId } : a.client ? { ws: "client", clientId: a.client.id } : null,
    };
  });
  const q = (filter.q || "").trim().toLowerCase();
  return rows.filter((r) =>
    (!filter.who || (filter.who === "asap" ? r.asap : !r.asap)) &&
    (!filter.approvals || r.approval) &&
    (!filter.external || r.external) &&
    (!filter.workflow || r.workflow) &&
    (!filter.clientId || r.client?.id === filter.clientId) &&
    (!q || (r.sentence + " " + (r.client?.name || "")).toLowerCase().includes(q)),
  );
}
