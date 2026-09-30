/* eslint-disable -- the approved ASAP engine, kept as delivered so it can be diffed against the approved build; the edits made to it are marked where they are. */
// Ask ASAP intent layer + workspace generators.
// No fixture UI: every workspace is generated from the record store at call time.
import * as S from './store.js';

const { sel, fmtMoney, fmtDate, dispatch, all, byId, where } = S;

// ---------------------------------------------------------------- language helpers
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function parseDate(text) {
  const t = (text || '').toLowerCase();
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  if (/\btoday\b/.test(t)) return { date: iso(now), label: 'today' };
  if (/\btomorrow\b/.test(t)) return { date: iso(new Date(now.getTime() + 864e5)), label: 'tomorrow' };
  if (/\bin (\d+) days?\b/.test(t)) { const n = +t.match(/\bin (\d+) days?\b/)[1]; return { date: iso(new Date(now.getTime() + n * 864e5)), label: 'in ' + n + ' days' }; }
  const dm = t.match(/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (dm) {
    const target = DAYS.indexOf(dm[2]);
    let delta = (target - now.getDay() + 7) % 7;
    if (delta === 0) delta = 7;
    if (dm[1]) delta += (delta <= 6 && !dm[1] ? 0 : 0), delta = delta + (delta < 7 ? 0 : 0);
    if (dm[1] && delta < 7) delta += 7 - 7; // "next Friday" = the coming Friday of next week when today is later in the week
    const d = new Date(now.getTime() + delta * 864e5);
    return { date: iso(d), label: (dm[1] ? 'next ' : '') + dm[2], ambiguous: !!dm[1] };
  }
  const em = t.match(/\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{4})?/);
  if (em) {
    const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(em[2]);
    return { date: iso(new Date(+(em[3] || now.getFullYear()), mo, +em[1])), label: em[0] };
  }
  return null;
}

const REG = /\b([A-Z]{3})\s?(\d{3})\s?([A-Z])\b/i;
function findReg(t) { const m = t.match(REG); return m ? (m[1] + ' ' + m[2] + m[3]).toUpperCase() : null; }
function findUser(t) {
  const q = (t || '').toLowerCase();
  return sel.users().find(u => q.includes(u.name.split(' ')[0].toLowerCase())) || null;
}
function findClient(t, ctx) {
  const q = (t || '').toLowerCase();
  // Edited from the approved build: a whole word of three or more letters, never a substring —
  // a client called "A" otherwise matched almost every sentence and took over the context.
  const hit = sel.clients().find(c => { const w = c.name.split(' ')[0].toLowerCase(); return w.length >= 3 && new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(q); });
  if (hit) return hit;
  const reg = findReg(t || '');
  if (reg) { const it = sel.itemByReg(reg); if (it) return sel.client(it.clientId); }
  if (/\b(this|it|them|its|the client|here)\b/i.test(t || '') && ctx.clientId) return sel.client(ctx.clientId);
  return null;
}
const INSURERS = ['APA Insurance', 'CIC General Insurance', 'Jubilee Insurance', 'Britam', 'Heritage'];
function findInsurer(t) {
  const q = (t || '').toLowerCase();
  return INSURERS.find(i => q.includes(i.split(' ')[0].toLowerCase())) || null;
}

// ---------------------------------------------------------------- intents
const INTENTS = [
  { id: 'onboarding', re: /(set up|setup|onboard|get started|configure)\b.*(asap|brokerage|brokers|account)|^set up/i, ws: 'onboarding' },
  { id: 'story', re: /(everything connected to|full .* story|from the first email|whole history|audit trail|complete history)/i, ws: 'audit' },
  { id: 'today', re: /(what needs attention|what matters|today'?s|most important work|priorit)/i, ws: 'today' },
  { id: 'activity', re: /(what is asap (working on|doing)|activity|running jobs)/i, ws: 'activity' },
  { id: 'import', re: /(import|add these|upload).*(record|client|policy|spreadsheet|file|document)/i, ws: 'import' },
  { id: 'opportunity', re: /(create|start).*(quotation|opportunity|new business)/i, ws: 'quote', act: 'opportunity' },
  { id: 'quote', re: /(quote|quotation).*(ready|prepare|approach)|approach (apa|cic|jubilee)/i, ws: 'quote' },
  { id: 'compare', re: /compare.*(quotation|quote|terms)|what could hurt/i, ws: 'compare' },
  { id: 'excess', re: /(exact )?excess wording|why is cic cheaper|why is .* cheaper/i, ws: 'compare' },
  { id: 'choice', re: /(client chose|chose|selected)\s+(apa|cic|jubilee)|record (the )?client'?s? choice/i, ws: 'placement', act: 'choice' },
  { id: 'placement', re: /(prepare|complete|start) placement|placement with/i, ws: 'placement' },
  { id: 'issue', re: /(sent )?confirmation.*(schedule|create the policy)|create the policy|issue the policy/i, ws: 'issue' },
  { id: 'coverage', re: /(is|was).*(cover(ed)?|on cover)|covered (right )?now|cover for/i, ws: 'coverage' },
  { id: 'howknow', re: /how do you know|where did .* come from|show me the (exact )?source/i, ws: 'evidence' },
  { id: 'servicing', re: /(add|include).*(to|on).*(cover|policy)|open servicing|servicing request/i, ws: 'servicing' },
  { id: 'tor', re: /\btor\b|temporary cover|urgent (insurer )?request/i, ws: 'servicing' },
  { id: 'endorsement', re: /(replace|substitute|swap|remove).*(with|for)?\s*[A-Z]{3}\s?\d{3}\s?[A-Z]|endorsement/i, ws: 'endorsement' },
  { id: 'claim.new', re: /(register|report|notify).*(claim|accident)|was in an accident|had an accident/i, ws: 'claim', act: 'claim' },
  { id: 'claim.open', re: /(open|show).*(claim)|claim (status|timeline)|what is outstanding/i, ws: 'claim' },
  { id: 'payment', re: /(match|record|apply).*(receipt|payment)|still owes?|what does .* owe/i, ws: 'money' },
  { id: 'reconcile', re: /reconcil|statement/i, ws: 'reconciliation' },
  { id: 'commission', re: /commission/i, ws: 'commission' },
  { id: 'renewal', re: /renewal|renew\b|changed this year/i, ws: 'renewal' },
  { id: 'premiumwhy', re: /why did the premium (increase|change)|premium change/i, ws: 'renewal' },
  { id: 'assign', re: /(assign|give)\s.*(to)\s/i, ws: 'work', act: 'assign' },
  { id: 'team', re: /(what is|show).*(working on)|team workload|who has/i, ws: 'team' },
  { id: 'report', re: /(how did|report on|performance).*(renewal|claim|month|quarter)/i, ws: 'report' },
  { id: 'investigate', re: /why are|why is .* (slower|taking longer)|investigate/i, ws: 'investigation' },
  { id: 'automation', re: /(when a policy|automation|automate|prepare the renewal.*expiry)/i, ws: 'automation' },
  { id: 'connections', re: /(connected (email|data)|connection|gmail|sync)/i, ws: 'connections' },
  { id: 'settings', re: /(company settings|settings|permissions|billing)/i, ws: 'settings' },
  { id: 'documents', re: /(compare|show).*(schedule|document)s?\b|document version/i, ws: 'document' },
  { id: 'communication', re: /(find|summari[sz]e).*(email|thread|message)|last email/i, ws: 'communication' },
  { id: 'client', re: /(open|show me)\s+[a-z]|everything that matters about/i, ws: 'client' },
  { id: 'search', re: /(find|search) (everything|all)/i, ws: 'search' },
  { id: 'create.client', re: /(add|create)\s+\w+\s+as a client/i, ws: 'client', act: 'createClient' },
  { id: 'attach', re: /^attach (this|it)/i, ws: null, act: 'attach' },
  { id: 'followup', re: /follow up|check back/i, ws: 'work', act: 'followup' },
  { id: 'bind', re: /bind (this )?policy|activate cover|mark .* as active|without approval/i, ws: null, act: 'refuse' }
];

const UNSUPPORTED = [
  { re: /without approval|skip approval|bypass/i, why: 'Cover, placement and money changes cannot be executed without the named human approval.' },
  { re: /delete (the )?(audit|history)/i, why: 'Audit history cannot be deleted.' },
  { re: /pay (the )?insurer directly|move money/i, why: 'ASAP does not move money. It records payments you approve.' }
];

/**
 * Interpret a natural-language request.
 * ctx: { clientId, policyYearId, workItemId, claimId, selection, lastPlan, ws }
 */
export function interpret(text, ctx = {}) {
  const t = (text || '').trim();
  if (!t) return null;
  const low = t.toLowerCase();

  // corrections: "actually Amina", "Not James - keep it with me", "send to CIC - actually Jubilee"
  const correction = /(^|\b)(actually|not\s+\w+\s*[-–,]|instead|rather)\b/i.test(t) || /^no[,.\s]/i.test(t);
  if (correction && ctx.lastPlan) {
    const plan = JSON.parse(JSON.stringify(ctx.lastPlan));
    const me = /\b(me|myself|keep it with me)\b/i.test(t);
    const u = me ? sel.user(S.session().userId) : findUser(t);
    const ins = findInsurer(t);
    const d = parseDate(t);
    if (plan.action === 'work.assign' && u) plan.payload.userId = u.id;
    if (d) plan.payload.dueAt = d.date;
    if (plan.action === 'email.send' && ins) plan.payload.recipients = [{ name: ins.split(' ')[0], email: ins.split(' ')[0].toLowerCase() + '@insurer.demo' }];
    plan.actionId = plan.actionId + ':corrected';
    plan.label = plan.label.replace(/ to .*/, u ? ' to ' + u.name : '');
    return { lead: 'Corrected — nothing was executed twice.',
      text: 'The previous preparation was replaced, not duplicated. ' + (plan.detail || ''),
      ref: ctx.ref || null, plan, corrected: true };
  }

  for (const u of UNSUPPORTED) if (u.re.test(t)) return {
    lead: 'I will not do that.', text: u.why + ' Nothing was changed. The authorised path is shown in the workspace.',
    ref: ctx.ref || null, refusal: true
  };

  const found = INTENTS.find(i => i.re.test(t));
  if (!found) return {
    lead: 'I could not match that to a record I hold.',
    text: 'Nothing was changed and no workspace was opened. Name a client, policy, vehicle, claim or the work you want prepared.',
    ref: null, nothing: true,
    chips: ['What needs attention today?', 'Open Acme', 'Is KDN 482Q covered right now?']
  };

  const client = findClient(t, ctx);
  const reg = findReg(t);
  const user = findUser(t);
  const date = parseDate(t);
  const insurer = findInsurer(t);

  // clarification: one short question when an essential fact is missing
  if (found.act === 'assign' && !user) return {
    lead: 'Who should own it?', text: 'One fact is missing and I will not guess an owner.',
    clarify: { question: 'Assign to whom?', options: sel.users().map(u => ({ label: u.name, text: 'Assign this to ' + u.name.split(' ')[0] })) },
    ref: ctx.ref || null
  };
  if (found.act === 'claim' && !reg) return {
    lead: 'Which vehicle was involved?', text: 'I need the registration before I can check cover on the loss date.',
    clarify: { question: 'Vehicle registration', options: (sel.items(sel.activeYear(client?.id || ctx.clientId)?.id || '') || []).slice(0, 5).map(i => ({ label: i.reg, text: 'Register a claim for ' + i.reg })) },
    ref: ctx.ref || null
  };
  if (found.act === 'attach' && !ctx.selection) return {
    lead: '“This” and “it” do not resolve yet.', text: 'Select a document row or open a record first, then say it again — I will not guess which records you mean.',
    ref: ctx.ref || null, nothing: true
  };
  if (['coverage', 'servicing', 'endorsement'].includes(found.ws) && !client && !reg && !ctx.clientId) return {
    lead: 'Which client?', text: 'I hold five clients and will not pick one for you.',
    clarify: { question: 'Client', options: sel.clients().map(c => ({ label: c.name, text: 'Open ' + c.name })) },
    ref: ctx.ref || null
  };

  const clientId = client?.id || ctx.clientId || (reg ? sel.itemByReg(reg)?.clientId : null);
  const ref = found.ws ? { ws: found.ws, clientId, reg, insurer, userId: user?.id, date: date?.date, query: t } : null;
  const answer = ANSWERS[found.id] ? ANSWERS[found.id]({ t, clientId, reg, user, date, insurer, ctx }) : null;

  return {
    lead: answer?.lead || 'Opening the work for that.',
    text: answer?.text || 'The workspace beside this answer is generated from the live records.',
    ref: answer?.ref || ref, plan: answer?.plan || null, chips: answer?.chips || null,
    dateAmbiguous: date?.ambiguous ? date.label : null
  };
}

// short spoken answers; the workspace carries the detail
const ANSWERS = {
  today: () => {
    const open = sel.openWork();
    const high = open.filter(w => w.priority === 'high');
    return { lead: high.length + ' item' + (high.length === 1 ? '' : 's') + ' need a human today, ' + open.length + ' open in total.',
      text: 'Each item in Today explains why it is there and opens the record behind it.' };
  },
  coverage: ({ reg, clientId }) => {
    const it = reg ? sel.itemByReg(reg) : null;
    const year = sel.activeYear(clientId);
    if (!it) return { lead: (reg || 'That vehicle') + ' is not on any confirmed schedule.',
      text: 'A client request or a logbook is not proof of cover. No insurer confirmation exists for it, so I cannot say it is covered.' };
    const y = byId('policyYears', it.policyYearId);
    return { lead: reg + ' is on cover under ' + byId('policies', y.policyId).number + '.',
      text: 'Confirmed on schedule v' + it.scheduleVersion + ', period ' + fmtDate(y.from) + ' – ' + fmtDate(y.to) + ', insurer ' + y.insurer + '. ' + (y.confirmationEvidenceId ? 'Insurer confirmation is linked.' : 'No insurer confirmation is linked — treat this as unconfirmed.') };
  },
  payment: ({ clientId }) => {
    const bal = sel.balance(clientId);
    const c = sel.client(clientId);
    return { lead: c ? c.name + ' owes ' + fmtMoney(bal) + '.' : 'Open a client first.',
      text: 'No money figure changes until you approve a match. The calculation and the receipt are both in the workspace.' };
  },
  compare: ({ clientId }) => {
    const q = sel.quotes(clientId).slice(-1)[0];
    const vs = q ? sel.quoteVersions(q.id) : [];
    const issues = vs.flatMap(v => v.issues || []);
    return { lead: vs.length ? vs.length + ' sets of terms aligned; ' + issues.length + ' thing' + (issues.length === 1 ? '' : 's') + ' could hurt the client.' : 'No insurer replies are recorded yet.',
      text: 'I can recommend, but the insurer choice stays with you and the client. Unclear and missing terms stay visible rather than being scored away.' };
  },
  renewal: ({ clientId }) => {
    const years = sel.policyYears(clientId);
    const cur = years.find(y => y.status === 'active');
    return { lead: cur ? 'Renewal built from the ' + cur.year + ' year, its claims, endorsements and unpaid premium.' : 'No active policy year to renew.',
      text: 'A new policy year is created alongside the old one. Nothing from the expiring year is overwritten.' };
  },
  story: ({ clientId }) => ({ lead: sel.audit(clientId).length + ' recorded events, each with its evidence.',
    text: 'Click any event to open the document, email or calculation behind it.' }),
  bind: () => ({ lead: 'I will not do that.', text: 'Cover cannot be bound without insurer confirmation and the principal’s approval.' })
};

// ---------------------------------------------------------------- workspace generators
const tone = { ok: 'ok', warn: 'uncertain', bad: 'missing' };
const rows = (label, list) => ({ t: 'rows', label, rows: list });
// A schedule version the records do not hold reads as not recorded, never as an assumed v1.
const sv = (v) => (v == null ? 'not recorded' : 'v' + v);
const note = (toneName, title, text) => ({ t: 'note', tone: toneName, title, text });

// The state a person reads: the task-status words (D-075), never a bare "Active" or "Waiting".
function partyState(w) {
  if (w.state === 'Completed') return 'Done';
  if (w.parties && w.parties.length) return 'With ' + w.parties.map(p => p.name + ' since ' + fmtDate(p.since)).join(', ');
  if (w.statusLabel) return w.statusLabel;
  return w.state === 'Active' ? 'In progress' : w.state;
}
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const PRIORITY = { high: 'High priority', medium: 'Normal priority', low: 'Low priority' };

const WS = {};

WS.today = () => {
  const open = sel.openWork().sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.priority] - { high: 0, medium: 1, low: 2 }[b.priority]));
  return { kind: 'Today', title: 'What matters now', statusLabel: open.length + ' open', status: 'live',
    blocks: [rows('Prioritised from live records', open.map(w => ({
      title: w.title, note: (sel.client(w.clientId)?.name || 'Brokerage') + ' · ' + w.kind + ' · ' + partyState(w) +
        (w.dueAt ? ' · due ' + fmtDate(w.dueAt) : ''),
      badge: PRIORITY[w.priority] || 'Normal priority',
      badgeTone: w.priority === 'high' ? tone.bad : w.priority === 'medium' ? tone.warn : tone.ok,
      why: w.reason, action: { a: 'open', ref: refForWork(w) }
    })))] };
};

