/* eslint-disable -- the approved ASAP engine, kept as delivered so it can be diffed against the approved build; the edits made to it are marked where they are. */
// ASAP record store — normalized, persistent, auditable.
// This module owns ALL business truth. UI components never hold fixture data.
// Production boundary: swap `loadRaw`/`saveRaw` for the brokerage API (see asap-adapters.js).

const KEY = 'asap.db.v3';
export const SCHEMA = [
  'brokerages', 'users', 'clients', 'contacts', 'opportunities', 'quotes', 'quoteVersions',
  'placements', 'policies', 'policyYears', 'policyItems', 'servicingRequests', 'torRequests',
  'endorsements', 'claims', 'documents', 'documentVersions', 'emails', 'drafts', 'workItems',
  'approvals', 'invoices', 'payments', 'reconciliationLines', 'commissions', 'automations',
  'automationRuns', 'evidence', 'auditEvents', 'connections', 'conversations'
];

export const ROLES = {
  ops: 'Operations manager', account: 'Account manager', claims: 'Claims lead',
  finance: 'Finance officer', principal: 'Brokerage principal', admin: 'Administrator'
};

// Permission is enforced in the action layer, never only in the UI.
const PERMS = {
  'records.import': ['ops', 'account', 'principal', 'admin'],
  'email.send': ['ops', 'account', 'claims', 'finance', 'principal', 'admin'],
  'quote.choice': ['account', 'principal', 'admin'],
  'placement.approve': ['principal', 'admin'],
  'policy.issue': ['principal', 'admin'],
  'cover.change': ['ops', 'account', 'principal', 'admin'],
  'money.change': ['finance', 'principal', 'admin'],
  'claim.manage': ['claims', 'ops', 'principal', 'admin'],
  'work.assign': ['ops', 'account', 'claims', 'principal', 'admin'],
  'user.role': ['admin'],
  'automation.manage': ['principal', 'admin', 'ops']
};

let db = null;
const nowIso = () => new Date().toISOString();
export const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};
// An unrecorded figure reads as a dash, never as KES 0.
export const fmtMoney = (n) => (n == null || Number.isNaN(Number(n)) ? '—' : 'KES ' + Math.round(n).toLocaleString('en-KE'));

// Live mode (the brokerage's own records) replaces the seeded browser store with a db hydrated
// from the API, and routes writes through `backend.dispatch`. Nothing live is kept in the browser.
let backend = null;
/** Switch the engine to live records ({ db, dispatch }) or back to the demo store (null). */
export function useBackend(b) { backend = b; db = b ? b.db : null; }
export function isLive() { return !!backend; }
function loadRaw() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function saveRaw(v) { if (backend) return; try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage full or blocked: the demo keeps running in memory */ } }

const uid = (p) => p + '_' + (++db.meta.seq).toString(36);
const put = (coll, rec) => { db[coll].push(rec); return rec; };
export const all = (coll) => (db && db[coll]) || [];
export const byId = (coll, id) => all(coll).find(r => r.id === id) || null;
export const where = (coll, pred) => all(coll).filter(pred);

export function getDb() { if (!db) init(); return db; }
export function session() { return getDb().meta.session; }
export function actor() { return byId('users', session().userId); }
export function can(permission, role) {
  const r = role || actor()?.role;
  return (PERMS[permission] || []).includes(r);
}
export function approverFor(permission) {
  const list = PERMS[permission] || [];
  return all('users').find(u => list.includes(u.role) && u.id !== session().userId) || null;
}

function audit(text, opts = {}) {
  return put('auditEvents', {
    id: uid('aud'), at: nowIso(), actorId: session().userId, text,
    clientId: opts.clientId || null, entity: opts.entity || null,
    evidenceIds: opts.evidenceIds || [], kind: opts.kind || 'action'
  });
}

function evidenceFor(label, opts = {}) {
  return put('evidence', { id: uid('ev'), label, at: nowIso(), documentId: opts.documentId || null,
    emailId: opts.emailId || null, note: opts.note || '', clientId: opts.clientId || null });
}