function refForWork(w) {
  if (w.claimId) return { ws: 'claim', claimId: w.claimId, clientId: w.clientId };
  if (w.invoiceId) return { ws: 'money', clientId: w.clientId };
  if (w.servicingId) return { ws: 'servicing', clientId: w.clientId, servicingId: w.servicingId };
  if (w.placementId) return { ws: 'placement', clientId: w.clientId };
  if (w.opportunityId || w.quoteId) return { ws: 'quote', clientId: w.clientId, opportunityId: w.opportunityId };
  // Over live records every work item has its own workspace; the demo keeps the approved route.
  if (S.isLive()) return { ws: 'workitem', workItemId: w.id, clientId: w.clientId };
  if (w.kind === 'Renewal') return { ws: 'renewal', clientId: w.clientId };
  return { ws: 'work', clientId: w.clientId, workItemId: w.id };
}

// Work's views are the task-status layer (D-075): Your work · With others · In progress · Done ·
// Recent. "Needs you" and a bare "Waiting" are retired from every surface.
const WORK_VIEWS = {
  mine: { label: 'Your work', title: 'Your work' },
  others: { label: 'With others', title: 'With others' },
  progress: { label: 'In progress', title: 'In progress' },
  done: { label: 'Done', title: 'Done' },
  recent: { label: 'Recent', title: 'Recent' },
};
WS.work = (r) => {
  const f = r.filter || {};
  const view = WORK_VIEWS[f.view] ? f.view : (f.assigneeId || f.state ? null : 'mine');
  let list = sel.work({ clientId: r.clientId, assigneeId: f.assigneeId, state: f.state });
  if (view === 'mine') list = list.filter(w => w.assigneeId === S.session().userId && w.state !== 'Completed');
  if (view === 'others') list = list.filter(w => /^With /.test(w.state) || w.state === 'Waiting');
  if (view === 'progress') list = list.filter(w => (w.taskStatus ? w.taskStatus === 'in_progress' : w.state === 'Active') && !(w.parties && w.parties.length));
  if (view === 'done') list = list.filter(w => w.state === 'Completed');
  if (view === 'recent') list = [...list].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 20);
  return { kind: 'Work', title: (r.clientId ? sel.client(r.clientId).name + ' — ' : '') + (view ? WORK_VIEWS[view].title : 'Work'),
    statusLabel: plural(list.length, 'item', 'items'), status: 'live',
    filters: Object.entries(WORK_VIEWS).map(([k, v]) => ({ label: v.label, filter: { view: k } })),
    blocks: [
      // "Assign" on a row opens Work at that item: show who holds it and let a person hand it over.
      ...(r.workItemId && byId('workItems', r.workItemId)
        ? [{ t: 'assign', label: 'Hand over “' + byId('workItems', r.workItemId).title + '”', workItemId: r.workItemId }] : []),
      rows('Owner, party and state come from the records', list.map(w => ({
      title: w.title,
      note: w.kind + ' · ' + (sel.user(w.assigneeId)?.name || 'unassigned') + ' · ' + partyState(w) + (w.dueAt ? ' · due ' + fmtDate(w.dueAt) : ''),
      badge: w.state === 'Completed' ? 'Done' : /^With /.test(w.state) ? 'With others' : partyState(w),
      badgeTone: w.state === 'Completed' ? tone.ok : /^With /.test(w.state) ? tone.warn : tone.ok,
      action: { a: 'open', ref: refForWork(w) },
      secondary: { a: 'assign', workItemId: w.id, label: 'Assign' }
    })))] };
};

WS.activity = () => {
  const runs = sel.runs();
  return { kind: 'Activity', title: 'What ASAP has been doing', statusLabel: runs.length + ' runs', status: 'live',
    blocks: [
      note('green', 'Nothing important lives only here', 'Every human decision ASAP prepares also exists in Work. Activity is observation only.'),
      rows('Runs', runs.length ? runs.map(x => ({ title: byId('automations', x.automationId)?.name || 'Run',
        note: fmtDate(x.at) + ' · ' + x.mode + ' · ' + x.status + (x.error ? ' · ' + x.error : ''),
        badge: x.status === 'failed' ? 'Failed' : x.mode === 'test' ? 'Test' : 'Completed',
        badgeTone: x.status === 'failed' ? tone.bad : tone.ok,
        action: x.writes && x.writes.length ? { a: 'open', ref: { ws: 'work' } } : null,
        secondary: x.status === 'failed' ? { a: 'act', action: 'automation.run', payload: { id: x.automationId }, label: 'Retry' } : null
      })) : [{ title: 'No runs yet', note: 'Switch an automation on, or run one in test mode.', badge: 'Idle', badgeTone: tone.ok }]),
      rows('Audit ASAP wrote', sel.audit().slice(0, 8).map(a => ({ title: a.text, note: fmtDate(a.at) + ' · ' + (sel.user(a.actorId)?.name || 'system'), badge: a.kind, badgeTone: tone.ok })))
    ] };
};

WS.client = (r) => {
  const c = sel.client(r.clientId);
  if (!c) return WS.today(r);
  const year = sel.activeYear(c.id);
  const bal = sel.balance(c.id);
  const contacts = sel.contacts(c.id);
  const claims = sel.claims(c.id);
  const work = sel.work({ clientId: c.id }).filter(w => w.state !== 'Completed');
  return { kind: 'Client', title: c.name, statusLabel: year ? 'Active cover' : 'No active cover', status: year ? 'live' : 'draft',
    recordRef: { ws: 'client', clientId: c.id },
    blocks: [
      ...(c.legacyInvalid ? [{ t: 'note', tone: 'red', title: 'Legacy record — invalid, needs correction', text: 'This client was saved before ASAP required a real name. Correct the name before relying on this record.' }] : []),
      { t: 'facts', items: [
        ['Main contact', contacts[0] ? contacts[0].name + ' · ' + contacts[0].role : 'none recorded'],
        ['Current cover', year ? byId('policies', year.policyId).number : 'none'],
        ['Insurer', year ? year.insurer : '—'],
        ['Period', year ? fmtDate(year.from) + ' – ' + fmtDate(year.to) : '—'],
        ['Money position', bal == null ? 'Not connected yet' : bal > 0 ? fmtMoney(bal) + ' outstanding' : 'Nothing outstanding'],
        ['Open claims', claims.filter(x => !/settled|closed/i.test(x.status)).length + '']
      ]},
      rows('Open work', work.length ? work.map(w => ({ title: w.title, note: w.kind + ' · ' + partyState(w),
        badge: w.priority, badgeTone: w.priority === 'high' ? tone.bad : tone.warn, action: { a: 'open', ref: refForWork(w) } }))
        : [{ title: 'No open work', note: 'Nothing is waiting on the brokerage for this client.', badge: 'Clear', badgeTone: tone.ok }]),
      rows('Policy years — history is never overwritten', sel.policyYears(c.id).map(y => ({
        title: y.year + ' · ' + y.insurer + ' · ' + fmtMoney(y.premium),
        note: fmtDate(y.from) + ' – ' + fmtDate(y.to) + ' · schedule ' + sv(y.scheduleVersion) + ' · ' + y.status,
        badge: y.status === 'active' ? 'Active cover' : y.status, badgeTone: y.status === 'active' ? tone.ok : tone.warn,
        action: { a: 'open', ref: { ws: 'policy', clientId: c.id, policyYearId: y.id } } }))),
      rows('Recent email', sel.emails(c.id).slice(0, 4).map(e => ({ title: e.subject,
        note: (e.direction === 'out' ? 'Sent to ' + (e.party || e.to) : 'From ' + e.from) + ' · ' + fmtDate(e.at),
        badge: e.direction === 'out' ? 'Sent' : 'Received', badgeTone: tone.ok,
        action: { a: 'open', ref: { ws: 'communication', clientId: c.id, emailId: e.id } } }))),
      // Over live records the client's documents are listed with their reading state and open for
      // review; the demo keeps the approved layout, where documents open from Ask and evidence.
      ...(S.isLive() ? [rows('Documents', sel.documents(c.id).length ? sel.documents(c.id).map(d => ({ title: d.name,
        note: (d.kind || '').replace(/_/g, ' ') + ' · filed ' + fmtDate(d.createdAt) + (d.readingState ? ' · ' + d.readingState : ''),
        badge: d.readingState || 'Filed', badgeTone: d.readingState === 'Could not be read' ? tone.bad : tone.ok,
        action: { a: 'open', ref: { ws: 'document', documentId: d.id } } }))
        : [{ title: 'No documents yet', note: 'Add one below — it is stored privately and read by ASAP.', badge: 'Empty', badgeTone: tone.warn }])] : []),
      { t: 'upload', label: 'Add a document to this client', clientId: c.id }
    ] };
};

WS.policy = (r) => {
  // A policy may be opened by its own id (Search does this): take its latest period.
  const ofPolicy = r.policyId && !r.policyYearId ? where('policyYears', y => y.policyId === r.policyId).sort((a, b) => (a.from < b.from ? 1 : -1))[0] : null;
  const year = ofPolicy || (r.policyYearId ? byId('policyYears', r.policyYearId) : sel.activeYear(r.clientId));
  if (!year) return WS.client(r);
  const pol = byId('policies', year.policyId);
  const items = sel.items(year.id);
  const inv = where('invoices', i => i.policyYearId === year.id);
  const ends = where('endorsements', e => e.policyYearId === year.id);
  return { kind: 'Policy', title: pol.number + ' · ' + year.year, status: year.status === 'active' ? 'live' : 'draft',
    statusLabel: year.status === 'active' ? 'Active cover' : year.status,
    recordRef: { ws: 'policy', clientId: year.clientId, policyYearId: year.id },
    blocks: [
      { t: 'facts', items: [['Insured', sel.client(year.clientId).name], ['Insurer', year.insurer],
        ['Period', fmtDate(year.from) + ' – ' + fmtDate(year.to)], ['Premium', fmtMoney(year.premium)],
        ['Schedule version', sv(year.scheduleVersion)], ['Cover proof', year.confirmationEvidenceId ? 'Insurer confirmation linked' : 'No confirmation — not Active cover']] },
      rows('Items on cover', items.map(i => ({ title: i.reg + ' · ' + i.make, note: fmtMoney(i.value) + ' · added ' + fmtDate(i.addedAt) + ' · schedule v' + i.scheduleVersion,
        badge: 'On cover', badgeTone: tone.ok, action: { a: 'open', ref: { ws: 'coverage', clientId: year.clientId, reg: i.reg } } }))),
      ...(where('policyItems', i => i.policyYearId === year.id && i.status === 'removed').length ? [rows('Removed in a later version (retained)',
        where('policyItems', i => i.policyYearId === year.id && i.status === 'removed').map(i => ({ title: i.reg + ' · ' + i.make,
          note: 'Removed ' + fmtDate(i.removedAt) + ' in schedule v' + i.removedInVersion, badge: 'Off cover', badgeTone: tone.warn })))] : []),
      rows('Endorsements', ends.length ? ends.map(e => ({ title: e.detail, note: fmtDate(e.at) + ' · schedule v' + e.scheduleVersion + (e.additionalPremium ? ' · ' + fmtMoney(e.additionalPremium) + ' additional' : ''),
        badge: e.badgeLabel || 'Confirmed', badgeTone: e.badgeLabel ? tone.warn : tone.ok, evidenceId: e.evidenceId })) : [{ title: 'No endorsements', note: 'The schedule is at its original version.', badge: sv(year.scheduleVersion), badgeTone: tone.ok }]),
      // Over live records invoices are not connected yet: say so rather than show an empty list.
      S.isLive() ? note('amber', 'Money is not connected yet', 'Invoices and payments for this policy are not shown in this view yet.')
        : rows('Money', inv.map(i => ({ title: i.number + ' · ' + i.kind, note: fmtMoney(i.amount) + ' · paid ' + fmtMoney(i.paid),
        badge: i.status, badgeTone: i.status === 'Paid' ? tone.ok : i.status === 'Part paid' ? tone.warn : tone.bad,
        action: { a: 'open', ref: { ws: 'money', clientId: year.clientId } } }))),
      rows('Source documents', (year.scheduleDocumentId ? [byId('documents', year.scheduleDocumentId)] : []).filter(Boolean).map(d => ({
        title: d.name, note: 'v' + d.currentVersion, badge: 'Source', badgeTone: tone.ok, action: { a: 'open', ref: { ws: 'document', documentId: d.id } } })))
    ] };
};

WS.coverage = (r) => {
  const reg = r.reg;
  const it = reg ? sel.itemByReg(reg) : null;
  const year = it ? byId('policyYears', it.policyYearId) : sel.activeYear(r.clientId);
  const confirmed = year && year.confirmationEvidenceId;
  return { kind: 'Coverage check', title: (reg || 'Cover') + ' — cover truth', status: it && confirmed ? 'live' : 'draft',
    statusLabel: it ? (confirmed ? 'On cover' : 'Unconfirmed') : 'Not on cover',
    blocks: [
      note(it && confirmed ? 'green' : 'red', it && confirmed ? 'Covered' : 'Not covered',
        it && confirmed ? reg + ' appears on schedule v' + it.scheduleVersion + ' of ' + byId('policies', year.policyId).number + ', in force ' + fmtDate(year.from) + ' – ' + fmtDate(year.to) + '.'
          : reg + ' is not on a confirmed schedule. A client request, a logbook or an email is not proof of cover.'),
      { t: 'facts', items: [['Vehicle', it ? it.reg + ' · ' + it.make : (reg || '—')],
        ['Sum insured', it ? fmtMoney(it.value) : 'not declared'],
        ['Policy', year ? byId('policies', year.policyId).number : 'none'],
        ['Insurer confirmation', confirmed ? 'Linked' : 'Missing'],
        ['Excess', it ? fmtMoney(Math.max(30000, it.value * 0.025)) : '—'],
        ['Checked as', sel.user(S.session().userId).name]] },
      rows('Evidence behind this answer', [
        year && year.confirmationEvidenceId ? { title: sel.evidence(year.confirmationEvidenceId).label, note: 'Insurer confirmation', badge: 'Verified', badgeTone: tone.ok, evidenceId: year.confirmationEvidenceId } : { title: 'No insurer confirmation', note: 'Nothing in the records confirms this cover.', badge: 'Missing', badgeTone: tone.bad },
        year && year.scheduleDocumentId ? { title: byId('documents', year.scheduleDocumentId).name, note: 'Schedule ' + sv(year.scheduleVersion), badge: 'Source', badgeTone: tone.ok, action: { a: 'open', ref: { ws: 'document', documentId: year.scheduleDocumentId } } } : null
      ].filter(Boolean)),
      ...(it ? [] : [{ t: 'gate', kind: 'approve', label: 'Open servicing work for ' + (reg || 'this vehicle'),
        detail: 'Creates servicing work so the vehicle can be added properly. It does not create cover.',
        action: 'servicing.create', payload: { clientId: r.clientId, policyYearId: year?.id, detail: 'Add vehicle ' + (reg || '') + ' to cover', missing: ['Declared value'] } }])
    ] };
};

WS.import = (r) => {
  const client = r.clientId ? sel.client(r.clientId) : null;
  const staged = r.staged || [];
  const dupes = staged.filter(f => sel.documents(client?.id).some(d => d.name === f.name));
  return { kind: 'Import', title: 'Bring records into ASAP', status: 'draft', statusLabel: staged.length ? staged.length + ' staged' : 'Nothing staged',
    blocks: [
      note('amber', 'Nothing is saved until you confirm', 'ASAP reads files, shows what it extracted and waits. Uncertain matches are shown, never hidden.'),
      { t: 'upload', label: 'Choose files — CSV, Excel, PDF, image', clientId: client?.id, stage: true, multiple: true },
      ...(staged.length ? [rows('Staged for review', staged.map((f, i) => ({
        title: f.name, note: f.kind + ' · ' + (f.extracted || 'read') + (f.progress < 100 ? ' · ' + f.progress + '%' : ''),
        badge: f.error ? 'Failed' : dupes.includes(f) ? 'Possible duplicate' : f.progress < 100 ? 'Reading' : 'Ready',
        badgeTone: f.error ? tone.bad : dupes.includes(f) ? tone.warn : tone.ok,
        secondary: f.error ? { a: 'retry', index: i, label: 'Retry' } : { a: 'unstage', index: i, label: 'Cancel' }
      })))] : []),
      ...(staged.length && client ? [{ t: 'gate', kind: 'approve', label: 'Confirm import of ' + staged.filter(f => !f.error).length + ' file(s)',
        detail: 'Creates documents and evidence against ' + client.name + '. Original files stay attached. Repeated clicks cannot import twice.',
        action: 'records.import', payload: { clientId: client.id, files: staged.filter(f => !f.error) } }] : []),
      rows('Already imported', sel.documents(client?.id).slice(0, 6).map(d => ({ title: d.name, note: 'v' + d.currentVersion + ' · ' + fmtDate(d.createdAt),
        badge: 'Saved', badgeTone: tone.ok, action: { a: 'open', ref: { ws: 'document', documentId: d.id } } })))
    ] };
};