// ---------------------------------------------------------------- seed
function seed(existingSession) {
  db = { meta: { seq: 0, ledger: {}, session: existingSession || { userId: null, clock: nowIso() } } };
  SCHEMA.forEach(c => db[c] = []);

  const brokerage = put('brokerages', { id: 'brk_asap', name: 'ASAP Brokers Ltd', country: 'Kenya',
    approvalRules: { placement: 'principal', money: 'finance', cover: 'insurer confirmation required' } });

  const mkUser = (id, name, role, initials) => put('users', { id, name, role, initials, brokerageId: brokerage.id });
  const grace = mkUser('usr_grace', 'Grace Wanjiku', 'ops', 'GW');
  const james = mkUser('usr_james', 'James Mwangi', 'account', 'JM');
  const amina = mkUser('usr_amina', 'Amina Kamau', 'claims', 'AK');
  const peter = mkUser('usr_peter', 'Peter Njoroge', 'finance', 'PN');
  const mary = mkUser('usr_mary', 'Mary Atieno', 'principal', 'MA');
  mkUser('usr_admin', 'Ruth Odhiambo', 'admin', 'RO');
  db.meta.session.userId = existingSession?.userId && byId('users', existingSession.userId) ? existingSession.userId : grace.id;

  put('connections', { id: 'con_gmail', kind: 'Gmail', account: 'ops@asapbrokers.demo', status: 'connected',
    lastSync: nowIso(), note: 'Fictional demo mailbox. No real mail is read or sent.' });
  put('connections', { id: 'con_sheets', kind: 'Records import', account: 'Spreadsheet & PDF upload', status: 'connected', lastSync: nowIso(), note: 'Local file reads only.' });
  put('connections', { id: 'con_model', kind: 'AI model', account: 'not configured', status: 'disconnected',
    note: 'Ask ASAP runs on the built-in intent layer. A server-side model endpoint is not configured.' });

  const mkClient = (id, name, short) => put('clients', { id, name, short, brokerageId: brokerage.id, createdAt: nowIso() });
  const acme = mkClient('cli_acme', 'Acme Manufacturing Ltd', 'AM');
  const blue = mkClient('cli_blue', 'Bluewave Properties Ltd', 'BP');
  const green = mkClient('cli_green', 'GreenCare Clinics Ltd', 'GC');
  const mara = mkClient('cli_mara', 'Mara Foods Ltd', 'MF');
  const karibu = mkClient('cli_karibu', 'Karibu Logistics Ltd', 'KL');

  const mkContact = (clientId, name, role, email) => put('contacts', { id: uid('con'), clientId, name, role, email });
  const david = mkContact(acme.id, 'David Otieno', 'Finance Manager', 'david.otieno@acme.demo');
  mkContact(acme.id, 'Jane Njeri', 'Driver', 'jane.njeri@acme.demo');
  mkContact(blue.id, 'Susan Kariuki', 'Facilities Director', 'susan@bluewave.demo');
  mkContact(green.id, 'Dr Alan Mutiso', 'Medical Director', 'alan@greencare.demo');
  mkContact(mara.id, 'Ben Kiptoo', 'Accountant', 'ben@marafoods.demo');
  mkContact(karibu.id, 'David Otieno', 'Finance Manager', 'david.otieno@karibulogistics.demo');

  const doc = (clientId, name, kind, title, lines, note) => {
    const d = put('documents', { id: uid('doc'), clientId, name, kind, currentVersion: 1, createdAt: nowIso(), source: 'seed' });
    put('documentVersions', { id: uid('dv'), documentId: d.id, version: 1, title, lines, note, at: nowIso(), by: 'seed' });
    return d;
  };

  // --- Acme main policy ASAP-MTR-2026-00418
  const acmePol = put('policies', { id: 'pol_acme_mtr', clientId: acme.id, number: 'ASAP-MTR-2026-00418',
    title: 'Commercial Motor Fleet', cls: 'Commercial motor · comprehensive' });
  const schedDoc = doc(acme.id, 'APA-Schedule-2026-v1.pdf', 'PDF · 6 pages', 'POLICY SCHEDULE — COMMERCIAL MOTOR',
    ['Insured: Acme Manufacturing Ltd, Nairobi.',
     'Policy number: ASAP-MTR-2026-00418. Insurer: APA Insurance.',
     'Period of insurance: 1 January 2026 to |31 December 2026| both dates inclusive.',
     'Vehicles insured: five (5) as listed in the attached schedule.',
     'Own damage excess: 2.5% of sum insured, minimum |KES 30,000| each and every claim.'],
    'Page 1 — the effective period and excess ASAP reads for cover checks.');
  const acmeYear = put('policyYears', { id: 'py_acme_2026', policyId: acmePol.id, clientId: acme.id, year: 2026,
    from: '2026-01-01', to: '2026-12-31', insurer: 'APA Insurance', premium: 4850000,
    status: 'active', scheduleVersion: 1, confirmationEvidenceId: null, scheduleDocumentId: schedDoc.id });
  acmeYear.confirmationEvidenceId = evidenceFor('APA written confirmation, 20 Dec 2025', { documentId: schedDoc.id, clientId: acme.id }).id;

  const veh = (yearId, reg, make, value, extra) => put('policyItems', Object.assign({
    id: uid('itm'), policyYearId: yearId, clientId: acme.id, reg, make, value, status: 'on cover',
    addedAt: '2026-01-01', scheduleVersion: 1 }, extra || {}));
  veh(acmeYear.id, 'KDM 811A', 'Isuzu FRR 2019', 4200000);
  veh(acmeYear.id, 'KDA 214P', 'Mitsubishi Canter 2017', 2950000);
  veh(acmeYear.id, 'KDJ 204P', 'Isuzu NQR 2018', 3600000);
  veh(acmeYear.id, 'KCX 771T', 'Toyota Hiace 2020', 2100000);
  veh(acmeYear.id, 'KDF 903M', 'Toyota Hilux 2021', 3400000);

  const inv = put('invoices', { id: 'inv_4471', clientId: acme.id, policyYearId: acmeYear.id, number: 'INV-4471',
    amount: 4850000, paid: 0, status: 'Unpaid', issuedAt: '2026-01-05', kind: 'Premium' });
  put('commissions', { id: 'com_acme', clientId: acme.id, policyYearId: acmeYear.id, insurer: 'APA Insurance',
    expected: 727500, received: 0, status: 'Expected', rate: '15%' });

  // Acme incoming email that starts the quotation journey (test 4)
  const email = (o) => put('emails', Object.assign({ id: uid('eml'), at: nowIso(), direction: 'in', read: false }, o));
  const davidMail = email({ clientId: acme.id, contactId: david.id, direction: 'in',
    from: 'david.otieno@acme.demo', to: 'ops@asapbrokers.demo',
    subject: 'Commercial motor — 2026 fleet request',
    body: 'Hi Grace,\n\nWe need comprehensive cover for five commercial vehicles for the coming year. Please approach the market — our current terms with APA feel expensive.\n\nRegards,\nDavid Otieno\nFinance Manager, Acme Manufacturing Ltd',
    threadId: 'thr_acme_fleet' });
  const logbook = doc(acme.id, 'KDN482Q-Logbook.pdf', 'PDF · 2 pages', 'CERTIFICATE OF REGISTRATION',
    ['Registration number: |KDN 482Q|', 'Make and model: Isuzu NPR 2022', 'Registered owner: Acme Manufacturing Ltd',
     'Tare weight: 3,250 kg  ·  Body type: Box truck'],
    'The logbook proves ownership and identity. It does not state a value, and it is not proof of cover.');
  const receiptDoc = doc(acme.id, 'Acme-Payment-Advice.pdf', 'PDF · 1 page', 'BANK TRANSFER ADVICE',
    ['From: Acme Manufacturing Ltd · Account 01xxxxxx8841',
     'Amount: |KES 4,000,000.00|  Value date: ' + fmtDate(nowIso()),
     'Reference: ACME MOTOR PREMIUM PART PAYMENT', 'Beneficiary: ASAP Brokers premium collection account'],
    'Proves a transfer of KES 4,000,000 only. It does not settle the invoice by itself.');
  doc(acme.id, 'CIC-Statement-Sep.pdf', 'PDF · 4 pages', 'INSURER STATEMENT — CIC GENERAL',
    ['Acme Manufacturing Ltd — policy ASAP-MTR-2026-00418', 'Premium debited: KES 4,850,000',
     'Endorsement E0231 additional premium: |KES 214,500|', 'Commission due to broker: KES 727,500',
     'Payments received from broker: KES 4,000,000'],
    'The endorsement line is the difference ASAP cannot explain without your decision.');

  // Work items that make Today real
  const work = (o) => put('workItems', Object.assign({ id: uid('wrk'), createdAt: nowIso(), state: 'Active',
    parties: [], assigneeId: grace.id, dueAt: null, priority: 'medium', reason: '' }, o));
  work({ clientId: acme.id, kind: 'Servicing', title: 'Add vehicle KDN 482Q to Acme cover', priority: 'high',
    reason: 'A client asked for cover today and no insurer confirmation exists yet.', policyYearId: acmeYear.id,
    documentIds: [logbook.id] });
  work({ clientId: acme.id, kind: 'Money', title: 'KES 4,850,000 premium unpaid on INV-4471', priority: 'medium',
    reason: 'Premium has been outstanding since 5 January and one receipt is unmatched.', invoiceId: inv.id });
  work({ clientId: blue.id, kind: 'Renewal', title: 'Bluewave renewal has no usable terms', priority: 'medium',
    reason: 'Expiry is 34 days away and two insurers are waiting on a valuation.',
    parties: [{ name: 'Client', since: nowIso() }], state: 'Waiting', assigneeId: james.id });
  work({ clientId: green.id, kind: 'Claim', title: 'GreenCare settlement accepted but unpaid', priority: 'medium',
    reason: 'The offer was accepted three days ago and no remittance evidence exists.', assigneeId: amina.id });
  work({ clientId: mara.id, kind: 'Money', title: 'Mara Foods KES 860,000 balance overdue', priority: 'low',
    reason: 'Eighteen days overdue with one receipt that could match two invoices.', assigneeId: peter.id });

  put('invoices', { id: 'inv_mara', clientId: mara.id, number: 'INV-4402', amount: 860000, paid: 0,
    status: 'Unpaid', issuedAt: '2026-08-01', kind: 'Premium' });
  put('invoices', { id: 'inv_mara2', clientId: mara.id, number: 'INV-4411', amount: 860000, paid: 0,
    status: 'Unpaid', issuedAt: '2026-08-20', kind: 'Premium' });

  // Bluewave / GreenCare / Mara supporting records so side cases are real
  const bluePol = put('policies', { id: 'pol_blue', clientId: blue.id, number: 'ASAP-FIR-2026-00204', title: 'Property & Fire', cls: 'Fire industrial' });
  put('policyYears', { id: 'py_blue_2026', policyId: bluePol.id, clientId: blue.id, year: 2026, from: '2025-11-01',
    to: '2026-10-19', insurer: 'Jubilee Insurance', premium: 2310000, status: 'active', scheduleVersion: 1 });
  const greenPol = put('policies', { id: 'pol_green', clientId: green.id, number: 'ASAP-MED-2026-00077', title: 'Medical Malpractice', cls: 'Liability' });
  const greenYear = put('policyYears', { id: 'py_green_2026', policyId: greenPol.id, clientId: green.id, year: 2026,
    from: '2026-03-01', to: '2027-02-28', insurer: 'CIC General Insurance', premium: 1180000, status: 'active', scheduleVersion: 1 });
  put('claims', { id: 'clm_green', clientId: green.id, policyYearId: greenYear.id, ref: 'CIC/MED/26/1182',
    title: 'GreenCare — settlement accepted', lossAt: '2026-05-04', status: 'Settlement accepted, unpaid',
    excess: 100000, checklist: [{ label: 'Settlement remittance', state: 'todo' }], timeline: [], parties: [{ name: 'CIC', since: '2026-08-01' }] });

  // Karibu journey retained (earlier demo) so nothing was removed
  const kPol = put('policies', { id: 'pol_karibu', clientId: karibu.id, number: 'ASAP-MTR-2026-00931',
    title: 'Commercial Motor Fleet', cls: 'Commercial motor · comprehensive' });
  const kSched = doc(karibu.id, 'CIC-Policy-Schedule.pdf', 'PDF · 4 pages', 'POLICY SCHEDULE — CIC GENERAL',
    ['Insured: Karibu Logistics Ltd', 'Policy: ASAP-MTR-2026-00931 · Insurer: CIC General Insurance',
     'Period: 1 December 2026 to |30 November 2027|', 'Five vehicles · premium KES 4,850,000',
     'Windscreen limit: KES 25,000 (quoted at KES 30,000).'],
    'The windscreen difference was accepted by Grace when the policy was created.');
  const kYear = put('policyYears', { id: 'py_karibu_2026', policyId: kPol.id, clientId: karibu.id, year: 2026,
    from: '2026-12-01', to: '2027-11-30', insurer: 'CIC General Insurance', premium: 4850000, status: 'active',
    scheduleVersion: 1, scheduleDocumentId: kSched.id });
  kYear.confirmationEvidenceId = evidenceFor('CIC written confirmation and debit note', { documentId: kSched.id, clientId: karibu.id }).id;
  ['KDM 811A|Isuzu FRR 2019|4200000', 'KDJ 204P|Isuzu NQR 2018|3600000', 'KCX 771T|Toyota Hiace 2020|2100000',
   'KDA 556B|Mitsubishi Canter 2017|2950000', 'KDF 903M|Toyota Hilux 2021|3400000'].forEach(s => {
    const [reg, make, value] = s.split('|');
    put('policyItems', { id: uid('itm'), policyYearId: kYear.id, clientId: karibu.id, reg, make, value: +value,
      status: 'on cover', addedAt: '2026-12-01', scheduleVersion: 1 });
  });

  put('automations', { id: 'aut_serv', name: 'New servicing request', on: true, ownerId: grace.id,
    trigger: 'Client email asks for a policy change', conditions: 'Client is known and a policy is active',
    actions: 'Identify the policy, extract details, prepare servicing work', approval: 'Human sends all external mail',
    runs: 8 });
  put('automations', { id: 'aut_claim', name: 'Claim follow-up monitor', on: true, ownerId: amina.id,
    trigger: 'A claim has no external movement for three days', conditions: 'Claim is open and with an insurer',
    actions: 'Rebuild the timeline and prepare a follow-up', approval: 'Human sends the follow-up', runs: 3 });
  put('automations', { id: 'aut_var', name: 'Premium variance check', on: true, ownerId: peter.id,
    trigger: 'Insurer statement received', conditions: 'Statement differs from our ledger',
    actions: 'Compare invoices, endorsements, payments and credit notes', approval: 'Finance approves any money change', runs: 17 });

  audit('Demo data reset — ASAP Brokers Ltd, 6 users, 5 clients, 4 policies seeded', { kind: 'system' });
  saveRaw(db);
  return db;
}