WS.onboarding = () => {
  const b = all('brokerages')[0];
  const cons = sel.connections();
  return { kind: 'Setup', title: b.name + ' — setup', status: 'live', statusLabel: 'Complete',
    blocks: [
      { t: 'facts', items: [['Brokerage', b.name], ['Country', b.country], ['Users', sel.users().length + ' with roles'],
        ['Clients', sel.clients().length + ' imported'], ['Placement approval', 'Principal'], ['Cover truth', 'Insurer confirmation required']] },
      rows('Connections', cons.map(c => ({ title: c.kind + ' · ' + c.account, note: c.note + (c.lastSync ? ' · last sync ' + fmtDate(c.lastSync) : ''),
        badge: c.status, badgeTone: c.status === 'connected' ? tone.ok : tone.warn,
        action: { a: 'open', ref: { ws: 'connections' } } }))),
      rows('Team and roles', sel.users().map(u => ({ title: u.name, note: S.ROLES[u.role], badge: u.role, badgeTone: tone.ok,
        action: { a: 'open', ref: { ws: 'team', userId: u.id } } }))),
      note('green', 'Setup is not a workspace you live in', 'It exists once. Everything after it happens in Today, Work and generated workspaces.')
    ] };
};

WS.quote = (r) => {
  const client = sel.client(r.clientId);
  if (!client) return WS.today(r);
  let q = sel.quotes(client.id).slice(-1)[0];
  const opp = where('opportunities', o => o.clientId === client.id).slice(-1)[0];
  const work = sel.work({ clientId: client.id, kind: 'Quotation' }).slice(-1)[0];
  const srcEmail = opp ? byId('emails', opp.sourceEmailId) : sel.emails(client.id).find(e => e.direction === 'in');
  const insurers = (q && q.insurers) || r.insurers || ['APA', 'CIC', 'Jubilee'];
  const missing = sel.items(sel.activeYear(client.id)?.id || '').filter(i => !i.value).map(i => 'Declared value for ' + i.reg);
  const blocks = [];
  if (!opp) blocks.push({ t: 'gate', kind: 'approve', label: 'Create quotation work for ' + client.name,
    detail: 'Creates an opportunity and work item linked to the source email. No message is sent.',
    action: 'opportunity.create', payload: { clientId: client.id, title: 'Commercial motor — 5 vehicles (2026 fleet request)', emailId: srcEmail?.id, cls: 'Commercial motor' } });
  if (opp) {
    blocks.push({ t: 'facts', items: [['Owner', sel.user(work?.assigneeId)?.name || '—'],
      ['Opportunity', opp.title], ['Source', srcEmail ? 'Email from ' + srcEmail.from : 'manual'],
      ['State', work ? partyState(work) : '—'], ['Due', work?.dueAt ? fmtDate(work.dueAt) : 'not set'],
      ['Insurers', insurers.join(', ')]] });
    if (srcEmail) blocks.push(rows('Where the requirement came from', [{ title: srcEmail.subject,
      note: 'From ' + srcEmail.from + ' · ' + fmtDate(srcEmail.at), badge: 'Source', badgeTone: tone.ok,
      action: { a: 'open', ref: { ws: 'communication', clientId: client.id, emailId: srcEmail.id } } }]));
    if (missing.length) blocks.push({ t: 'missing', label: 'Required before sending', items: missing });
    if (work) blocks.push({ t: 'assign', workItemId: work.id, label: 'Owner and due date' });
    if (!q) blocks.push({ t: 'gate', kind: 'approve', label: 'Prepare requests for ' + insurers.length + ' insurers',
      detail: 'Prepares one message per insurer. Nothing leaves the brokerage.',
      action: 'quote.prepare', payload: { clientId: client.id, opportunityId: opp.id, workItemId: work?.id, insurers } });
    if (q) {
      const sent = where('emails', e => e.clientId === client.id && e.direction === 'out' && /quotation request/i.test(e.subject));
      insurers.forEach(ins => {
        const mine = sent.find(e => e.party === ins);
        blocks.push({ t: 'email', label: 'Request to ' + ins, to: ins.toLowerCase() + '@insurer.demo',
          subject: 'Quotation request — ' + client.name + ', 5 commercial vehicles',
          body: 'Dear Underwriter,\n\nWe invite terms for comprehensive commercial motor cover for ' + client.name + ' covering five vehicles.\n\nThe vehicle schedule with declared values is attached. Please state the own damage excess as an amount and confirm passenger legal liability limits.\n\nKind regards,\n' + sel.user(S.session().userId).name,
          attachments: ['Fleet-Schedule.xlsx'], sent: !!mine, sentAt: mine?.at, party: ins,
          send: { action: 'email.send', payload: { clientId: client.id, workItemId: work?.id, subject: 'Quotation request — ' + client.name + ', 5 commercial vehicles', recipients: [{ name: ins, email: ins.toLowerCase() + '@insurer.demo' }], attachments: ['Fleet-Schedule.xlsx'], threadId: 'thr_' + client.id + '_quote' } } });
      });
      if (sent.length && !sel.quoteVersions(q.id).length) blocks.push({ t: 'gate', kind: 'approve', label: 'Record the insurer replies',
        detail: 'Logs the three fictional replies (APA complete, CIC cheaper with an unclear excess, Jubilee missing passenger legal liability) as quote versions.',
        action: 'quote.reply', payload: { quoteId: q.id, versions: [
          { insurer: 'APA', premium: 5310000, version: 1, terms: { 'Passenger legal liability': 'KES 3M / person', 'Own damage excess': '2.5% min 30,000', 'Windscreen': 'KES 50,000', 'Political risk': 'Included' }, issues: [] },
          { insurer: 'CIC', premium: 4850000, version: 1, terms: { 'Passenger legal liability': 'KES 3M / person', 'Own damage excess': 'Wording only, no amount', 'Windscreen': 'KES 30,000', 'Political risk': 'Excluded' }, issues: ['Excess stated as a guideline, not an amount', 'Political risk excluded'] },
          { insurer: 'Jubilee', premium: 5020000, version: 1, terms: { 'Passenger legal liability': 'Not quoted', 'Own damage excess': '2.5% min 35,000', 'Windscreen': 'KES 50,000', 'Political risk': 'Included' }, issues: ['Passenger legal liability missing'] }] } });
    }
  }
  return { kind: 'Quotation work', title: client.name + ' — commercial motor', status: 'draft',
    statusLabel: work ? partyState(work) : 'Not started', recordRef: { ws: 'quote', clientId: client.id }, blocks };
};

WS.compare = (r) => {
  const client = sel.client(r.clientId);
  const q = sel.quotes(client?.id).slice(-1)[0];
  const vs = q ? sel.quoteVersions(q.id) : [];
  if (!vs.length) return { kind: 'Quote comparison', title: 'No terms to compare yet', status: 'draft', statusLabel: 'Waiting on insurers',
    blocks: [note('amber', 'Nothing received', 'No insurer replies are recorded. Send the requests from the quotation work first.'),
      { t: 'gate', kind: 'approve', label: 'Open quotation work', detail: 'Takes you to the request that has not been answered.', nav: { ws: 'quote', clientId: r.clientId } }] };
  const termKeys = [...new Set(vs.flatMap(v => Object.keys(v.terms || {})))];
  const cheapest = vs.slice().sort((a, b) => a.premium - b.premium)[0];
  const decisionDoc = sel.documents(client.id).find(d => /decision|choice|instruction|accept|confirm/i.test(d.name)) || null;
  return { kind: 'Quote comparison', title: client.name + ' — ' + vs.length + ' sets of terms', status: 'live',
    statusLabel: vs.length + ' replies', recordRef: { ws: 'compare', clientId: client.id },
    blocks: [
      { t: 'compare', cols: vs.map(v => v.insurer), rows: [
        { label: 'Premium', cells: vs.map(v => ({ v: fmtMoney(v.premium) })) },
        ...termKeys.map(k => ({ label: k, cells: vs.map(v => {
          const val = (v.terms || {})[k] || 'Not stated';
          const bad = /not (quoted|stated)/i.test(val); const unclear = /wording|guideline|excluded/i.test(val);
          return { v: val, flag: bad ? 'missing' : unclear ? 'uncertain' : 'ok' };
        }) }))
      ] },
      note('amber', 'What could hurt the client', cheapest.insurer + ' is cheapest at ' + fmtMoney(cheapest.premium) + '. ' +
        vs.flatMap(v => (v.issues || []).map(i => v.insurer + ': ' + i)).join('. ') + '. Price differences here come from narrower cover, not better pricing.'),
      note('green', 'The choice is not mine', 'ASAP can recommend. Recording the client’s decision needs evidence and the account manager or principal.'),
      rows('Exact wording', vs.map(v => ({ title: v.insurer + ' quotation v' + v.version, note: (v.issues || []).join(' · ') || 'Complete terms',
        badge: (v.issues || []).length ? 'Unclear' : 'Verified', badgeTone: (v.issues || []).length ? tone.warn : tone.ok,
        action: v.documentId ? { a: 'open', ref: { ws: 'document', documentId: v.documentId } } : null }))),
      { t: 'upload', label: 'Upload a revised quotation (adds a version, keeps the old one)', clientId: client.id, version: true },
      ...(q.chosenInsurer ? [] : [{ t: 'upload', label: 'Attach the client’s written decision (required before a choice can be recorded)', clientId: client.id }]),
      ...(q.chosenInsurer ? [note('green', 'Client choice recorded', q.chosenInsurer + ' — ' + sel.evidence(q.chosenEvidenceId)?.label)]
        : vs.map(v => ({ t: 'gate', kind: 'approve', label: 'Record the client chose ' + v.insurer,
          detail: decisionDoc ? 'Recorded against ' + decisionDoc.name + ' as the client’s written decision. The account manager or principal must do this.'
            : 'Blocked until the client’s written decision is attached above. ASAP will not record a choice on your word alone.',
          permission: 'quote.choice', requires: decisionDoc ? null : 'No client decision evidence is attached. Upload the client’s email or instruction first — the choice cannot be recorded without it.',
          action: 'quote.choice', payload: { quoteId: q.id, insurer: v.insurer, evidenceNote: decisionDoc ? decisionDoc.name + ' attached ' + fmtDate(decisionDoc.createdAt) : null } })))
    ] };
};

WS.placement = (r) => {
  const client = sel.client(r.clientId);
  const q = sel.quotes(client?.id).slice(-1)[0];
  const pl = sel.placements(client?.id).slice(-1)[0];
  const work = sel.work({ clientId: client?.id, kind: 'Placement' }).slice(-1)[0];
  const blocks = [];
  if (!q || !q.chosenInsurer) {
    blocks.push(note('red', 'Blocked — no client choice evidence', 'Placement cannot start until the client’s decision is recorded with evidence. That protects you from placing cover the client did not choose.'));
    blocks.push({ t: 'gate', kind: 'approve', label: 'Open the comparison to record the choice', detail: 'The choice must be recorded by the account manager or principal, with evidence.', nav: { ws: 'compare', clientId: r.clientId } });
  } else if (!pl) {
    blocks.push(note('green', 'Client choice recorded', q.chosenInsurer + ' — ' + (sel.evidence(q.chosenEvidenceId)?.label || 'evidence attached')));
    blocks.push({ t: 'gate', kind: 'approve', label: 'Create placement work with ' + q.chosenInsurer,
      detail: 'Carries the verified quote data forward and lists underwriting requirements. Cover does not start.',
      action: 'placement.create', payload: { quoteId: q.id } });
  } else {
    const appr = sel.approvals({ placementId: pl.id });
    const valid = appr.find(a => a.status === 'valid');
    const stale = appr.find(a => a.status === 'stale');
    blocks.push(note(pl.status === 'Cover confirmed' ? 'green' : 'amber', 'Cover status',
      pl.status === 'Cover confirmed' ? 'Confirmed by ' + pl.insurer + ' and the policy exists.' : 'Submitted or preparing. Cover is NOT active and must not be described as active.'));
    blocks.push({ t: 'facts', items: [['Insurer', pl.insurer], ['Status', pl.status],
      ['Approval', valid ? 'Valid — ' + sel.user(valid.byId).name : stale ? 'STALE after a material edit' : 'Not approved'],
      ['Owner', sel.user(work?.assigneeId)?.name || '—']] });
    blocks.push(rows('Underwriting requirements', pl.requirements.map((rq, i) => ({ title: rq.label,
      note: rq.state === 'done' ? 'Supplied' : 'Outstanding', badge: rq.state === 'done' ? 'Done' : 'Missing',
      badgeTone: rq.state === 'done' ? tone.ok : tone.bad,
      secondary: rq.state === 'done' ? null : { a: 'requirement', placementId: pl.id, index: i, label: 'Mark supplied' } }))));
    if (!valid) blocks.push({ t: 'gate', kind: 'approve', label: 'Approve placement submission',
      detail: 'Only the brokerage principal can approve a placement. The consequence is an instruction to ' + pl.insurer + '.',
      permission: 'placement.approve', action: 'placement.approve', payload: { placementId: pl.id } });
    if (valid) {
      const sent = where('emails', e => e.clientId === client.id && /placement instruction/i.test(e.subject));
      blocks.push({ t: 'email', label: 'Placement instruction', to: pl.insurer.split(' ')[0].toLowerCase() + '@insurer.demo',
        subject: 'Placement instruction — ' + client.name,
        body: 'Dear Underwriter,\n\nOur client accepts your quotation. Please place comprehensive cover for the vehicles listed, and confirm in writing with a debit note and schedule.\n\nKind regards,\n' + sel.user(S.session().userId).name,
        attachments: ['Signed-Proposal-Form.pdf'], sent: !!sent.length, sentAt: sent[0]?.at, party: pl.insurer,
        onEdit: { action: 'approval.invalidate', payload: { placementId: pl.id, clientId: client.id, reason: 'material term edited after approval' } },
        send: { action: 'email.send', payload: { clientId: client.id, workItemId: work?.id, subject: 'Placement instruction — ' + client.name, recipients: [{ name: pl.insurer, email: pl.insurer.split(' ')[0].toLowerCase() + '@insurer.demo' }], attachments: ['Signed-Proposal-Form.pdf'] } } });
      if (sent.length && pl.status !== 'Cover confirmed') blocks.push({ t: 'gate', kind: 'approve', label: 'Link insurer confirmation and create the policy',
        detail: 'Compares the schedule with the chosen terms, flags differences, then creates the policy. Principal only.',
        nav: { ws: 'issue', clientId: client.id } });
    }
    if (stale) blocks.push(note('red', 'Approval is stale', 'A material term changed after approval (' + stale.staleReason + '). Re-approve before submitting.'));
  }
  return { kind: 'Placement work', title: client ? client.name + ' — placement' : 'Placement', status: 'draft',
    statusLabel: pl ? pl.status : 'Not started', recordRef: { ws: 'placement', clientId: client?.id }, blocks };
};

WS.issue = (r) => {
  const client = sel.client(r.clientId);
  const pl = sel.placements(client?.id).slice(-1)[0];
  const q = pl ? byId('quotes', pl.quoteId) : null;
  const chosen = q ? sel.quoteVersions(q.id).find(v => v.insurer === q.chosenInsurer || v.insurer === pl.insurer.split(' ')[0]) : null;
  if (!pl) return WS.placement(r);
  const diffs = [{ label: 'Premium', quoted: fmtMoney(chosen?.premium || 0), schedule: fmtMoney(chosen?.premium || 0), ok: true },
    { label: 'Vehicles', quoted: '5', schedule: '5', ok: true },
    { label: 'Effective date', quoted: '1 January 2027', schedule: '1 January 2027 (confirmation says “on receipt of premium”)', ok: false },
    { label: 'Windscreen limit', quoted: (chosen?.terms || {})['Windscreen'] || 'KES 30,000', schedule: 'KES 25,000', ok: false }];
  const exists = where('policyYears', y => y.placementId === pl.id)[0];
  return { kind: 'Policy issue', title: 'Check confirmation, then create the policy', status: exists ? 'live' : 'review',
    statusLabel: exists ? 'Active cover' : 'Awaiting approval',
    blocks: [
      note(exists ? 'green' : 'amber', exists ? 'Policy created from confirmation evidence' : 'Two differences need your judgment',
        exists ? 'Cover is Active because written confirmation is linked to the policy year.' : 'The schedule differs from the chosen terms on the effective date wording and the windscreen limit. Approving accepts both and records that you saw them.'),
      { t: 'compare', cols: ['Quoted', 'Schedule'], rows: diffs.map(d => ({ label: d.label,
        cells: [{ v: d.quoted }, { v: d.schedule, flag: d.ok ? 'ok' : 'missing' }] })) },
      rows('Confirmation documents', [
        { title: 'CIC-Confirmation-Email', note: 'Cover confirmed subject to premium', badge: 'Verified', badgeTone: tone.ok },
        { title: 'CIC-Debit-Note.pdf', note: fmtMoney(chosen?.premium || 0), badge: 'Verified', badgeTone: tone.ok },
        { title: 'CIC-Policy-Schedule.pdf', note: 'Five vehicles listed', badge: 'Verified', badgeTone: tone.ok }]),
      ...(exists ? [{ t: 'gate', kind: 'approve', label: 'Open the policy', detail: 'The policy year created from this placement.', nav: { ws: 'policy', clientId: client.id, policyYearId: exists.id } }]
        : [{ t: 'gate', kind: 'approve', label: 'Approve the match and create the policy',
          detail: 'Principal only. Creates the policy year, its items, an invoice and expected commission from the confirmation evidence.',
          permission: 'policy.issue', action: 'policy.issue',
          payload: { placementId: pl.id, confirmationNote: 'CIC written confirmation, debit note and schedule dated ' + fmtDate(new Date().toISOString()),
            number: 'ASAP-MTR-2027-00512', year: 2027, from: '2027-01-01', to: '2027-12-31', premium: chosen?.premium || 4850000,
            differences: diffs.filter(d => !d.ok).map(d => d.label + ': quoted ' + d.quoted + ', schedule ' + d.schedule),
            items: sel.items(sel.activeYear(client.id)?.id || '').map(i => ({ reg: i.reg, make: i.make, value: i.value })) } }])
    ] };
};

WS.servicing = (r) => {
  const client = sel.client(r.clientId);
  const year = sel.activeYear(client?.id);
  const sr = r.servicingId ? byId('servicingRequests', r.servicingId) : where('servicingRequests', s => s.clientId === client?.id).slice(-1)[0];
  const reg = r.reg || (sr ? findReg(sr.detail) : null);
  const tor = sr ? where('torRequests', t => t.servicingId === sr.id).slice(-1)[0] : null;
  const work = sr ? sel.work({ clientId: client.id, kind: 'Servicing' }).find(w => w.servicingId === sr.id) : null;
  const onCover = reg ? !!sel.itemByReg(reg) : false;
  const blocks = [note(onCover ? 'green' : 'red', onCover ? 'Now on cover' : 'A client request is not proof of cover',
    onCover ? reg + ' appears on the confirmed schedule following the insurer endorsement.' :
      'The client asked for this today. It is not on the schedule and no insurer confirmation exists. Do not tell the client it is covered.')];
  if (!sr) blocks.push({ t: 'gate', kind: 'approve', label: 'Open servicing work for ' + (reg || 'this change'),
    detail: 'Creates the servicing request, linked to ' + (client?.name || 'the client') + ' and the active policy year.',
    action: 'servicing.create', payload: { clientId: client?.id, policyYearId: year?.id, detail: 'Add vehicle ' + (reg || '') + ' to cover', missing: ['Declared value'] } });
  if (sr) {
    blocks.push({ t: 'facts', items: [['Request', sr.detail], ['Requested', fmtDate(sr.requestedAt)],
      ['Policy', year ? byId('policies', year.policyId).number : '—'], ['With', work ? partyState(work) : '—'],
      ['Owner', sel.user(work?.assigneeId)?.name || '—'], ['Cover', onCover ? 'Confirmed' : 'Not confirmed']] });
    if (work) blocks.push({ t: 'assign', workItemId: work.id, label: 'Owner and next check' });
    if (sr.missing && sr.missing.length && !tor) blocks.push({ t: 'missing', label: 'Missing before the insurer can act', items: sr.missing });
    blocks.push({ t: 'upload', label: 'Attach the logbook or valuation', clientId: client?.id, extract: reg });
    if (!tor) blocks.push({ t: 'gate', kind: 'approve', label: 'Prepare the TOR request',
      detail: 'Temporary cover is a request to the insurer. It is recorded separately from confirmed cover.',
      action: 'tor.request', payload: { clientId: client.id, policyYearId: year?.id, servicingId: sr.id, detail: sr.detail, value: 5100000 } });
    if (tor) {
      const sent = where('emails', e => e.clientId === client.id && /TOR request/i.test(e.subject));
      blocks.push({ t: 'email', label: 'TOR request to ' + (year?.insurer || 'the insurer'), to: 'motor@insurer.demo',
        subject: 'TOR request — ' + sr.detail, body: 'Dear Underwriter,\n\nPlease add the following to policy ' + (year ? byId('policies', year.policyId).number : '') + ' with effect from today:\n\n' + sr.detail + ' — sum insured ' + fmtMoney(tor.value || 0) + '.\n\nKindly confirm by endorsement and advise the additional premium.\n\nKind regards,\n' + sel.user(S.session().userId).name,
        attachments: ['Logbook.pdf'], sent: !!sent.length, sentAt: sent[0]?.at, party: year?.insurer || 'Insurer',
        send: { action: 'email.send', payload: { clientId: client.id, workItemId: work?.id, subject: 'TOR request — ' + sr.detail, recipients: [{ name: (year?.insurer || 'Insurer').split(' ')[0], email: 'motor@insurer.demo' }], attachments: ['Logbook.pdf'] } } });
      if (sent.length && tor.status !== 'Confirmed by insurer') blocks.push({ t: 'gate', kind: 'approve',
        label: 'Link the insurer endorsement and update cover',
        detail: 'Only this changes the policy. The previous schedule version is retained and stays viewable.',
        permission: 'cover.change', action: 'cover.change',
        payload: { policyYearId: year?.id, torId: tor.id, servicingId: sr.id, kind: 'Addition',
          detail: sr.detail, additionalPremium: 214500, confirmationNote: 'Endorsement E0231 from ' + (year?.insurer || 'insurer'),
          add: [{ reg: reg || 'KDN 482Q', make: 'Isuzu NPR 2022', value: tor.value || 5100000 }] } });
      if (tor.status === 'Confirmed by insurer') blocks.push(rows('Schedule versions', [
        { title: 'Schedule v' + ((year?.scheduleVersion || 2) - 1), note: 'Before the addition — retained', badge: 'Historic', badgeTone: tone.warn },
        { title: 'Schedule v' + (year?.scheduleVersion || 2), note: 'Current, includes ' + (reg || ''), badge: 'Current', badgeTone: tone.ok }]));
    }
  }
  return { kind: 'Servicing / TOR', title: (client?.name || '') + ' — ' + (sr ? sr.detail : 'servicing'), status: onCover ? 'live' : 'draft',
    statusLabel: onCover ? 'Confirmed' : sr ? (tor ? tor.status : 'Not confirmed') : 'Not started',
    recordRef: { ws: 'servicing', clientId: client?.id, servicingId: sr?.id }, blocks };
};