export function init() { if (backend) { db = backend.db; return db; } db = loadRaw(); if (!db || !db.meta || db.meta.v !== undefined) { /* legacy */ } if (!db || !db.brokerages) db = seed(); return db; }
export function resetDb() { if (backend) return db; const s = db?.meta?.session; db = seed(s ? { userId: s.userId } : null); return db; }
export function resetSummary() {
  const d = getDb();
  return { removes: d.auditEvents.filter(a => a.kind === 'action').length + ' actions you took, ' +
      d.emails.filter(e => e.direction === 'out').length + ' sent messages, ' +
      d.payments.length + ' payments and ' + d.workItems.filter(w => w.createdBy).length + ' work items you created',
    restores: 'ASAP Brokers Ltd, 6 users with roles, Acme Manufacturing (ASAP-MTR-2026-00418), Bluewave, GreenCare, Mara Foods and the Karibu Logistics journey' };
}
export function setUser(userId) { const d = getDb(); d.meta.session.userId = userId; saveRaw(d); }

// ---------------------------------------------------------------- actions
const H = {};

H['records.import'] = (p) => {
  const client = byId('clients', p.clientId);
  const created = [];
  (p.files || []).forEach(f => {
    const d = put('documents', { id: uid('doc'), clientId: client.id, name: f.name, kind: f.kind || 'Uploaded file',
      currentVersion: 1, createdAt: nowIso(), source: 'import' });
    put('documentVersions', { id: uid('dv'), documentId: d.id, version: 1, title: f.name.toUpperCase(),
      lines: f.lines || ['Uploaded by ' + actor().name + ' on ' + fmtDate(nowIso()) + '.', 'Extraction: ' + (f.extracted || 'fields read from this file')],
      note: f.note || 'Original file retained as evidence.', at: nowIso(), by: actor().name });
    created.push(d.id);
  });
  (p.corrections || []).forEach(c => audit('Extraction corrected before saving — ' + c, { clientId: client.id, kind: 'correction' }));
  const ev = evidenceFor('Import of ' + created.length + ' file(s) confirmed by ' + actor().name, { clientId: client.id });
  audit(created.length + ' file(s) imported and linked to ' + client.name, { clientId: client.id, evidenceIds: [ev.id] });
  return { documentIds: created, text: created.length + ' files saved to ' + client.name };
};