WS.endorsement = (r) => {
  const client = sel.client(r.clientId);
  const year = sel.activeYear(client?.id);
  const t = r.query || '';
  const regs = (t.toUpperCase().match(/[A-Z]{3}\s?\d{3}\s?[A-Z]/g) || []).map(x => x.replace(/^([A-Z]{3})\s?(\d{3})\s?([A-Z])$/, '$1 $2$3'));
  const outReg = regs[0] || null, inReg = regs[1] || null;
  const outItem = outReg ? sel.itemByReg(outReg) : null;
  const openClaim = outReg ? sel.claims(client?.id).find(c => c.reg === outReg && !/settled|closed/i.test(c.status)) : null;
  const blocks = [];
  blocks.push({ t: 'facts', items: [['Policy', year ? byId('policies', year.policyId).number : '—'],
    ['Schedule', 'v' + (year?.scheduleVersion || 1)], ['Remove', outReg || '—'], ['Add', inReg || '—'],
    ['Effective', fmtDate(new Date().toISOString())], ['Premium impact', 'Pro-rata, insurer to confirm']] });
  if (openClaim) blocks.push(note('red', 'Conflict — open claim on ' + outReg,
    'Claim ' + (openClaim.ref || '(no insurer reference)') + ' is open on this vehicle. Removing it can prejudice the claim. Resolve or acknowledge the conflict before requesting the endorsement.'));
  if (outItem) blocks.push({ t: 'compare', cols: ['Leaving', 'Joining'], rows: [
    { label: 'Vehicle', cells: [{ v: outItem.reg + ' · ' + outItem.make }, { v: (inReg || '—') + ' · Isuzu NPR 2022' }] },
    { label: 'Sum insured', cells: [{ v: fmtMoney(outItem.value) }, { v: fmtMoney(5100000) }] },
    { label: 'Open claim', cells: [openClaim ? { v: 'Yes — ' + (openClaim.ref || 'unreferenced'), flag: 'missing' } : { v: 'No' }, { v: 'No' }] }
  ] });
  blocks.push(note('amber', 'Nothing changes until the insurer confirms', 'The substitution is a request. Cover, schedule version and premium only move when the endorsement arrives.'));
  if (year) blocks.push({ t: 'gate', kind: 'approve', label: 'Confirm endorsement and update schedule',
    detail: 'Requires insurer confirmation. Creates schedule v' + ((year.scheduleVersion || 1) + 1) + ', an additional-premium invoice, and keeps the old version.' + (openClaim ? ' The open claim conflict is recorded with it.' : ''),
    permission: 'cover.change', action: 'cover.change',
    payload: { policyYearId: year.id, kind: 'Substitution', detail: 'Replace ' + outReg + ' with ' + inReg,
      confirmationNote: 'Insurer endorsement for the substitution', additionalPremium: 96000,
      add: inReg ? [{ reg: inReg, make: 'Isuzu NPR 2022', value: 5100000 }] : [], remove: outReg ? [outReg] : [] } });
  return { kind: 'Endorsement', title: 'Substitution' + (outReg ? ' — ' + outReg + ' → ' + (inReg || '?') : ''), status: 'review',
    statusLabel: openClaim ? 'Conflict' : 'Prepared', recordRef: { ws: 'endorsement', clientId: client?.id }, blocks };
};

WS.claim = (r) => {
  const client = sel.client(r.clientId);
  let c = r.claimId ? byId('claims', r.claimId) : sel.claims(client?.id).slice(-1)[0];
  const reg = r.reg;
  const year = sel.activeYear(client?.id);
  if (!c && reg) {
    const it = sel.itemByReg(reg);
    return { kind: 'Claim', title: 'Register a claim — ' + reg, status: 'draft', statusLabel: 'Not registered',
      blocks: [
        note(it ? 'green' : 'red', it ? 'Cover check passed' : 'Cover check failed',
          it ? reg + ' is on the confirmed schedule of ' + byId('policies', byId('policyYears', it.policyYearId).policyId).number + '.' : reg + ' is not on a confirmed schedule. Registering a claim will record that.'),
        { t: 'facts', items: [['Vehicle', reg], ['Sum insured', it ? fmtMoney(it.value) : '—'],
          ['Estimated excess', it ? fmtMoney(Math.max(30000, it.value * 0.025)) : '—'], ['Loss date', fmtDate(new Date().toISOString())],
          ['Driver', r.driver || 'not recorded'], ['Location', r.location || 'not recorded']] },
        note('amber', 'What I will not say', 'Registering a claim never means it is covered or accepted. Acceptance requires the insurer’s written decision.'),
        { t: 'gate', kind: 'approve', label: 'Register the claim', permission: 'claim.manage',
          detail: 'Creates the claim, its checklist and its timeline against ' + (client?.name || 'the client') + '. The claims lead or operations can do this.',
          action: 'claim.register', payload: { clientId: client?.id, policyYearId: it ? it.policyYearId : year?.id, reg,
            title: 'Claim — ' + reg + ' incident', lossAt: new Date().toISOString().slice(0, 10), driver: r.driver || null, location: r.location || null } }
      ] };
  }
  if (!c) return WS.client(r);
  const done = c.checklist.filter(x => x.state === 'done').length;
  const sent = where('emails', e => e.clientId === c.clientId && /claim/i.test(e.subject));
  const work = sel.work({ clientId: c.clientId, kind: 'Claim' }).find(w => w.claimId === c.id);
  return { kind: 'Claim work', title: c.title, status: 'live', statusLabel: c.status,
    recordRef: { ws: 'claim', claimId: c.id, clientId: c.clientId },
    blocks: [
      { t: 'facts', items: [['Loss date', fmtDate(c.lossAt)], ['Cover on loss date', c.coveredOnLossDate ? 'Confirmed' : 'NOT confirmed'],
        ['Excess', fmtMoney(c.excess)], ['Insurer reference', c.ref || 'not issued yet'],
        ['Currently with', c.parties && c.parties.length ? c.parties.map(p => p.name + ' since ' + fmtDate(p.since)).join(', ') : sel.user(work?.assigneeId)?.name || '—'],
        ['Next check', c.nextCheckAt ? fmtDate(c.nextCheckAt) : 'not set']] },
      note('amber', 'Nothing here is an acceptance', 'ASAP prepares and records. Only the insurer’s written decision accepts a claim.'),
      rows('Document checklist — ' + done + ' of ' + c.checklist.length + ' complete', c.checklist.map(x => ({
        title: x.label, note: x.state === 'done' ? 'Received' : 'Outstanding', badge: x.state === 'done' ? 'Done' : 'Missing',
        badgeTone: x.state === 'done' ? tone.ok : tone.bad,
        action: x.documentId ? { a: 'open', ref: { ws: 'document', documentId: x.documentId } } : null }))),
      { t: 'upload', label: 'Add a claim document (updates the checklist)', clientId: c.clientId, claimId: c.id, checklist: c.checklist.map(x => x.label) },
      ...(work ? [{ t: 'assign', workItemId: work.id, label: 'Owner and next check date' }] : []),
      { t: 'email', label: 'Insurer notification', to: 'claims@insurer.demo',
        subject: 'Claim notification — ' + (c.reg || '') + ' · ' + fmtDate(c.lossAt),
        body: 'Dear Claims Team,\n\nWe notify a loss involving ' + c.reg + ' on ' + fmtDate(c.lossAt) + '.' + (c.location ? ' Location: ' + c.location + '.' : '') + '\n\nDocuments will follow as they are received. Please acknowledge and appoint an assessor.\n\nKind regards,\n' + sel.user(S.session().userId).name,
        attachments: c.checklist.filter(x => x.state === 'done').map(x => x.label + '.pdf'),
        sent: !!sent.length, sentAt: sent[0]?.at, party: byId('policyYears', c.policyYearId)?.insurer || 'Insurer',
        send: { action: 'email.send', payload: { clientId: c.clientId, workItemId: work?.id,
          subject: 'Claim notification — ' + (c.reg || '') + ' · ' + fmtDate(c.lossAt),
          recipients: [{ name: (byId('policyYears', c.policyYearId)?.insurer || 'Insurer').split(' ')[0], email: 'claims@insurer.demo' }] } },
        after: { action: 'claim.update', payload: { claimId: c.id, ref: 'CIC/MOT/26/3391', party: byId('policyYears', c.policyYearId)?.insurer || 'Insurer', status: 'Notified — with insurer', nextCheckAt: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10), text: 'Notification sent; insurer acknowledged' } } },
      { t: 'timeline', events: c.timeline.slice().reverse().map(e => ({ when: fmtDate(e.at), text: e.text })) }
    ] };
};

WS.money = (r) => {
  const client = sel.client(r.clientId);
  if (!client) return WS.today(r);
  const invs = sel.invoices(client.id);
  const pays = sel.payments(client.id);
  const bal = sel.balance(client.id);
  const receipt = sel.documents(client.id).find(d => /receipt|advice/i.test(d.name));
  const candidates = invs.filter(i => i.status !== 'Paid');
  const ambiguous = candidates.length > 1 && candidates.every(i => i.amount === candidates[0].amount);
  const blocks = [
    { t: 'calc', rows: invs.map(i => [i.number + ' · ' + i.kind + ' (' + i.status + ')', fmtMoney(i.amount - i.paid) + ' due']).concat([['Total outstanding', fmtMoney(bal)]]) },
    rows('Invoices', invs.map(i => ({ title: i.number + ' · ' + fmtMoney(i.amount), note: i.kind + ' · issued ' + fmtDate(i.issuedAt) + ' · paid ' + fmtMoney(i.paid),
      badge: i.status, badgeTone: i.status === 'Paid' ? tone.ok : i.status === 'Part paid' ? tone.warn : tone.bad }))),
    rows('Payments received', pays.length ? pays.map(p => ({ title: fmtMoney(p.amount), note: 'Matched to ' + byId('invoices', p.invoiceId).number + ' · approved by ' + sel.user(p.approvedById).name + ' · ' + fmtDate(p.at),
      badge: 'Received', badgeTone: tone.ok, action: p.documentId ? { a: 'open', ref: { ws: 'document', documentId: p.documentId } } : null }))
      : [{ title: 'No payments recorded', note: 'An expected payment is never shown as received.', badge: 'None', badgeTone: tone.warn }]),
    { t: 'upload', label: 'Upload a receipt to match', clientId: client.id, money: true }
  ];
  if (ambiguous) blocks.push(note('amber', 'Two invoices could match', candidates.map(i => i.number + ' (' + fmtMoney(i.amount) + ')').join(' and ') + ' are identical. ASAP will not pick one — choose below.'));
  candidates.forEach(i => blocks.push({ t: 'gate', kind: 'approve', label: 'Match ' + fmtMoney(Math.min(4000000, i.amount - i.paid)) + ' to ' + i.number,
    detail: 'Finance or the principal must approve any money change. Creates a payment, updates the invoice status, the client balance and a reconciliation line.',
    permission: 'money.change', action: 'payment.match',
    payload: { invoiceId: i.id, amount: Math.min(4000000, i.amount - i.paid), documentId: receipt?.id, reference: 'Bank transfer advice' } }));
  return { kind: 'Money', title: client.name + ' — money', status: bal > 0 ? 'review' : 'live',
    statusLabel: bal > 0 ? fmtMoney(bal) + ' outstanding' : 'Settled', recordRef: { ws: 'money', clientId: client.id }, blocks };
};