H['opportunity.create'] = (p) => {
  const client = byId('clients', p.clientId);
  const op = put('opportunities', { id: uid('opp'), clientId: client.id, title: p.title, cls: p.cls || 'Commercial motor',
    sourceEmailId: p.emailId || null, createdAt: nowIso(), ownerId: p.ownerId || session().userId, status: 'Open' });
  const w = put('workItems', { id: uid('wrk'), clientId: client.id, kind: 'Quotation', title: p.title,
    opportunityId: op.id, assigneeId: op.ownerId, state: 'Active', createdAt: nowIso(), createdBy: session().userId,
    parties: [], priority: 'high', reason: 'New business request received by email and not yet quoted.',
    dueAt: p.dueAt || null, documentIds: [] });
  const ev = evidenceFor('Source email from ' + (byId('contacts', p.contactId)?.name || 'the client'), { emailId: p.emailId, clientId: client.id });
  audit('Quotation opportunity created for ' + client.name + ' from an email', { clientId: client.id, entity: op.id, evidenceIds: [ev.id] });
  return { opportunityId: op.id, workItemId: w.id, text: 'Quotation work created for ' + client.name };
};

H['quote.prepare'] = (p) => {
  const q = put('quotes', { id: uid('qte'), clientId: p.clientId, opportunityId: p.opportunityId,
    insurers: p.insurers, status: 'Prepared', createdAt: nowIso(), requirements: p.requirements || [] });
  const w = byId('workItems', p.workItemId);
  if (w) { w.quoteId = q.id; w.state = 'Active'; }
  audit('Insurer request prepared for ' + p.insurers.join(', ') + ' — nothing sent yet', { clientId: p.clientId, entity: q.id });
  return { quoteId: q.id, text: 'Request prepared for ' + p.insurers.length + ' insurers' };
};

H['email.send'] = (p) => {
  if (!can('email.send')) return null;
  const sent = [];
  (p.recipients || []).forEach(r => {
    const e = put('emails', { id: uid('eml'), clientId: p.clientId, direction: 'out', at: nowIso(),
      from: 'ops@asapbrokers.demo', to: r.email, party: r.name, subject: p.subject, body: p.body,
      attachments: p.attachments || [], sentById: session().userId, threadId: p.threadId || uid('thr'),
      workItemId: p.workItemId || null });
    sent.push(e.id);
  });
  const w = byId('workItems', p.workItemId);
  if (w) {
    w.parties = (p.recipients || []).map(r => ({ name: r.name, since: nowIso() }));
    w.state = w.parties.length ? 'With ' + w.parties.map(x => x.name).join(', ') : w.state;
  }
  const ap = put('approvals', { id: uid('apr'), kind: 'external message', byId: session().userId, at: nowIso(),
    subject: p.subject, workItemId: p.workItemId || null, status: 'valid', signature: p.signature || '' });
  const ev = evidenceFor('Message sent by ' + actor().name + ' to ' + (p.recipients || []).map(r => r.name).join(', '), { emailId: sent[0], clientId: p.clientId });
  audit('Sent “' + p.subject + '” to ' + (p.recipients || []).map(r => r.name).join(', '), { clientId: p.clientId, evidenceIds: [ev.id] });
  return { emailIds: sent, approvalId: ap.id, text: sent.length + ' message(s) sent and saved as evidence' };
};

H['quote.reply'] = (p) => {
  const q = byId('quotes', p.quoteId);
  (p.versions || []).forEach(v => put('quoteVersions', { id: uid('qv'), quoteId: q.id, clientId: q.clientId,
    insurer: v.insurer, premium: v.premium, terms: v.terms, version: v.version || 1, receivedAt: nowIso(),
    documentId: v.documentId || null, issues: v.issues || [] }));
  q.status = 'Replies received';
  audit((p.versions || []).length + ' insurer quotation(s) recorded for comparison', { clientId: q.clientId, entity: q.id });
  return { text: 'Quotations recorded' };
};

H['quote.choice'] = (p) => {
  if (!can('quote.choice')) return null;
  const q = byId('quotes', p.quoteId);
  if (!p.evidenceNote) return { error: 'Client choice needs evidence before it can be recorded.' };
  const ev = evidenceFor('Client decision — ' + p.evidenceNote, { clientId: q.clientId });
  q.chosenInsurer = p.insurer; q.chosenAt = nowIso(); q.chosenEvidenceId = ev.id; q.status = 'Insurer chosen';
  audit('Client chose ' + p.insurer + ' — recorded by ' + actor().name, { clientId: q.clientId, entity: q.id, evidenceIds: [ev.id] });
  return { text: p.insurer + ' recorded as the client’s choice' };
};

H['placement.create'] = (p) => {
  const q = byId('quotes', p.quoteId);
  if (!q.chosenInsurer) return { error: 'No client choice evidence is attached to this quote yet.' };
  const pl = put('placements', { id: uid('plc'), clientId: q.clientId, quoteId: q.id, insurer: q.chosenInsurer,
    status: 'Requirements outstanding', createdAt: nowIso(),
    requirements: p.requirements || [{ label: 'Signed proposal form', state: 'todo' }, { label: 'Logbook copies', state: 'done' }, { label: 'KRA PIN certificate', state: 'todo' }],
    approvalId: null, confirmationEvidenceId: null });
  const w = put('workItems', { id: uid('wrk'), clientId: q.clientId, kind: 'Placement', title: 'Placement — ' + q.chosenInsurer,
    placementId: pl.id, assigneeId: session().userId, state: 'Active', createdAt: nowIso(), createdBy: session().userId,
    parties: [], priority: 'high', reason: 'Cover is not in force until this insurer confirms in writing.' });
  audit('Placement work created with ' + q.chosenInsurer + ' — cover not in force', { clientId: q.clientId, entity: pl.id });
  return { placementId: pl.id, workItemId: w.id, text: 'Placement prepared with ' + q.chosenInsurer };
};

H['placement.approve'] = (p) => {
  if (!can('placement.approve')) return null;
  const pl = byId('placements', p.placementId);
  const ap = put('approvals', { id: uid('apr'), kind: 'placement', byId: session().userId, at: nowIso(),
    placementId: pl.id, status: 'valid', consequence: 'Instructs ' + pl.insurer + ' to place cover' });
  pl.approvalId = ap.id; pl.status = 'Approved for submission';
  audit('Placement approved by ' + actor().name + ' (' + ROLES[actor().role] + ')', { clientId: pl.clientId, entity: pl.id });
  return { approvalId: ap.id, text: 'Placement approved' };
};

H['approval.invalidate'] = (p) => {
  const list = where('approvals', a => (p.placementId && a.placementId === p.placementId) || (p.workItemId && a.workItemId === p.workItemId));
  list.forEach(a => { if (a.status === 'valid') { a.status = 'stale'; a.staleReason = p.reason; } });
  if (list.length) audit('Approval marked stale — ' + p.reason, { clientId: p.clientId, kind: 'integrity' });
  return { text: list.length + ' approval(s) invalidated' };
};