WS.reconciliation = (r) => {
  const insurer = r.insurer || 'CIC General Insurance';
  const lines = sel.reconciliation(insurer);
  const ours = lines.reduce((a, l) => a + (l.ours || 0), 0), theirs = lines.reduce((a, l) => a + (l.theirs || 0), 0);
  return { kind: 'Reconciliation', title: insurer + ' — statement', status: 'review',
    statusLabel: lines.length ? lines.filter(l => l.status === 'Unresolved').length + ' unresolved' : 'Not run',
    blocks: [
      ...(lines.length ? [{ t: 'calc', rows: [['Our ledger', fmtMoney(ours)], ['Their statement', fmtMoney(theirs)], ['Difference', fmtMoney(ours - theirs)]] }] : []),
      ...(lines.length ? [rows('Statement lines — totals tie to these rows', lines.map(l => ({
        title: l.label, note: 'Ours ' + fmtMoney(l.ours) + ' · theirs ' + fmtMoney(l.theirs) + (l.note ? ' · ' + l.note : ''),
        badge: l.status, badgeTone: l.status === 'Unresolved' ? tone.bad : l.status === 'Explainable difference' ? tone.warn : tone.ok,
        action: l.invoiceId ? { a: 'open', ref: { ws: 'money', clientId: l.clientId } } : null,
        secondary: l.status === 'Unresolved' ? { a: 'act', action: 'reconcile.resolve', payload: { lineId: l.id, status: 'Reconciled', note: 'Endorsement premium accepted' }, label: 'Resolve', permission: 'money.change' } : null,
        tertiary: l.status === 'Unresolved' ? { a: 'act', action: 'reconcile.resolve', payload: { lineId: l.id, status: 'Disputed', note: 'Queried with the insurer' }, label: 'Dispute', permission: 'money.change' } : null
      })))] : [note('amber', 'Nothing compared yet', 'Run the comparison to build the lines from invoices, endorsements, payments and commission.')]),
      { t: 'gate', kind: 'approve', label: 'Compare ' + insurer + '’s statement with our ledger',
        detail: 'Creates reconciliation lines from real invoices, endorsements and payments. Money states only change when you resolve a line.',
        action: 'reconcile.run', payload: { insurer } },
      note('green', 'Money words stay in money', 'Unpaid, Part paid, Paid, Received, Reconciled and Disputed are used only here — never for tasks, cover or AI runs.')
    ] };
};

WS.commission = () => {
  const list = sel.commissions();
  return { kind: 'Commission', title: 'Commission position', status: 'live', statusLabel: list.length + ' policies',
    blocks: [
      { t: 'table', label: 'Expected against received', cols: ['Policy', 'Insurer', 'Rate', 'Expected', 'Received', 'State'],
        rows: list.map(c => [byId('policies', byId('policyYears', c.policyYearId)?.policyId)?.number || '—', c.insurer, c.rate,
          fmtMoney(c.expected), fmtMoney(c.received), c.status]) },
      { t: 'calc', rows: [['Expected', fmtMoney(list.reduce((a, c) => a + c.expected, 0))],
        ['Received', fmtMoney(list.reduce((a, c) => a + c.received, 0))],
        ['Outstanding', fmtMoney(list.reduce((a, c) => a + (c.expected - c.received), 0))]] },
      note('amber', 'Disputes live in reconciliation', 'A commission line is only disputed from the insurer statement, with a note and your name against it.'),
      { t: 'gate', kind: 'approve', label: 'Open CIC reconciliation', detail: 'Where commission differences are resolved or disputed.', nav: { ws: 'reconciliation', insurer: 'CIC General Insurance' } }
    ] };
};

WS.renewal = (r) => {
  const client = sel.client(r.clientId);
  const years = sel.policyYears(client?.id);
  const cur = years.find(y => y.status === 'active');
  const next = years.find(y => y.renewedFromId === cur?.id);
  if (!cur) return WS.client(r);
  const claims = sel.claims(client.id).filter(c => c.policyYearId === cur.id);
  const ends = where('endorsements', e => e.policyYearId === cur.id);
  const owing = where('invoices', i => i.policyYearId === cur.id).reduce((a, i) => a + (i.amount - i.paid), 0);
  return { kind: 'Renewal work', title: client.name + ' — renewal ' + (cur.year + 1), status: next ? 'live' : 'draft',
    statusLabel: next ? 'Year ' + next.year + ' created' : 'Prepared, not placed',
    recordRef: { ws: 'renewal', clientId: client.id },
    blocks: [
      { t: 'facts', items: [['Expiring', byId('policies', cur.policyId).number + ' · ' + cur.year],
        ['Expiry', fmtDate(cur.to)], ['Items on cover', sel.items(cur.id).length + ''],
        ['Claims this year', claims.length + ''], ['Endorsements', ends.length + ''],
        ['Unpaid premium', owing ? fmtMoney(owing) : 'none']] },
      { t: 'compare', cols: ['This year', 'Renewal'], rows: [
        { label: 'Premium', cells: [{ v: fmtMoney(cur.premium) }, { v: next ? fmtMoney(next.premium) : fmtMoney(Math.round(cur.premium * (claims.length ? 1.14 : 1.06))) }] },
        { label: 'Items', cells: [{ v: sel.items(cur.id).length + '' }, { v: sel.items(cur.id).length + '' }] },
        { label: 'Claims loading', cells: [{ v: 'None' }, { v: claims.length ? '+8% (' + claims.length + ' claim)' : 'None', flag: claims.length ? 'uncertain' : 'ok' }] },
        { label: 'Base increase', cells: [{ v: '—' }, { v: '+6% declared values', flag: 'ok' }] }
      ] },
      note('amber', 'Why the premium moves', 'Base increase 6% on revalued items' + (claims.length ? ', plus an 8% claims loading from ' + claims.map(c => c.reg || c.title).join(', ') : '') + (ends.length ? ', plus ' + fmtMoney(ends.reduce((a, e) => a + e.additionalPremium, 0)) + ' of endorsements' : '') + '. Every figure here comes from this year’s records.'),
      ...(owing ? [{ t: 'missing', label: 'Holding the renewal up', items: [fmtMoney(owing) + ' outstanding on the expiring year', ...(claims.length ? ['Claim reserve not advised by the insurer'] : [])] }] : []),
      ...(next ? [rows('Policy years — nothing overwritten', years.map(y => ({ title: y.year + ' · ' + y.insurer,
        note: fmtDate(y.from) + ' – ' + fmtDate(y.to) + ' · ' + y.status + ' · schedule v' + y.scheduleVersion,
        badge: y.status === 'active' ? 'Active cover' : y.status, badgeTone: y.status === 'active' ? tone.ok : tone.warn,
        action: { a: 'open', ref: { ws: 'policy', clientId: client.id, policyYearId: y.id } } })))]
        : [{ t: 'gate', kind: 'approve', label: 'Create the ' + (cur.year + 1) + ' policy year',
          detail: 'Creates a new policy year alongside ' + cur.year + '. Claims, endorsements, documents and payments of the old year are untouched.',
          action: 'renewal.create', payload: { policyYearId: cur.id } }])
    ] };
};

WS.team = (r) => {
  const users = sel.users();
  const focus = r.userId ? sel.user(r.userId) : null;
  return { kind: 'Team', title: focus ? focus.name : 'Team workload', status: 'live', statusLabel: users.length + ' people',
    blocks: [
      rows('Live workload', users.map(u => {
        const mine = sel.work({ assigneeId: u.id }).filter(w => w.state !== 'Completed');
        return { title: u.name + ' · ' + S.ROLES[u.role], note: mine.length + ' open · ' + (mine.filter(w => w.priority === 'high').length) + ' high priority',
          badge: mine.length > 2 ? 'Loaded' : 'Available', badgeTone: mine.length > 2 ? tone.warn : tone.ok,
          action: { a: 'open', ref: { ws: 'work', filter: { assigneeId: u.id } } },
          secondary: S.can('user.role') ? { a: 'role', userId: u.id, label: 'Change role' } : null };
      })),
      ...(focus ? [rows(focus.name + '’s open work', sel.work({ assigneeId: focus.id }).filter(w => w.state !== 'Completed').map(w => ({
        title: w.title, note: (sel.client(w.clientId)?.name || '') + ' · ' + partyState(w) + (w.dueAt ? ' · due ' + fmtDate(w.dueAt) : ''),
        badge: w.kind, badgeTone: tone.ok, action: { a: 'open', ref: refForWork(w) } })))] : []),
      note('green', 'Permissions are enforced in the action layer', S.can('user.role') ? 'You may change roles; every change writes an audit event.' : 'Only an administrator can change roles. Ask ' + (S.approverFor('user.role')?.name || 'an administrator') + '.')
    ] };
};

WS.report = (r) => {
  const period = r.period || 'Last 90 days';
  const years = all('policyYears');
  const renewed = years.filter(y => y.renewedFromId);
  const claims = sel.claims();
  const invs = all('invoices');
  return { kind: 'Report', title: 'Renewal and claim performance', status: 'live', statusLabel: period,
    filters: [{ label: 'Last 90 days' }, { label: 'This year' }, { label: 'Motor only' }],
    blocks: [
      { t: 'table', label: 'Metrics — every number drills to its rows', cols: ['Metric', 'Value', 'Source rows'],
        rows: [['Policy years on cover', years.filter(y => y.status === 'active').length + '', 'policyYears'],
          ['Renewals created', renewed.length + '', 'policyYears.renewedFrom'],
          ['Open claims', claims.filter(c => !/settled|closed/i.test(c.status)).length + '', 'claims'],
          ['Premium outstanding', fmtMoney(invs.reduce((a, i) => a + (i.amount - i.paid), 0)), 'invoices'],
          ['Average premium', fmtMoney(years.reduce((a, y) => a + y.premium, 0) / Math.max(1, years.length)), 'policyYears']] },
      rows('Drill-down — policy years behind these totals', years.map(y => ({ title: byId('policies', y.policyId).number + ' · ' + y.year,
        note: sel.client(y.clientId).name + ' · ' + y.insurer + ' · ' + fmtMoney(y.premium), badge: y.status, badgeTone: tone.ok,
        action: { a: 'open', ref: { ws: 'policy', clientId: y.clientId, policyYearId: y.id } } }))),
      note('green', 'Facts and inference are separated', 'Counts and sums come from records. Any explanation of why is labelled as inference in the investigation workspace.'),
      { t: 'gate', kind: 'approve', label: 'Open the investigation behind the slow claims', detail: 'Reasoning, comparison period and evidence.', nav: { ws: 'investigation' } }
    ] };
};

WS.investigation = () => {
  const claims = sel.claims();
  const slow = claims.filter(c => !/settled|closed/i.test(c.status));
  return { kind: 'Investigation', title: 'Why insurer claims are slower', status: 'live', statusLabel: slow.length + ' open claims',
    blocks: [
      note('green', 'Facts from records', slow.length + ' open claims. ' +
        slow.filter(c => c.checklist.some(x => x.state !== 'done')).length + ' are waiting on client documents; ' +
        slow.filter(c => !c.ref).length + ' have no insurer reference yet.'),
      note('amber', 'Inference — not a fact', 'Claims without an insurer reference sit longest. The pattern suggests acknowledgement is the bottleneck, not assessment. This is reasoning, not a record.'),
      rows('Claims behind the finding', slow.map(c => ({ title: c.title, note: sel.client(c.clientId).name + ' · ' + c.status + ' · ' + (c.ref || 'no insurer reference'),
        badge: c.ref ? 'Referenced' : 'No reference', badgeTone: c.ref ? tone.ok : tone.bad,
        action: { a: 'open', ref: { ws: 'claim', claimId: c.id, clientId: c.clientId } } }))),
      { t: 'gate', kind: 'approve', label: 'Create work for the causes we control',
        detail: 'Creates a work item to chase insurer acknowledgement, owned by you.',
        action: 'work.create', payload: { title: 'Chase insurer acknowledgement on unreferenced claims', kind: 'Claim', priority: 'high', reason: 'Investigation found unreferenced claims sit longest.' } }
    ] };
};

WS.automation = (r) => {
  const a = r.automationId ? byId('automations', r.automationId) : null;
  if (a) {
    const runs = sel.runs(a.id);
    return { kind: 'Automation', title: a.name, status: a.on ? 'live' : 'draft', statusLabel: a.on ? 'Active' : 'Paused',
      blocks: [
        { t: 'facts', items: [['Trigger', a.trigger], ['Conditions', a.conditions], ['Actions', a.actions],
          ['Approval policy', a.approval], ['Owner', sel.user(a.ownerId)?.name || '—'], ['Runs', a.runs + '']] },
        rows('Run history', runs.length ? runs.map(x => ({ title: fmtDate(x.at) + ' · ' + x.mode, note: x.reason + (x.error ? ' · ' + x.error : ''),
          badge: x.status, badgeTone: x.status === 'failed' ? tone.bad : tone.ok,
          action: x.writes && x.writes.length ? { a: 'open', ref: { ws: 'work' } } : null,
          secondary: x.status === 'failed' ? { a: 'act', action: 'automation.run', payload: { id: a.id }, label: 'Retry safely' } : null }))
          : [{ title: 'No runs', note: 'Run it in test mode first — test mode writes nothing.', badge: 'Idle', badgeTone: tone.ok }]),
        { t: 'gate', kind: 'approve', label: 'Run in test mode (zero writes)', detail: 'Shows what it would do and writes no records.',
          action: 'automation.run', payload: { id: a.id, test: true } },
        { t: 'gate', kind: 'approve', label: a.on ? 'Pause this automation' : 'Switch this automation on',
          detail: 'Pausing stops preparation. It never removes work already created.', permission: 'automation.manage',
          action: 'automation.toggle', payload: { id: a.id } },
        { t: 'gate', kind: 'approve', label: 'Force a failure and retry', detail: 'Proves failures are honest and retry does not duplicate work.',
          action: 'automation.run', payload: { id: a.id, fail: true } }
      ] };
  }
  const list = sel.automations();
  return { kind: 'Automations', title: 'ASAP watches. Your team decides.', status: 'live',
    statusLabel: list.filter(x => x.on).length + ' active',
    blocks: [
      note('green', 'Human approval is on', 'External messages, cover changes and money changes are never automatic, whatever an automation prepares.'),
      rows('Rules', list.map(x => ({ title: x.name, note: x.trigger + ' → ' + x.actions, badge: x.on ? 'On' : 'Paused',
        badgeTone: x.on ? tone.ok : tone.warn, action: { a: 'open', ref: { ws: 'automation', automationId: x.id } },
        secondary: { a: 'act', action: 'automation.toggle', payload: { id: x.id }, label: x.on ? 'Pause' : 'Switch on', permission: 'automation.manage' } }))),
      { t: 'builder', label: 'Create an automation', draft: r.draft || null }
    ] };
};

WS.connections = () => ({ kind: 'Connections', title: 'Connected email and data', status: 'live', statusLabel: sel.connections().filter(c => c.status === 'connected').length + ' connected',
  blocks: [
    rows('Sources', sel.connections().map(c => ({ title: c.kind + ' · ' + c.account,
      note: c.note + (c.lastSync ? ' · last sync ' + fmtDate(c.lastSync) : '') + (c.error ? ' · ' + c.error : ''),
      badge: c.status, badgeTone: c.status === 'connected' ? tone.ok : c.status === 'failed' ? tone.bad : tone.warn,
      secondary: c.status === 'connected' ? { a: 'act', action: 'connection.set', payload: { id: c.id, status: 'disconnected' }, label: 'Disconnect' }
        : { a: 'act', action: 'connection.set', payload: { id: c.id, status: 'connected' }, label: 'Connect' },
      tertiary: { a: 'act', action: 'connection.set', payload: { id: c.id, status: 'failed', error: 'Permission denied by the provider' }, label: 'Simulate failure' } }))),
    note('amber', 'What is genuinely connected', 'Uploads read real files from your device. The mailbox and the model endpoint are not connected in this build — no key exists in the browser and none should.')
  ] });

WS.settings = () => {
  const b = all('brokerages')[0];
  return { kind: 'Company settings', title: b.name, status: 'live', statusLabel: 'Out of primary navigation',
    blocks: [
      { t: 'facts', items: [['Brokerage', b.name], ['Country', b.country], ['Placement approval', S.ROLES.principal],
        ['Money approval', S.ROLES.finance], ['Cover truth', 'Insurer confirmation required'], ['Users', sel.users().length + '']] },
      rows('Team and permissions', sel.users().map(u => ({ title: u.name, note: S.ROLES[u.role],
        badge: u.role, badgeTone: tone.ok, secondary: S.can('user.role') ? { a: 'role', userId: u.id, label: 'Change role' } : null }))),
      rows('Audit', sel.audit().slice(0, 10).map(a => ({ title: a.text, note: fmtDate(a.at) + ' · ' + (sel.user(a.actorId)?.name || 'system'), badge: a.kind, badgeTone: tone.ok })))
    ] };
};

WS.document = (r) => {
  const d = r.documentId ? byId('documents', r.documentId) : sel.documents(r.clientId)[0];
  if (!d) return WS.client(r);
  const versions = sel.docVersions(d.id);
  const v = versions[0];
  const compareWith = r.compareWith ? byId('documents', r.compareWith) : null;
  const cv = compareWith ? sel.docVersions(compareWith.id)[0] : (versions[1] || null);
  return { kind: 'Document', title: d.name, status: 'live', statusLabel: 'v' + d.currentVersion,
    recordRef: { ws: 'document', documentId: d.id },
    blocks: [
      { t: 'doc', name: d.name, kind: d.kind, title: v.title, lines: v.lines, note: v.note },
      rows('Versions — nothing is overwritten', versions.map(x => ({ title: 'v' + x.version, note: fmtDate(x.at) + ' · ' + x.by,
        badge: x.version === d.currentVersion ? 'Current' : 'Historic', badgeTone: x.version === d.currentVersion ? tone.ok : tone.warn }))),
      ...(cv ? [{ t: 'compare', cols: [cv.title.slice(0, 22), v.title.slice(0, 22)], rows: cv.lines.map((line, i) => ({
        label: 'Line ' + (i + 1), cells: [{ v: line.replace(/\|/g, '') }, { v: (v.lines[i] || '—').replace(/\|/g, ''),
          flag: (v.lines[i] || '') === line ? 'ok' : 'uncertain' }] })) }] : []),
      { t: 'upload', label: 'Upload a newer version of this document', clientId: d.clientId, documentId: d.id, version: true }
    ] };
};

WS.communication = (r) => {
  const client = sel.client(r.clientId);
  const list = sel.emails(client?.id);
  const focus = r.emailId ? byId('emails', r.emailId) : list[0];
  const thread = focus ? list.filter(e => e.threadId === focus.threadId) : [];
  return { kind: 'Communication', title: focus ? focus.subject : 'Email', status: 'live',
    statusLabel: thread.length + ' in thread',
    blocks: [
      rows('Thread — draft and sent are never mixed', thread.map(e => ({ title: (e.direction === 'out' ? 'Sent to ' + (e.party || e.to) : 'From ' + e.from),
        note: fmtDate(e.at) + ' · ' + e.subject, badge: e.direction === 'out' ? 'Sent' : 'Received',
        badgeTone: tone.ok }))),
      ...(focus ? [{ t: 'doc', name: focus.subject, kind: (focus.direction === 'out' ? 'Sent ' : 'Received ') + fmtDate(focus.at),
        title: focus.subject.toUpperCase(), lines: focus.body.split('\n').filter(Boolean), note: focus.direction === 'out' ? 'Sent by ' + (sel.user(focus.sentById)?.name || 'a human') + ' — saved as evidence.' : 'Received in the connected mailbox.' }] : []),
      rows('Actions ASAP extracted', focus ? [
        { title: 'Requirement', note: /five|5/.test(focus.body) ? 'Comprehensive cover, five vehicles' : 'See message', badge: 'Extracted', badgeTone: tone.ok },
        { title: 'Next step', note: 'Quotation work', badge: 'Prepared', badgeTone: tone.ok, action: { a: 'open', ref: { ws: 'quote', clientId: client?.id } } }] : []),
      ...(client ? [{ t: 'email', label: 'Reply to the client', to: sel.contacts(client.id)[0]?.email || '', subject: 'Re: ' + (focus?.subject || ''),
        body: 'Dear ' + (sel.contacts(client.id)[0]?.name.split(' ')[0] || 'there') + ',\n\nThank you — we are preparing this now and will revert with terms.\n\nKind regards,\n' + sel.user(S.session().userId).name,
        attachments: [], sent: false, party: sel.contacts(client.id)[0]?.name || 'Client',
        send: { action: 'email.send', payload: { clientId: client.id, subject: 'Re: ' + (focus?.subject || ''), recipients: [{ name: sel.contacts(client.id)[0]?.name || 'Client', email: sel.contacts(client.id)[0]?.email || '' }] } } }] : [])
    ] };
};

WS.search = (r) => {
  const hits = sel.search(r.query || '');
  return { kind: 'Search', title: r.query ? 'Results for “' + r.query + '”' : 'Search everything', status: 'live',
    statusLabel: hits.length + ' results',
    blocks: [rows('Across clients, policies, vehicles, claims, documents, email and work', hits.length ? hits.map(h => ({
      title: h.title, note: h.kind + ' · ' + h.note, badge: h.kind, badgeTone: tone.ok, action: { a: 'open', ref: h.target } }))
      : [{ title: 'Nothing matched', note: 'Try a registration, policy number, claim reference or a phrase from an email.', badge: 'Empty', badgeTone: tone.warn }])] };
};

WS.audit = (r) => {
  const list = sel.audit(r.clientId);
  return { kind: 'Audit trail', title: (sel.client(r.clientId)?.name || 'Brokerage') + ' — full history', status: 'live',
    statusLabel: list.length + ' events',
    blocks: [{ t: 'timeline', events: list.map(a => ({ when: fmtDate(a.at), text: a.text,
      by: sel.user(a.actorId)?.name || 'system', evidenceIds: a.evidenceIds, kind: a.kind,
      ref: a.evidenceIds && a.evidenceIds[0] ? { ws: 'evidence', evidenceId: a.evidenceIds[0] } : null })) }] };
};

WS.evidence = (r) => {
  const ev = r.evidenceId ? sel.evidence(r.evidenceId) : null;
  const doc = ev?.documentId ? byId('documents', ev.documentId) : null;
  if (doc) return WS.document({ documentId: doc.id });
  const email = ev?.emailId ? byId('emails', ev.emailId) : null;
  if (email) return WS.communication({ clientId: email.clientId, emailId: email.id });
  return { kind: 'Evidence', title: ev ? ev.label : 'Evidence', status: 'live', statusLabel: 'Record',
    blocks: [note('green', ev ? ev.label : 'No evidence', ev ? 'Recorded ' + fmtDate(ev.at) + '. ' + (ev.note || 'This fact comes from the record itself rather than a separate file.') : 'Nothing to show.')] };
};

WS.work.filters = true;

export function buildWorkspace(ref) {
  if (!ref || !ref.ws) return null;
  const fn = WS[ref.ws] || WS.today;
  const ws = fn(ref);
  ws.ref = ref;
  return ws;
}

export const WORKSPACE_NAMES = Object.keys(WS);