H['policy.issue'] = (p) => {
  if (!can('policy.issue')) return null;
  const pl = byId('placements', p.placementId);
  if (!p.confirmationNote) return { error: 'Insurer confirmation evidence is required before a policy can exist.' };
  const ev = evidenceFor('Insurer confirmation — ' + p.confirmationNote, { clientId: pl.clientId, documentId: p.documentId || null });
  const pol = put('policies', { id: uid('pol'), clientId: pl.clientId, number: p.number,
    title: p.title || 'Commercial Motor Fleet', cls: 'Commercial motor · comprehensive' });
  const year = put('policyYears', { id: uid('py'), policyId: pol.id, clientId: pl.clientId, year: p.year,
    from: p.from, to: p.to, insurer: pl.insurer, premium: p.premium, status: 'active', scheduleVersion: 1,
    confirmationEvidenceId: ev.id, placementId: pl.id, differences: p.differences || [] });
  (p.items || []).forEach(it => put('policyItems', { id: uid('itm'), policyYearId: year.id, clientId: pl.clientId,
    reg: it.reg, make: it.make, value: it.value, status: 'on cover', addedAt: p.from, scheduleVersion: 1 }));
  const invoice = put('invoices', { id: uid('inv'), clientId: pl.clientId, policyYearId: year.id,
    number: 'INV-' + (4500 + all('invoices').length), amount: p.premium, paid: 0, status: 'Unpaid', issuedAt: nowIso(), kind: 'Premium' });
  put('commissions', { id: uid('cms'), clientId: pl.clientId, policyYearId: year.id, insurer: pl.insurer,
    expected: Math.round(p.premium * 0.15), received: 0, status: 'Expected', rate: '15%' });
  pl.status = 'Cover confirmed';
  const w = where('workItems', x => x.placementId === pl.id)[0];
  if (w) { w.state = 'Completed'; w.completedAt = nowIso(); }
  audit('Policy ' + p.number + ' created — Active cover from confirmation evidence', { clientId: pl.clientId, entity: year.id, evidenceIds: [ev.id] });
  return { policyYearId: year.id, invoiceId: invoice.id, text: 'Policy ' + p.number + ' is now Active cover' };
};

H['servicing.create'] = (p) => {
  const sr = put('servicingRequests', { id: uid('srv'), clientId: p.clientId, policyYearId: p.policyYearId,
    kind: p.kind || 'Add vehicle', detail: p.detail, requestedAt: nowIso(), status: 'Requested by client',
    missing: p.missing || [], documentIds: p.documentIds || [] });
  const w = put('workItems', { id: uid('wrk'), clientId: p.clientId, kind: 'Servicing', title: p.detail,
    servicingId: sr.id, policyYearId: p.policyYearId, assigneeId: session().userId, state: 'Active',
    createdAt: nowIso(), createdBy: session().userId, parties: [], priority: 'high',
    reason: 'A client request is not proof of cover — the insurer has not confirmed.' });
  audit('Servicing request opened — ' + p.detail, { clientId: p.clientId, entity: sr.id });
  return { servicingId: sr.id, workItemId: w.id, text: 'Servicing work opened' };
};

H['tor.request'] = (p) => {
  const t = put('torRequests', { id: uid('tor'), clientId: p.clientId, policyYearId: p.policyYearId,
    servicingId: p.servicingId || null, detail: p.detail, value: p.value || null, requestedAt: nowIso(),
    status: 'Requested from insurer', confirmationEvidenceId: null });
  audit('TOR requested from insurer — ' + p.detail + ' (cover not confirmed)', { clientId: p.clientId, entity: t.id });
  return { torId: t.id, text: 'TOR request recorded' };
};

H['cover.change'] = (p) => {
  if (!can('cover.change')) return null;
  if (!p.confirmationNote) return { error: 'Insurer confirmation is required before cover can change.' };
  const year = byId('policyYears', p.policyYearId);
  const ev = evidenceFor('Insurer endorsement — ' + p.confirmationNote, { clientId: year.clientId, documentId: p.documentId || null });
  year.scheduleVersion += 1;
  const newItems = [];
  (p.add || []).forEach(it => newItems.push(put('policyItems', { id: uid('itm'), policyYearId: year.id,
    clientId: year.clientId, reg: it.reg, make: it.make, value: it.value, status: 'on cover',
    addedAt: nowIso(), scheduleVersion: year.scheduleVersion, evidenceId: ev.id })));
  (p.remove || []).forEach(reg => {
    const it = where('policyItems', x => x.policyYearId === year.id && x.reg === reg && x.status === 'on cover')[0];
    if (it) { it.status = 'removed'; it.removedAt = nowIso(); it.removedInVersion = year.scheduleVersion; }
  });
  const end = put('endorsements', { id: uid('end'), clientId: year.clientId, policyYearId: year.id,
    kind: p.kind || 'Addition', detail: p.detail, additionalPremium: p.additionalPremium || 0,
    at: nowIso(), scheduleVersion: year.scheduleVersion, evidenceId: ev.id });
  if (p.additionalPremium) {
    const inv = put('invoices', { id: uid('inv'), clientId: year.clientId, policyYearId: year.id,
      number: 'INV-' + (4500 + all('invoices').length), amount: p.additionalPremium, paid: 0,
      status: 'Unpaid', issuedAt: nowIso(), kind: 'Additional premium', endorsementId: end.id });
    end.invoiceId = inv.id;
  }
  if (p.torId) { const t = byId('torRequests', p.torId); if (t) { t.status = 'Confirmed by insurer'; t.confirmationEvidenceId = ev.id; } }
  if (p.servicingId) { const s = byId('servicingRequests', p.servicingId); if (s) s.status = 'Completed — confirmed'; }
  where('workItems', w => w.servicingId && w.servicingId === p.servicingId).forEach(w => { w.state = 'Completed'; w.completedAt = nowIso(); });
  audit('Schedule v' + year.scheduleVersion + ' — ' + p.detail + ' (previous version retained)', { clientId: year.clientId, entity: end.id, evidenceIds: [ev.id] });
  return { endorsementId: end.id, text: 'Cover updated to schedule v' + year.scheduleVersion };
};

H['claim.register'] = (p) => {
  if (!can('claim.manage')) return null;
  const year = byId('policyYears', p.policyYearId);
  const item = where('policyItems', x => x.policyYearId === year.id && x.reg === p.reg)[0];
  const covered = !!item && p.lossAt >= year.from && p.lossAt <= year.to && item.status === 'on cover';
  const c = put('claims', { id: uid('clm'), clientId: p.clientId, policyYearId: year.id, reg: p.reg,
    title: p.title, lossAt: p.lossAt, location: p.location || null, driver: p.driver || null,
    status: 'Notified — not accepted', ref: null, coveredOnLossDate: covered,
    excess: item ? Math.max(30000, Math.round(item.value * 0.025)) : 30000,
    checklist: [{ label: 'Police abstract', state: 'todo' }, { label: 'Driver statement', state: 'todo' },
      { label: 'Photographs of damage', state: 'todo' }, { label: 'Assessor report', state: 'todo' }],
    timeline: [{ at: nowIso(), text: 'Claim registered by ' + actor().name }], parties: [], nextCheckAt: null });
  const w = put('workItems', { id: uid('wrk'), clientId: p.clientId, kind: 'Claim', title: p.title, claimId: c.id,
    assigneeId: session().userId, state: 'Active', createdAt: nowIso(), createdBy: session().userId, parties: [],
    priority: 'high', reason: 'A new loss was reported and the insurer has not been notified yet.' });
  audit('Claim registered for ' + p.reg + ' — cover on loss date ' + (covered ? 'confirmed' : 'NOT confirmed'), { clientId: p.clientId, entity: c.id });
  return { claimId: c.id, workItemId: w.id, text: 'Claim registered — nothing accepted yet' };
};

H['claim.document'] = (p) => {
  const c = byId('claims', p.claimId);
  const d = put('documents', { id: uid('doc'), clientId: c.clientId, name: p.name, kind: p.kind || 'Uploaded file',
    currentVersion: 1, createdAt: nowIso(), source: 'claim', claimId: c.id });
  put('documentVersions', { id: uid('dv'), documentId: d.id, version: 1, title: p.name.toUpperCase(),
    lines: p.lines || ['Uploaded by ' + actor().name + ' on ' + fmtDate(nowIso()) + '.'], note: 'Claim document.', at: nowIso(), by: actor().name });
  const hit = c.checklist.find(x => x.label.toLowerCase().includes((p.matches || '').toLowerCase()) && p.matches);
  if (hit) { hit.state = 'done'; hit.documentId = d.id; }
  c.timeline.push({ at: nowIso(), text: p.name + ' added' + (hit ? ' — ' + hit.label + ' complete' : '') });
  audit('Claim document added — ' + p.name, { clientId: c.clientId, entity: c.id });
  return { documentId: d.id, text: p.name + ' linked to the claim' };
};

H['claim.update'] = (p) => {
  const c = byId('claims', p.claimId);
  if (p.ref) c.ref = p.ref;
  if (p.status) c.status = p.status;
  if (p.nextCheckAt) c.nextCheckAt = p.nextCheckAt;
  if (p.party) c.parties = [{ name: p.party, since: nowIso() }];
  c.timeline.push({ at: nowIso(), text: p.text || 'Claim updated' });
  audit('Claim updated — ' + (p.text || p.status), { clientId: c.clientId, entity: c.id });
  return { text: 'Claim timeline updated' };
};

H['payment.match'] = (p) => {
  if (!can('money.change')) return null;
  const inv = byId('invoices', p.invoiceId);
  const pay = put('payments', { id: uid('pay'), clientId: inv.clientId, invoiceId: inv.id, amount: p.amount,
    at: nowIso(), reference: p.reference || '', documentId: p.documentId || null, approvedById: session().userId });
  inv.paid += p.amount;
  inv.status = inv.paid >= inv.amount ? 'Paid' : inv.paid > 0 ? 'Part paid' : 'Unpaid';
  put('reconciliationLines', { id: uid('rec'), clientId: inv.clientId, insurer: byId('policyYears', inv.policyYearId)?.insurer || '—',
    label: 'Premium payment ' + inv.number, ours: p.amount, theirs: p.amount, status: 'Matched',
    invoiceId: inv.id, paymentId: pay.id });
  where('workItems', w => w.invoiceId === inv.id).forEach(w => {
    w.title = inv.status === 'Paid' ? inv.number + ' paid in full' : fmtMoney(inv.amount - inv.paid) + ' outstanding on ' + inv.number;
    w.state = inv.status === 'Paid' ? 'Completed' : 'Active';
    w.reason = 'Balance after the payment you approved on ' + fmtDate(nowIso()) + '.';
  });
  const ev = evidenceFor('Receipt matched to ' + inv.number + ' by ' + actor().name, { documentId: p.documentId, clientId: inv.clientId });
  audit('Payment ' + fmtMoney(p.amount) + ' matched to ' + inv.number + ' — ' + inv.status, { clientId: inv.clientId, entity: pay.id, evidenceIds: [ev.id] });
  return { paymentId: pay.id, text: inv.number + ' is now ' + inv.status + ', ' + fmtMoney(Math.max(0, inv.amount - inv.paid)) + ' outstanding' };
};

H['reconcile.run'] = (p) => {
  const insurer = p.insurer;
  const lines = [];
  where('invoices', i => (byId('policyYears', i.policyYearId)?.insurer || '') === insurer).forEach(i => {
    const paid = i.paid;
    lines.push(put('reconciliationLines', { id: uid('rec'), clientId: i.clientId, insurer, label: i.kind + ' ' + i.number,
      ours: i.amount, theirs: i.kind === 'Additional premium' ? 0 : i.amount,
      status: i.kind === 'Additional premium' ? 'Unresolved' : (paid >= i.amount ? 'Reconciled' : 'Explainable difference'),
      invoiceId: i.id }));
  });
  const com = where('commissions', c => c.insurer === insurer)[0];
  if (com) lines.push(put('reconciliationLines', { id: uid('rec'), clientId: com.clientId, insurer,
    label: 'Commission ' + com.rate, ours: com.expected, theirs: com.received, status: 'Unresolved', commissionId: com.id }));
  audit('Reconciliation run for ' + insurer + ' — ' + lines.length + ' lines', { kind: 'action' });
  return { lineIds: lines.map(l => l.id), text: lines.length + ' statement lines compared' };
};

H['reconcile.resolve'] = (p) => {
  if (!can('money.change')) return null;
  const l = byId('reconciliationLines', p.lineId);
  l.status = p.status; l.note = p.note || ''; l.resolvedById = session().userId; l.resolvedAt = nowIso();
  if (l.commissionId && p.status === 'Disputed') { const c = byId('commissions', l.commissionId); c.status = 'Disputed'; c.note = p.note; }
  if (l.commissionId && p.status === 'Reconciled') { const c = byId('commissions', l.commissionId); c.status = 'Reconciled'; c.received = c.expected; }
  audit('Reconciliation line ' + p.status.toLowerCase() + ' — ' + l.label, { clientId: l.clientId, entity: l.id });
  return { text: l.label + ' → ' + p.status };
};

H['renewal.create'] = (p) => {
  const old = byId('policyYears', p.policyYearId);
  const claims = where('claims', c => c.policyYearId === old.id);
  const ends = where('endorsements', e => e.policyYearId === old.id);
  const owing = where('invoices', i => i.policyYearId === old.id).reduce((a, i) => a + (i.amount - i.paid), 0);
  const loading = claims.length ? 0.08 : 0;
  const premium = Math.round(old.premium * (1 + 0.06 + loading) + ends.reduce((a, e) => a + e.additionalPremium, 0));
  const year = put('policyYears', { id: uid('py'), policyId: old.policyId, clientId: old.clientId, year: old.year + 1,
    from: new Date(new Date(old.to).getTime() + 86400000).toISOString().slice(0, 10),
    to: (old.year + 1) + '-12-31', insurer: old.insurer, premium, status: 'renewal prepared',
    scheduleVersion: 1, renewedFromId: old.id, differences: [] });
  const w = put('workItems', { id: uid('wrk'), clientId: old.clientId, kind: 'Renewal',
    title: 'Renewal ' + year.year + ' — ' + byId('policies', old.policyId).number, policyYearId: year.id,
    assigneeId: session().userId, state: 'Active', createdAt: nowIso(), createdBy: session().userId, parties: [],
    priority: 'medium', reason: 'Expiry is approaching and terms must be prepared with this year’s history.' });
  audit('Renewal year ' + year.year + ' created — ' + (old.year) + ' retained in full', { clientId: old.clientId, entity: year.id });
  return { policyYearId: year.id, workItemId: w.id,
    text: 'Renewal prepared at ' + fmtMoney(premium) + (owing ? ' with ' + fmtMoney(owing) + ' still outstanding on ' + old.year : '') };
};

H['work.assign'] = (p) => {
  if (!can('work.assign')) return null;
  const w = byId('workItems', p.workItemId);
  const u = byId('users', p.userId);
  const prev = byId('users', w.assigneeId);
  w.assigneeId = u.id; if (p.dueAt) w.dueAt = p.dueAt;
  audit('“' + w.title + '” assigned to ' + u.name + (prev ? ' (was ' + prev.name + ')' : '') + (p.dueAt ? ', due ' + fmtDate(p.dueAt) : ''), { clientId: w.clientId, entity: w.id });
  return { text: w.title + ' → ' + u.name + (p.dueAt ? ', due ' + fmtDate(p.dueAt) : '') };
};

H['work.create'] = (p) => {
  const w = put('workItems', { id: uid('wrk'), clientId: p.clientId || null, kind: p.kind || 'Task', title: p.title,
    assigneeId: p.userId || session().userId, state: 'Active', createdAt: nowIso(), createdBy: session().userId,
    parties: [], priority: p.priority || 'medium', reason: p.reason || 'Created from an investigation.', dueAt: p.dueAt || null });
  audit('Work created — ' + p.title, { clientId: p.clientId, entity: w.id });
  return { workItemId: w.id, text: 'Work created: ' + p.title };
};

H['document.upload'] = (p) => {
  const d = put('documents', { id: uid('doc'), clientId: p.clientId || null, name: p.name, kind: p.kind,
    currentVersion: 1, createdAt: nowIso(), source: 'upload', bytes: p.bytes || 0 });
  put('documentVersions', { id: uid('dv'), documentId: d.id, version: 1, title: p.name.toUpperCase(),
    lines: p.lines || ['Uploaded by ' + actor().name + '.', 'Size: ' + Math.round((p.bytes || 0) / 1024) + ' KB'],
    note: p.note || 'Original file retained.', at: nowIso(), by: actor().name });
  audit('Document uploaded — ' + p.name, { clientId: p.clientId, entity: d.id });
  return { documentId: d.id, text: p.name + ' uploaded' };
};

H['document.version'] = (p) => {
  const d = byId('documents', p.documentId);
  d.currentVersion += 1;
  put('documentVersions', { id: uid('dv'), documentId: d.id, version: d.currentVersion, title: p.title || d.name.toUpperCase(),
    lines: p.lines || ['Revised copy uploaded by ' + actor().name + '.'], note: p.note || 'Earlier version retained.', at: nowIso(), by: actor().name });
  audit('New version v' + d.currentVersion + ' of ' + d.name + ' — earlier version retained', { clientId: d.clientId, entity: d.id });
  return { text: d.name + ' is now v' + d.currentVersion };
};

H['automation.save'] = (p) => {
  if (!can('automation.manage')) return null;
  const a = p.id ? byId('automations', p.id) : put('automations', { id: uid('aut'), runs: 0, on: false, ownerId: session().userId });
  Object.assign(a, { name: p.name, trigger: p.trigger, conditions: p.conditions, actions: p.actions, approval: p.approval });
  audit('Automation saved — ' + a.name, { entity: a.id });
  return { automationId: a.id, text: a.name + ' saved (inactive until you switch it on)' };
};

H['automation.toggle'] = (p) => {
  if (!can('automation.manage')) return null;
  const a = byId('automations', p.id); a.on = !a.on;
  audit('Automation ' + (a.on ? 'switched on' : 'paused') + ' — ' + a.name, { entity: a.id });
  return { text: a.name + (a.on ? ' is on' : ' is paused') };
};

H['automation.run'] = (p) => {
  const a = byId('automations', p.id);
  const test = !!p.test;
  const target = where('policyYears', y => y.status === 'active')[0];
  const run = put('automationRuns', { id: uid('run'), automationId: a.id, at: nowIso(), mode: test ? 'test' : 'live',
    status: p.fail ? 'failed' : 'completed', reason: 'Policy ' + (byId('policies', target?.policyId)?.number || '—') + ' matched the trigger',
    writes: [], error: p.fail ? 'Insurer mailbox refused the connection' : null });
  if (!test && !p.fail) {
    const r = H['renewal.create']({ policyYearId: target.id });
    run.writes = [r.policyYearId, r.workItemId];
    a.runs += 1;
  }
  audit('Automation run (' + run.mode + ') — ' + a.name + ' · ' + run.status + (test ? ' · zero writes' : ''), { entity: run.id, kind: 'automation' });
  return { runId: run.id, text: test ? 'Test run finished with zero record writes' : p.fail ? 'Run failed — safe to retry' : 'Run created renewal work' };
};

H['user.role'] = (p) => {
  if (!can('user.role')) return null;
  const u = byId('users', p.userId); const from = u.role; u.role = p.role;
  audit('Role changed — ' + u.name + ': ' + ROLES[from] + ' → ' + ROLES[p.role], { entity: u.id, kind: 'permission' });
  return { text: u.name + ' is now ' + ROLES[p.role] };
};

H['connection.set'] = (p) => {
  const c = byId('connections', p.id);
  c.status = p.status; c.lastSync = p.status === 'connected' ? nowIso() : c.lastSync;
  c.error = p.error || null;
  audit('Connection ' + c.kind + ' → ' + p.status + (p.error ? ' (' + p.error + ')' : ''), { kind: 'system' });
  return { text: c.kind + ' is ' + p.status };
};

H['conversation.save'] = (p) => {
  const d = getDb();
  let c = byId('conversations', p.id);
  if (!c) c = put('conversations', { id: p.id || uid('cnv'), startedAt: nowIso(), messages: [], contextId: p.contextId || null });
  c.messages = p.messages; c.contextId = p.contextId || c.contextId; c.updatedAt = nowIso();
  return { conversationId: c.id };
};

H['draft.save'] = (p) => {
  let d = byId('drafts', p.id);
  if (!d) d = put('drafts', { id: p.id || uid('drf'), createdAt: nowIso() });
  Object.assign(d, { subject: p.subject, body: p.body, recipients: p.recipients, clientId: p.clientId,
    workItemId: p.workItemId, attachments: p.attachments || [], updatedAt: nowIso(), signature: p.signature || '' });
  return { draftId: d.id };
};

const ACTION_LABELS = {
  'records.import': 'confirm a records import', 'email.send': 'send external messages',
  'quote.choice': 'record the insurer choice', 'placement.approve': 'approve a placement',
  'policy.issue': 'create a policy', 'cover.change': 'change cover or the schedule',
  'payment.match': 'change money records', 'reconcile.resolve': 'resolve or dispute money lines',
  'claim.register': 'register a claim', 'work.assign': 'assign work', 'user.role': 'change a role',
  'automation.save': 'change automations', 'automation.toggle': 'switch automations on or off'
};

export const PERMISSION_OF = {
  'records.import': 'records.import', 'email.send': 'email.send', 'quote.choice': 'quote.choice',
  'placement.approve': 'placement.approve', 'policy.issue': 'policy.issue', 'cover.change': 'cover.change',
  'payment.match': 'money.change', 'reconcile.resolve': 'money.change', 'claim.register': 'claim.manage',
  'work.assign': 'work.assign', 'user.role': 'user.role', 'automation.save': 'automation.manage',
  'automation.toggle': 'automation.manage'
};

/**
 * Single mutation entry point.
 * @param type      action name
 * @param payload   action data
 * @param actionId  STABLE id — repeated calls with the same id never write twice
 */
export function dispatch(type, payload = {}, actionId) {
  if (backend) return backend.dispatch(type, payload, actionId);
  const d = getDb();
  const key = actionId || (type + ':' + JSON.stringify(payload));
  if (d.meta.ledger[key]) return { ...d.meta.ledger[key], duplicate: true };
  const handler = H[type];
  if (!handler) return { ok: false, error: 'Unsupported action: ' + type };
  const perm = PERMISSION_OF[type];
  if (perm && !can(perm)) {
    const ap = approverFor(perm);
    const res = { ok: false, denied: true,
      reason: ROLES[actor().role] + ' cannot ' + (ACTION_LABELS[type] || type) + ' in this brokerage.',
      path: ap ? 'Send it to ' + ap.name + ' (' + ROLES[ap.role] + ') for approval.' : 'No authorised approver exists.' ,
      approverId: ap?.id || null };
    audit('Blocked — ' + actor().name + ' attempted ' + type + ' without permission', { kind: 'permission' });
    saveRaw(d);
    return res;
  }
  let out;
  try { out = handler(payload); } catch (e) { console.error(e); return { ok: false, error: e.message }; }
  if (out && out.error) { saveRaw(d); return { ok: false, error: out.error }; }
  const result = { ok: true, ...out, actionId: key, at: nowIso() };
  d.meta.ledger[key] = result;
  saveRaw(d);
  return result;
}

// ---------------------------------------------------------------- selectors
export const sel = {
  users: () => all('users'),
  user: (id) => byId('users', id),
  clients: () => all('clients'),
  client: (id) => byId('clients', id),
  clientByName: (t) => {
    const q = (t || '').toLowerCase();
    // Edited: whole word of three or more letters, as in findClient.
    return all('clients').find(c => { const w = c.name.split(' ')[0].toLowerCase(); return w.length >= 3 && new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(q); }) || null;
  },
  contacts: (clientId) => where('contacts', c => c.clientId === clientId),
  policies: (clientId) => where('policies', p => p.clientId === clientId),
  policyYears: (clientId) => where('policyYears', y => y.clientId === clientId),
  activeYear: (clientId) => where('policyYears', y => y.clientId === clientId && y.status === 'active')[0] || null,
  items: (yearId, version) => where('policyItems', i => i.policyYearId === yearId &&
    (version === undefined ? i.status === 'on cover' : i.scheduleVersion <= version && (i.status === 'on cover' || i.removedInVersion > version))),
  itemByReg: (reg) => where('policyItems', i => i.reg.replace(/\s/g, '').toUpperCase() === reg.replace(/\s/g, '').toUpperCase() && i.status === 'on cover')[0] || null,
  work: (f = {}) => where('workItems', w => (!f.clientId || w.clientId === f.clientId) &&
    (!f.assigneeId || w.assigneeId === f.assigneeId) && (!f.kind || w.kind === f.kind) &&
    (!f.state || (f.state === 'Waiting' ? /^With /.test(w.state) || w.state === 'Waiting' : w.state === f.state))),
  openWork: () => where('workItems', w => w.state !== 'Completed'),
  invoices: (clientId) => where('invoices', i => i.clientId === clientId),
  // Unknown over live records: invoices are not connected there, and unknown is not zero.
  balance: (clientId) => backend ? null : where('invoices', i => i.clientId === clientId).reduce((a, i) => a + (i.amount - i.paid), 0),
  payments: (clientId) => where('payments', p => p.clientId === clientId),
  claims: (clientId) => where('claims', c => !clientId || c.clientId === clientId),
  documents: (clientId) => where('documents', d => !clientId || d.clientId === clientId),
  docVersions: (documentId) => where('documentVersions', v => v.documentId === documentId).sort((a, b) => b.version - a.version),
  emails: (clientId) => where('emails', e => !clientId || e.clientId === clientId).sort((a, b) => (a.at < b.at ? 1 : -1)),
  audit: (clientId) => where('auditEvents', a => !clientId || a.clientId === clientId).sort((a, b) => (a.at < b.at ? 1 : -1)),
  evidence: (id) => byId('evidence', id),
  quotes: (clientId) => where('quotes', q => q.clientId === clientId),
  quoteVersions: (quoteId) => where('quoteVersions', v => v.quoteId === quoteId),
  placements: (clientId) => where('placements', p => p.clientId === clientId),
  reconciliation: (insurer) => where('reconciliationLines', l => !insurer || l.insurer === insurer),
  commissions: () => all('commissions'),
  automations: () => all('automations'),
  runs: (autoId) => where('automationRuns', r => !autoId || r.automationId === autoId).sort((a, b) => (a.at < b.at ? 1 : -1)),
  connections: () => all('connections'),
  approvals: (f = {}) => where('approvals', a => (!f.placementId || a.placementId === f.placementId) && (!f.workItemId || a.workItemId === f.workItemId)),
  conversation: (id) => byId('conversations', id),
  draft: (id) => byId('drafts', id),
  search: (q) => {
    const t = (q || '').toLowerCase().trim();
    if (!t) return [];
    const out = [];
    const add = (kind, title, note, target) => out.push({ kind, title, note, target });
    all('clients').forEach(c => { if (c.name.toLowerCase().includes(t)) add('Client', c.name, 'Client record', { ws: 'client', clientId: c.id }); });
    all('policies').forEach(p => { if ((p.number + ' ' + p.title).toLowerCase().includes(t)) { const y = where('policyYears', x => x.policyId === p.id).sort((a, b) => (a.from < b.from ? 1 : -1))[0]; add('Policy', p.number + ' · ' + p.title, byId('clients', p.clientId)?.name || 'Client', y ? { ws: 'policy', clientId: p.clientId, policyYearId: y.id } : { ws: 'client', clientId: p.clientId }); } });
    all('policyItems').forEach(i => { if (i.reg.toLowerCase().includes(t) || i.make.toLowerCase().includes(t)) add('Vehicle', i.reg + ' · ' + i.make, byId('clients', i.clientId).name, { ws: 'coverage', reg: i.reg }); });
    all('claims').forEach(c => { if (((c.ref || '') + ' ' + c.title + ' ' + (c.reg || '')).toLowerCase().includes(t)) add('Claim', c.title, c.ref || 'No insurer reference yet', { ws: 'claim', claimId: c.id }); });
    all('documents').forEach(d => {
      const v = where('documentVersions', x => x.documentId === d.id);
      const hit = d.name.toLowerCase().includes(t) || v.some(x => (x.lines || []).join(' ').toLowerCase().includes(t));
      if (hit) add('Document', d.name, 'v' + d.currentVersion + (d.clientId ? ' · ' + byId('clients', d.clientId).name : ''), { ws: 'document', documentId: d.id });
    });
    all('emails').forEach(e => { if ((e.subject + ' ' + e.body).toLowerCase().includes(t)) add('Email', e.subject, (e.direction === 'out' ? 'Sent to ' : 'From ') + (e.party || e.from), { ws: 'communication', emailId: e.id }); });
    all('workItems').forEach(w => { if (w.title.toLowerCase().includes(t)) add('Work', w.title, w.kind + ' · ' + w.state, { ws: 'work' }); });
    return out.slice(0, 40);
  }
};
