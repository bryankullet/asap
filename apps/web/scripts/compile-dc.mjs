#!/usr/bin/env node
/**
 * Compiles the approved ASAP interface (a Design Component: `<x-dc>` markup + a logic class) into
 * ordinary modules at build time, so the shipped app renders the approved screens exactly while
 * evaluating nothing at runtime — no in-browser Babel, no `new Function`.
 *
 *   node apps/web/scripts/compile-dc.mjs <ASAP.dc.html>
 *
 * Writes apps/web/src/asap/generated/{template.gen.js,asap.css,logic.gen.js}. The generated files
 * are committed: the approved markup is the source, these are its faithful translation.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const src = process.argv[2];
if (!src) {
  console.error("usage: node apps/web/scripts/compile-dc.mjs <ASAP.dc.html>");
  process.exit(2);
}
const html = readFileSync(src, "utf8");
const outDir = resolve(dirname(new URL(import.meta.url).pathname), "../src/asap/generated");
mkdirSync(outDir, { recursive: true });

const open = html.indexOf("<x-dc>");
const close = html.lastIndexOf("</x-dc>");
let tpl = html.slice(open + "<x-dc>".length, close);

// ---- helmet: the stylesheet becomes a CSS file; the font links are replaced by local fonts.
const helmet = /<helmet>([\s\S]*?)<\/helmet>/.exec(tpl);
const css = helmet ? (/<style>([\s\S]*?)<\/style>/.exec(helmet[1])?.[1] ?? "") : "";
tpl = tpl.replace(/<helmet>[\s\S]*?<\/helmet>/, "");
// The account card names a fixed brokerage in the approved markup; it names the signed-in one.
const BROKERAGE = "{{ me.roleLabel }} · ASAP Brokers Ltd";
if (!tpl.includes(BROKERAGE)) throw new Error("approved markup changed; brokerage name patch no longer applies");
tpl = tpl.replace(BROKERAGE, "{{ me.roleLabel }} · {{ brokerageName }}");

// ---- logic: the component class, as a module.
const logicSrc = /<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
if (!logicSrc) throw new Error("no logic script found");

// ---- the only edits made to the approved logic, each exact and asserted. They connect it to the
// app's adapters (demo records or the brokerage's live records) and keep demo-only controls —
// role impersonation, reset — out of live mode.
const PATCHES = [
  // A Space's receipt is the same receipt Ask gives (D-122).
  ["const thread = [...this.state.thread, { role: 'ai', lead: receipt, text: 'Written to the records with an audit entry against your name.', receipt: receipt + ' · ' + this.A.records.actor().name, chips: [] }];",
   "const thread = [...this.state.thread, this.receiptMessage(res, receipt)];"],
  // Adapters are injected, not imported from a sibling file.
  ["const A = await import('./asap-adapters.js');", "const A = await this.props.loadAdapters();"],
  // Live writes go to the API and resolve asynchronously; the demo store resolves at once.
  ["setTimeout(() => {\n      const res = this.A.records.act(action, payload, actionId);",
   "setTimeout(async () => {\n      const res = await this.A.records.act(action, payload, actionId);"],
  // The first message's suggestions name records; each mode supplies its own.
  ["chips: ['What needs attention today?', 'Open Acme Manufacturing', 'Is KDN 482Q covered right now?']",
   "chips: A.greetingChips"],
  // "Sign in as" another user is a demo affordance only.
  ["...R.sel.users().filter(u => u.id !== R.actor().id)", "...(R.demo ? R.sel.users() : []).filter(u => u.id !== R.actor().id)"],
  // Reset exists only over demo records; each mode adds its own links (sign out, switch mode).
  ["{ title: 'Reset demo records', note: 'Asks for confirmation and states what it removes', go: () => this.openReset() }",
   "...(R.demo ? [{ title: 'Reset demo records', note: 'Asks for confirmation and states what it removes', go: () => this.openReset() }] : []),\n        ...(R.modeLinks || [])"],
  // The sweep opens every workspace against the demo's named records; demo only.
  ["{ title: 'Workspace sweep', note: 'Open every workspace from live records', go: () => this.openSweep() },",
   "...(R.demo ? [{ title: 'Workspace sweep', note: 'Open every workspace from live records', go: () => this.openSweep() }] : []),"],
  // "+ New" preselects the demo's client; over real records it uses the client in context.
  ["const acme = R.sel.clientByName('acme');\n      out.options",
   "const acme = R.demo ? R.sel.clientByName('acme') : (this.state.contextRef?.clientId ? R.sel.client(this.state.contextRef.clientId) : null);\n      out.options"],
  // Suggestions under the composer name demo records; each mode supplies its own.
  ["suggestions: [\n        { label: 'What needs attention today?' }, { label: 'Get Acme’s quote ready and approach APA, CIC and Jubilee' },\n        { label: 'Is KDN 482Q covered right now?' }, { label: 'What does Acme owe?' },\n        { label: 'Show me everything connected to Acme' }\n      ].slice(0, 4)",
   "suggestions: (this.A.suggestions || [\n        { label: 'What needs attention today?' }, { label: 'Get Acme’s quote ready and approach APA, CIC and Jubilee' },\n        { label: 'Is KDN 482Q covered right now?' }, { label: 'What does Acme owe?' },\n        { label: 'Show me everything connected to Acme' }\n      ]).slice(0, 4)"],
  // "Nothing opened" offers a demo client; over real records it offers Work.
  ["{ title: 'Open Acme Manufacturing', note: 'Client relationship view', badge: 'Ask', badgeTone: 'ok', action: { ref: { ws: 'client', clientId: R.sel.clientByName('acme')?.id } } },",
   "R.demo ? { title: 'Open Acme Manufacturing', note: 'Client relationship view', badge: 'Ask', badgeTone: 'ok', action: { ref: { ws: 'client', clientId: R.sel.clientByName('acme')?.id } } } : { title: 'Show my work', note: 'Everything open in your brokerage', badge: 'Ask', badgeTone: 'ok', action: { ref: { ws: 'work' } } },"],
  // A defect in the approved build: the search field binds `onSearchInput`, which is never defined,
  // so the field could not be typed into. The handler keeps the query in state, where the search
  // sheet already reads it.
  ["openRecent: () => this.openRecent(), toast: this.state.toast,",
   "openRecent: () => this.openRecent(), brokerageName: (this.A?.records.all('brokerages')[0] || {}).name || '', onSearchInput: (e) => this.setState({ search: e.target.value, sheet: this.state.sheet ? { ...this.state.sheet, query: e.target.value } : null }), toast: this.state.toast,"],
  // A workspace's identity is its record, not the words that opened it: Ask adds the question and
  // empty fields to the reference, which opened a second identical tab ("What needs attention
  // today?" beside the Today already open). Compare by the fields that name a record.
  ["    const key = JSON.stringify(ref);\n    const existing = this.state.tabs.find(t => JSON.stringify(t.ref) === key);",
   "    const ident = (r) => JSON.stringify(Object.keys(r).filter(k => !['query', 'date'].includes(k) && r[k] != null && r[k] !== '').sort().map(k => [k, r[k]]));\n    const key = JSON.stringify(ref);\n    const existing = this.state.tabs.find(t => ident(t.ref) === ident(ref));"],
  // Ask may answer from the server (live mode), so routing resolves asynchronously.
  ["    setTimeout(() => {\n      const tab = this.activeTab();", "    setTimeout(async () => {\n      const tab = this.activeTab();"],
  ["const r = this.A.ai.route(text, ctx) || {};", "const r = (await this.A.ai.route(text, ctx)) || {};"],
  // Where the conversation is kept differs by mode; each mode says where.
  ["copy: 'The conversation is stored with your records, so it survives a refresh.' } });",
   "copy: this.A.historyNote || 'The conversation is stored with your records, so it survives a refresh.' } });"],
  // Over live records, "+ New" also starts a client — the first record everything else hangs on.
  ["        { icon: '⌘', title: 'Automation', note: 'Teach ASAP what to prepare', go: () => this.openRef({ ws: 'automation' }) }",
   "        { icon: '⌘', title: 'Automation', note: 'Teach ASAP what to prepare', go: () => this.openRef({ ws: 'automation' }) },\n        ...(R.demo ? [] : [{ icon: '◎', title: 'Client', note: 'Add a client by name', go: () => this.openRef({ ws: 'newclient' }) }])"],
  // Work filters may carry their own record filter (the D-075 views), which the engine resolves.
  ["                const ref = { ws: 'work', clientId: ws.ref.clientId,\n                  filter: f.label === 'Mine'",
   "                const ref = { ws: 'work', clientId: ws.ref.clientId,\n                  filter: f.filter ? f.filter : f.label === 'Mine'"],
  // A form block may declare its own fields and action; without them it is the automation builder.
  ["      if (o.isBuilder) {\n        const d = this.state.builder;",
   "      if (o.isBuilder && b.fields) {\n        const d = this.state.builder;\n        const ns = b.formId || 'form';\n        const opts = (x) => (x.options || []).map(v => (typeof v === 'string' ? { value: v, label: v } : v));\n        const val = (x) => (d[ns + ':' + x.key] ?? x.value ?? (x.options ? (opts(x)[0] || {}).value ?? '' : ''));\n        o.fields = b.fields.map(x => ({ label: x.label, placeholder: x.placeholder || '', type: x.type, value: val(x), isSelect: !!x.options, isInput: !x.options && !x.multiline, isTextarea: !!x.multiline, options: opts(x),\n          onChange: (e) => this.setState({ builder: { ...this.state.builder, [ns + ':' + x.key]: e.target.value } }) }));\n        o.saveLabel = b.saveLabel || 'Save'; o.saveNote = b.saveNote || '';\n        o.save = () => this.act(b.action, { ...(b.payload || {}), ...Object.fromEntries(b.fields.map(x => [x.key, String(val(x)).trim()])) });\n      } else if (o.isBuilder) {\n        const d = this.state.builder;\n        o.saveLabel = 'Save automation'; o.saveNote = 'Saved automations start paused. Test mode writes nothing.';"],
  // The automation builder's own fields render through the same select-or-input markup, so they say they are inputs.
  ["        const f = (key, label, placeholder) => ({ label, value: d[key] || '', placeholder,", "        const f = (key, label, placeholder) => ({ label, value: d[key] || '', placeholder, isInput: true, isSelect: false, type: 'text',"],
  // Recent names what was opened in words, the way its tab does — never the internal reference.
  ["      out.history = this.state.recent.map(r => ({ title: (r.ref.ws || '').replace(/^\\w/, c => c.toUpperCase()), note: JSON.stringify(r.ref).slice(0, 70), go: () => this.openRef(r.ref) }));",
   "      const named = (ref) => { let w = null; try { w = ref.ws === 'nothing' ? null : this.A.ai.workspace(ref); } catch { w = null; } return w && w.title ? w : null; };\n      out.history = this.state.recent.map(r => ({ r, w: named(r.ref) })).filter(x => x.w).map(({ r, w }) => ({ title: w.title, note: (w.kind || 'Opened') + ' · ' + new Date(r.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), go: () => this.openRef(r.ref) }));"],
  // A link to related work is not a step; only the work's own next step is called that.
  ["b.nav ? 'Next step' : 'A human must approve this'", "b.nav ? (b.heading || 'Related') : 'A human must approve this'"],
  // A file picked in one workspace belongs to that workspace: its progress never shows in another
  // workspace's uploader (a CSV chosen on Import is not a client document ready to file).
  ["    this.setState({ progress: prog });", "    this.setState({ progress: prog, progressFor: JSON.stringify((this.activeTab() || {}).ref || null) });"],
  ["o.hasProgress = this.state.progress.length > 0;", "o.hasProgress = this.state.progress.length > 0 && this.state.progressFor === JSON.stringify((this.activeTab() || {}).ref || null);"],
  // A row may open a stored source file (a short-lived signed link from the API) in a new tab.
  ["    if (a.a === 'unstage') {", "    if (a.a === 'link') { if (a.url) window.open(a.url, '_blank', 'noopener'); else this.flash('The file could not be opened just now. Refresh records and try again.'); return; }\n    if (a.a === 'copy') { const done = () => this.flash('Copied. Paste it where it should go \\u2014 ASAP has not sent it.'); try { navigator.clipboard.writeText(a.text || '').then(done, () => this.flash('Copying was blocked by the browser. Download it instead.')); } catch { this.flash('Copying was blocked by the browser. Download it instead.'); } return; }\n    if (a.a === 'download') { try { const url = URL.createObjectURL(new Blob([a.text || ''], { type: 'text/plain' })); const el = document.createElement('a'); el.href = url; el.download = a.filename || 'ASAP.txt'; document.body.appendChild(el); el.click(); el.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); this.flash('Downloaded. ASAP has not sent it.'); } catch { this.flash('The download could not start.'); } return; }\n    if (a.a === 'unstage') {"],
  // A reload reopens the workspace that was in front, not Today. Only the reference is kept, in
  // this tab's session; the records themselves are always read again.
  ["    if (!ref) return;\n    const ident = ", "    if (!ref) return;\n    try { sessionStorage.setItem('asap.openRef', JSON.stringify(ref)); } catch { /* storage blocked: a reload opens Today */ }\n    const ident = "],
  ["go: () => this.setState({ activeId: t.id, contextRef: t.ref }),", "go: () => { try { sessionStorage.setItem('asap.openRef', JSON.stringify(t.ref)); } catch { /* storage blocked */ } this.setState({ activeId: t.id, contextRef: t.ref }); },"],
  ["    const tabs = [{ id: 't1', ref: { ws: 'today' }, pinned: true }];\n    this.setState({ ready: true, tabs, activeId: 't1',", "    const tabs = [{ id: 't1', ref: { ws: 'today' }, pinned: true }];\n    let reopen = null;\n    try { reopen = JSON.parse(sessionStorage.getItem('asap.openRef') || 'null'); } catch { reopen = null; }\n    let back = null;\n    try { back = reopen && reopen.ws && reopen.ws !== 'today' && reopen.ws !== 'nothing' ? A.ai.workspace(reopen) : null; } catch { back = null; }\n    if (back) tabs.push({ id: 't2', ref: reopen, pinned: false });\n    this.setState({ ready: true, tabs, activeId: back ? 't2' : 't1', contextRef: back ? reopen : undefined,"],
  // Ask shows its newest turn: the thread stays pinned to the bottom as answers arrive, unless
  // the person has scrolled up to read something; sending a question pins it again.
  ["  saveThread(thread) {", "  componentDidUpdate(_p, prev) {\n    const el = typeof document !== 'undefined' ? document.querySelector('.asap-thread') : null;\n    if (!el) return;\n    if (!el.dataset.watched) { el.dataset.watched = '1'; el.addEventListener('scroll', () => { this._pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }); }\n    const grew = !prev || prev.thread !== this.state.thread || prev.thinking !== this.state.thinking;\n    if (grew && this._pinned !== false) el.scrollTop = el.scrollHeight;\n  }\n  saveThread(thread) {"],
  ["    const thread = [...this.state.thread, { role: 'user', text }];", "    this._pinned = true;\n    const thread = [...this.state.thread, { role: 'user', text }];"],
  // ---- Conversational shell (D-116): Ask in the centre, the Space on the right.
  // Ask's width is the conversation's; the Space takes the rest. The handle sits on Ask's right edge.
  ["      const w = Math.min(760, Math.max(300, window.innerWidth - ev.clientX));", "      const left = (document.querySelector('.asap-ask') || { getBoundingClientRect: () => ({ left: 0 }) }).getBoundingClientRect().left;\n      const w = Math.min(900, Math.max(360, ev.clientX - left));\n      try { localStorage.setItem('asap.askWidth', String(w)); } catch { /* interface preference only */ }"],
  ["  resetWidth = () => this.setState({ askWidth: 400 });", "  resetWidth = () => { try { localStorage.removeItem('asap.askWidth'); } catch { /* ignore */ } this.setState({ askWidth: 560 }); };"],
  ["    sideTouched: false, askWidth: 400, dragging: false", "    sideTouched: false, askWidth: (() => { try { const v = Number(localStorage.getItem('asap.askWidth')); return v >= 360 && v <= 900 ? v : 560; } catch { return 560; } })(), dragging: false, mobileView: 'ask'"],
  ["      bodyCols: this.state.askOpen ? 'minmax(0,1fr) ' + this.state.askWidth + 'px' : 'minmax(0,1fr)',", "      bodyCols: this.state.askOpen ? 'minmax(360px,' + this.state.askWidth + 'px) minmax(0,1fr)' : 'minmax(0,1fr)',\n      mobileView: this.state.mobileView, showSpace: () => this.setState({ mobileView: 'space' }), showAsk: () => this.setState({ mobileView: 'ask' }),"],
  // On a phone the Ask button switches between the conversation and the Space; it never collapses Ask.
  ["toggleAsk: () => this.setState({ askOpen: !this.state.askOpen }),", "toggleAsk: () => (window.innerWidth <= 980 ? this.setState({ askOpen: true, mobileView: this.state.mobileView === 'ask' ? 'space' : 'ask' }) : this.setState({ askOpen: !this.state.askOpen })),"],
  // On a phone, choosing Today, Work or Automations shows that Space.
  ["        go: () => this.openRef({ ws: w }),", "        go: () => { this.openRef({ ws: w }); if (window.innerWidth <= 980) this.setState({ mobileView: 'space' }); },"],
  // ---- Pending actions (D-118): a write proposed in Ask waits on the person; nothing runs until
  // Confirm, which calls the same handler a Space control calls.
  ["      if (r.clarify) msg.chips = r.clarify.options.map(o => ({ label: o.label, text: o.text }));", "      if (r.clarify) msg.chips = r.clarify.options.map(o => ({ label: o.label, text: o.text }));\n      if (r.pending) msg.pending = { ...r.pending, status: 'open' };"],
  ["      if (r.plan) this.act(r.plan.action, r.plan.payload, { actionId: r.plan.actionId });", "      if (r.plan && !r.pending) this.act(r.plan.action, r.plan.payload, { actionId: r.plan.actionId });"],
  ["  // ---------------- Ask\n", "  // ---------------- pending actions\n  // One receipt, from Ask or from a Space: action, record, actor, time, outcome, audit reference,\n  // what changed, what did not, and the next action (D-122).\n  receiptMessage = (res, lead) => {\n    const r = res.receipt || null;\n    const when = new Date();\n    const lines = r ? [r.changed && r.changed.length ? 'Changed: ' + r.changed.join('; ') + '.' : 'Nothing changed.', r.unchanged && r.unchanged.length ? 'Not changed: ' + r.unchanged.join('; ') + '.' : '', r.next ? 'Next: ' + r.next + '.' : ''].filter(Boolean).join(' ') : '';\n    const stamp = [r ? r.action : null, r ? r.record : null, this.A.records.actor().name, when.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), r ? r.outcome : (res.duplicate || res.already ? 'Already done' : 'Done'), r && r.audit ? 'Audit: ' + r.audit : null].filter(Boolean).join(' \\u00b7 ');\n    return { role: 'ai', lead, text: [res.detail || 'Written to your brokerage\\u2019s records with an audit entry against your name.', lines].filter(Boolean).join(' '), receipt: stamp, chips: res.next || [] };\n  };\n  updatePending = (i, patch) => {\n    const thread = this.state.thread.map((m, j) => (j === i && m.pending ? { ...m, pending: { ...m.pending, ...patch } } : m));\n    this.setState({ thread });\n    return thread;\n  };\n  confirmPending = async (i) => {\n    const m = this.state.thread[i];\n    if (!m || !m.pending || !['open', 'failed'].includes(m.pending.status)) return;\n    this.updatePending(i, { status: 'running', statusText: m.pending.progress || 'Saving to your brokerage\\u2019s records\\u2026' });\n    let res;\n    try { res = await this.A.records.act(m.pending.action, m.pending.payload, m.pending.actionId); }\n    catch (e) { res = { ok: false, error: 'That could not be saved just now. Nothing was changed \\u2014 you can retry.' }; }\n    if (res.denied) { this.updatePending(i, { status: 'blocked', statusText: res.reason || 'Your role cannot do this.' }); return; }\n    if (!res.ok) { this.updatePending(i, { status: 'failed', statusText: res.error || 'That failed. Nothing was changed \\u2014 you can retry.' }); return; }\n    const receipt = res.duplicate ? 'Already done \\u2014 nothing was recorded twice.' : (res.text || 'Recorded');\n    const thread = this.updatePending(i, { status: res.partial ? 'partial' : res.duplicate || res.already ? 'already' : 'done', statusText: res.partial ? 'Partly written \u2014 ' + (res.partial === true ? 'some of it could not be saved; the receipt says which.' : res.partial) : receipt });\n    const when = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });\n    const next = [...thread, this.receiptMessage(res, receipt)];\n    this.saveThread(next);\n    this.setState({ thread: next });\n    this.bump();\n    if (res.nav) this.openRef(res.nav);\n  };\n  cancelPending = (i) => this.updatePending(i, { status: 'cancelled', statusText: 'Cancelled \\u2014 nothing was written.' });\n  editPending = (i) => {\n    const m = this.state.thread[i];\n    if (!m || !m.pending) return;\n    // An edit replaces this preview: its matches and checks no longer describe what will be written.\n    this.updatePending(i, { status: 'replaced', statusText: 'Replaced by your edit \\u2014 nothing was written from this preview.' });\n    if (m.pending.editRef) this.openRef(m.pending.editRef);\n  };\n\n  // ---------------- Ask\n"],
  ["        hasChips: (m.chips || []).length > 0,\n        chips: (m.chips || []).map(c => ({ label: c.label || c, go: () => this.ask(c.text || c.label || c) })) })),", "        hasChips: (m.chips || []).length > 0,\n        chips: (m.chips || []).map(c => ({ label: c.label || c, go: () => (c.ref ? this.openRef(c.ref) : this.ask(c.text || c.label || c)) })),\n        hasPending: !!m.pending,\n        pending: m.pending ? { title: m.pending.title, sections: (m.pending.sections || []).filter(sc => (sc.items || []).length).map(sc => ({ label: sc.label, items: sc.items.map(t => ({ text: t })) })), external: m.pending.external || '', isOpen: m.pending.status === 'open' || m.pending.status === 'failed', showBody: !['done', 'already', 'cancelled', 'replaced'].includes(m.pending.status), confirmLabel: m.pending.status === 'failed' ? 'Retry' : (m.pending.confirmLabel || 'Confirm'), canEdit: !!m.pending.editRef, hasStatus: !!m.pending.statusText, statusText: m.pending.statusText || '', statusFg: ({ running: '#4c564e', done: '#1f6c49', already: '#1f6c49', partial: '#8a6a12', failed: '#a43b32', blocked: '#a43b32', cancelled: '#6e776f', replaced: '#6e776f' })[m.pending.status] || '#4c564e', confirm: () => this.confirmPending(i), cancel: () => this.cancelPending(i), edit: () => this.editPending(i) } : null })),"],
  // The context chip travels with every question as its own typed field (D-121).
  ["      const ctx = { ...(tab ? tab.ref : {}), selection: this.state.selection, lastPlan: this.state.lastPlan, ref: tab?.ref };", "      const ctx = { ...(tab ? tab.ref : {}), selection: this.state.selection, lastPlan: this.state.lastPlan, ref: tab?.ref, chip: this.state.contextRef || null };"],
  // An upload may name the action its file goes to (live import reads a book this way).
  // The picker is emptied once its files are read, so a file chosen in one workspace does not stay
  // selected in the next one that happens to reuse the same control.
  ["    const files = [...(ev.target.files || [])];", "    const files = [...(ev.target.files || [])];\n    try { ev.target.value = ''; } catch { /* some browsers refuse; the files are already copied */ }"],
  ["    if (block.stage) { this.setState", "    if (block.action) { if (out[0] && !out[0].error) this.act(block.action, { ...(block.payload || {}), name: out[0].name }); return; }\n    if (block.stage) { this.setState"],
  // A write may say where its result lives (the new client, the new quotation); open it there.
  ["      if (opts.nav) this.openRef(opts.nav);\n      else this.setState({ tick: this.state.tick + 1 });",
   "      if (opts.nav) this.openRef(opts.nav);\n      else if (res.nav) this.openRef(res.nav);\n      else this.setState({ tick: this.state.tick + 1 });"],
  // A declared form names itself (the automation builder is introduced by its workspace instead).
  ["hasLabel: !!b.label && b.t !== 'upload' && b.t !== 'gate' && b.t !== 'builder' };",
   "hasLabel: !!b.label && b.t !== 'upload' && b.t !== 'gate' && (b.t !== 'builder' || !!b.fields) };"],
  // An answer given without opening anything (the server's reply, a refusal) says nothing about a
  // workspace and leaves the current one in place: "Workspace opened beside this answer" was a
  // false receipt when nothing had opened.
  ["      if (r.nothing || !r.ref) msg.panelNote = 'Nothing opened for this request.';",
   "      if (r.keepWorkspace) msg.panelNote = '';\n      else if (r.nothing || !r.ref) msg.panelNote = 'Nothing opened for this request.';"],
  ["      if (r.nothing || !r.ref) {\n        this.openRef({ ws: 'nothing' });",
   "      if (r.keepWorkspace) {\n        /* the answer stands on its own; the open workspace stays */\n      } else if (r.nothing || !r.ref) {\n        this.openRef({ ws: 'nothing' });"],
  // A write through the server takes a few seconds; say so at once rather than looking inert.
  ["    const actionId = opts.actionId || (action + ':' + JSON.stringify(payload));\n    this.setState({ busy: true });",
   "    const actionId = opts.actionId || (action + ':' + JSON.stringify(payload));\n    this.setState({ busy: true });\n    if (this.A.savingNote && !/^(conversation|draft)\\./.test(action)) this.flash(this.A.savingNote);"],
  // ---- D-126: each record keeps its own tab; forms and failed steps are not Recent ----
  ["    const tabs = [...this.state.tabs.filter(t => t.pinned || t.id !== this.state.activeId || opts.keep), { id, ref, pinned: false }];\n    this.setState({ tabs, activeId: id, sheet: null, contextRef: ref,\n      recent: [{ ref, at: Date.now() }, ...this.state.recent.filter(r => JSON.stringify(r.ref) !== key)].slice(0, 12) });",
   "    // A record never replaces another record's tab; only a transient form or a 'nothing opened'\n    // tab in front is replaced. Recent holds records, once each, never forms or failed steps.\n    const transient = (r) => ['nothing', 'newclient', 'newcontact', 'import'].includes(r.ws) || (r.ws === 'claim' && !r.claimId);\n    let tabs = this.state.tabs.filter(t => !(t.id === this.state.activeId && !t.pinned && !opts.keep && transient(t.ref)));\n    tabs = [...tabs, { id, ref, pinned: false }];\n    while (tabs.filter(t => !t.pinned).length > 8) tabs.splice(tabs.findIndex(t => !t.pinned && t.id !== id), 1);\n    const recent = transient(ref) ? this.state.recent : [{ ref, at: Date.now() }, ...this.state.recent.filter(r => ident(r.ref) !== ident(ref))].slice(0, 12);\n    void key;\n    this.setState({ tabs, activeId: id, sheet: null, contextRef: ref, recent });"],
  ["    this.setState({ tabs: tabs.length ? tabs : [{ id: 't1', ref: { ws: 'today' }, pinned: true }],\n      activeId: (tabs[tabs.length - 1] || { id: 't1' }).id });",
   "    // Closing a tab removes the tab, never the record; context follows the tab now in front.\n    const nextTabs = tabs.length ? tabs : [{ id: 't1', ref: { ws: 'today' }, pinned: true }];\n    const front = id === this.state.activeId ? nextTabs[nextTabs.length - 1] : nextTabs.find(t => t.id === this.state.activeId) || nextTabs[nextTabs.length - 1];\n    try { sessionStorage.setItem('asap.openRef', JSON.stringify(front.ref)); } catch { /* storage blocked */ }\n    this.setState({ tabs: nextTabs, activeId: front.id, contextRef: front.ref });"],
  // ---- D-126: Ask fails safely; the message comes back to the composer ----
  ["      const r = (await this.A.ai.route(text, ctx)) || {};",
   "      let r;\n      try { r = (await this.A.ai.route(text, ctx)) || {}; }\n      catch (e) {\n        r = { lead: 'ASAP could not answer just now.', text: 'Nothing was changed. Your message is back in the box \\u2014 send it again, or try in a moment.', keepWorkspace: true, clarify: { options: [{ label: 'Try again', text }] }, failed: true };\n        if (this.inputRef.current && !this.inputRef.current.value) this.inputRef.current.value = text;\n      }"],
  // ---- D-126: never force-scroll a person reading history; say a new response is below ----
  ["    if (grew && this._pinned !== false) el.scrollTop = el.scrollHeight;\n  }",
   "    if (grew && this._pinned !== false) { el.scrollTop = el.scrollHeight; if (this.state.newBelow) this.setState({ newBelow: false }); }\n    else if (grew && prev && prev.thread !== this.state.thread && !this.state.newBelow) this.setState({ newBelow: true });\n  }\n  jumpToNew = () => { const el = document.querySelector('.asap-thread'); if (el) el.scrollTop = el.scrollHeight; this._pinned = true; this.setState({ newBelow: false }); };"],
  ["inputRef: this.inputRef, searchRef:", "inputRef: this.inputRef, newBelow: !!this.state.newBelow, jumpToNew: this.jumpToNew, searchRef:"],

];
const TEMPLATE_PATCHES = [
  // D-126: a new response arrived while the person was reading older history.
  ['            <div style="flex:none;padding:10px 16px 14px;border-top:1px solid #eef1ee">',
   '            <sc-if value="{{ newBelow }}" hint-placeholder-val="{{ false }}">\n              <div style="flex:none;display:flex;justify-content:center;padding:6px 0 0"><button onClick="{{ jumpToNew }}" aria-label="Jump to the new response" style="border:1px solid #cfe2d6;background:#e7f5ef;color:#1f6c49;border-radius:99px;padding:5px 12px;font-size:12.5px;font-weight:600">New response ↓</button></div>\n            </sc-if>\n            <div style="flex:none;padding:10px 16px 14px;border-top:1px solid #eef1ee">'],

  // The pending-action card, drawn inside an ASAP message.
  ["                        <sc-if value=\"{{ msg.hasChips }}\" hint-placeholder-val=\"{{ false }}\">", "                        <sc-if value=\"{{ msg.hasPending }}\" hint-placeholder-val=\"{{ false }}\">\n                          <div class=\"asap-pending\" role=\"group\" aria-label=\"{{ msg.pending.title }}\" style=\"margin-top:10px;border:1px solid #d7ded8;background:#fbfcfa;border-radius:13px;padding:12px 13px\">\n                            <strong style=\"display:block;font-size:14px\">{{ msg.pending.title }}</strong>\n                            <sc-if value=\"{{ msg.pending.showBody }}\" hint-placeholder-val=\"{{ true }}\">\n                            <sc-for list=\"{{ msg.pending.sections }}\" as=\"sec\" hint-placeholder-count=\"2\">\n                              <div style=\"margin-top:9px\">\n                                <small style=\"display:block;font-size:11px;letter-spacing:.08em;color:#6e776f\">{{ sec.label }}</small>\n                                <sc-for list=\"{{ sec.items }}\" as=\"it\" hint-placeholder-count=\"2\">\n                                  <div style=\"font-size:13px;line-height:1.5;color:#18231c\">\u00b7 {{ it.text }}</div>\n                                </sc-for>\n                              </div>\n                            </sc-for>\n                            <p style=\"margin:9px 0 0;font-size:12.5px;color:#4c564e\">{{ msg.pending.external }}</p>\n                            </sc-if>\n                            <sc-if value=\"{{ msg.pending.isOpen }}\" hint-placeholder-val=\"{{ true }}\">\n                              <div style=\"display:flex;gap:7px;flex-wrap:wrap;margin-top:11px\">\n                                <button onClick=\"{{ msg.pending.confirm }}\" style=\"border:0;background:#1f6c49;color:#fff;border-radius:10px;padding:8px 13px;font-weight:600\">{{ msg.pending.confirmLabel }}</button>\n                                <sc-if value=\"{{ msg.pending.canEdit }}\" hint-placeholder-val=\"{{ true }}\">\n                                  <button onClick=\"{{ msg.pending.edit }}\" style=\"border:1px solid #d7ded8;background:#fff;color:#18231c;border-radius:10px;padding:8px 13px;font-weight:600\">Edit details</button>\n                                </sc-if>\n                                <button onClick=\"{{ msg.pending.cancel }}\" style=\"border:1px solid #d7ded8;background:#fff;color:#4c564e;border-radius:10px;padding:8px 13px;font-weight:600\">Cancel</button>\n                              </div>\n                            </sc-if>\n                            <sc-if value=\"{{ msg.pending.hasStatus }}\" hint-placeholder-val=\"{{ false }}\">\n                              <p role=\"status\" style=\"margin:9px 0 0;font-size:13px;color:{{ msg.pending.statusFg }}\">{{ msg.pending.statusText }}</p>\n                            </sc-if>\n                          </div>\n                        </sc-if>\n                        <sc-if value=\"{{ msg.hasChips }}\" hint-placeholder-val=\"{{ false }}\">"],
  // Collapsing Ask is a desktop control; on a phone Ask and the Space take turns instead.
  ['<button onClick="{{ toggleAsk }}" style="border:1px solid #e5e9e5;background:#fff;border-radius:10px;padding:7px 10px;font-size:13px;font-weight:600;color:#4c564e" style-hover="border-color:#c4cfc6">{{ askToggleLabel }}</button>', '<button class="asap-desktoponly" onClick="{{ toggleAsk }}" style="border:1px solid #e5e9e5;background:#fff;border-radius:10px;padding:7px 10px;font-size:13px;font-weight:600;color:#4c564e" style-hover="border-color:#c4cfc6">{{ askToggleLabel }}</button>'],
  // Conversational shell: Ask first (centre), the Space after it (right); on a phone one at a time.
  ['<div class="asap-body" style="flex:1;min-height:0;display:grid;grid-template-columns:{{ bodyCols }};overflow:hidden">', '<div class="asap-body" data-view="{{ mobileView }}" style="flex:1;min-height:0;display:grid;grid-template-columns:{{ bodyCols }};overflow:hidden">'],
  ['<aside class="asap-ask" style="position:relative;min-height:0;display:flex;flex-direction:column;background:#fff;border-left:1px solid #e5e9e5">\n            <div onMouseDown="{{ startDrag }}" onDoubleClick="{{ resetWidth }}" title="Drag to resize · double-click to reset" style="position:absolute;top:0;bottom:0;left:-4px;', '<aside class="asap-ask" style="order:-1;position:relative;min-height:0;display:flex;flex-direction:column;background:#fff;border-right:1px solid #e5e9e5">\n            <button class="asap-mobileonly" onClick="{{ showSpace }}" style="flex:none;border:0;border-bottom:1px solid #eef1ee;background:#f2f7f3;color:#1f6c49;padding:10px 16px;text-align:left;font-weight:600">Open Space · {{ ws.title }} →</button>\n            <div onMouseDown="{{ startDrag }}" onDoubleClick="{{ resetWidth }}" title="Drag to resize · double-click to reset" style="position:absolute;top:0;bottom:0;right:-4px;'],
  ['<section class="asap-pane" style="min-height:0;overflow-y:auto;padding:20px 22px 40px;background:#fbfcfa">', '<section class="asap-pane" style="min-height:0;overflow-y:auto;padding:20px 22px 40px;background:#fbfcfa">\n          <button class="asap-mobileonly" onClick="{{ showAsk }}" style="border:1px solid #e5e9e5;background:#fff;color:#1f6c49;border-radius:10px;padding:8px 12px;margin-bottom:12px;font-weight:600">← Back to the conversation</button>'],
  // The Ask thread's scroller, named so the logic can keep the newest turn in view.
  ['<div style="flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:15px">\n              <sc-for list="{{ thread }}"', '<div class="asap-thread" style="flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:15px">\n              <sc-for list="{{ thread }}"'],
  // The form block's button and note come from the block, so one form serves every live form.
  ['>Save automation</button>', '>{{ b.saveLabel }}</button>'],
  ['>Saved automations start paused. Test mode writes nothing.</small>', '>{{ b.saveNote }}</small>'],
  // A form field is a text/date input, or a dropdown when its vocabulary is closed (a client is a
  // company or a person — never whatever was typed).
  ['<input value="{{ f.value }}" onChange="{{ f.onChange }}" placeholder="{{ f.placeholder }}" style="width:100%;border:1px solid #d7ded8;border-radius:10px;padding:9px 10px;font-size:13.5px" />',
   '<sc-if value="{{ f.isSelect }}"><select value="{{ f.value }}" onChange="{{ f.onChange }}" style="width:100%;border:1px solid #d7ded8;border-radius:10px;padding:9px 10px;font-size:13.5px;background:#fff"><sc-for list="{{ f.options }}" as="o"><option value="{{ o.value }}">{{ o.label }}</option></sc-for></select></sc-if><sc-if value="{{ f.isInput }}"><input type="{{ f.type }}" value="{{ f.value }}" onChange="{{ f.onChange }}" placeholder="{{ f.placeholder }}" style="width:100%;border:1px solid #d7ded8;border-radius:10px;padding:9px 10px;font-size:13.5px" /></sc-if><sc-if value="{{ f.isTextarea }}"><textarea value="{{ f.value }}" onChange="{{ f.onChange }}" placeholder="{{ f.placeholder }}" rows="9" style="width:100%;border:1px solid #d7ded8;border-radius:10px;padding:9px 10px;font-size:13.5px;line-height:1.5;resize:vertical"></textarea></sc-if>'],
];
for (const [from, to] of TEMPLATE_PATCHES) {
  if (!tpl.includes(from)) throw new Error("approved markup changed; patch no longer applies:\n" + from);
  tpl = tpl.replace(from, to);
}
let logic = logicSrc;
for (const [from, to] of PATCHES) {
  if (!logic.includes(from)) throw new Error("approved logic changed; patch no longer applies:\n" + from);
  logic = logic.replace(from, to);
}

// ---- typography (the Musters system). One pass over every literal style in the approved markup
// and its stylesheet; the approved file itself is untouched. Fonts come only from the variables
// in packages/ui/src/styles.css — no font is named here or in any generated style.
const SCALE = [11, 12, 13, 14, 15, 16, 18, 20, 28];
const toScale = (px) => SCALE.reduce((a, b) => (Math.abs(b - px) < Math.abs(a - px) ? b : a));
function retype(style) {
  const decls = style.split(";").map((d) => d.trim()).filter(Boolean);
  const get = (k) => decls.find((d) => d.startsWith(k + ":"))?.slice(k.length + 1).trim();
  const set = (k, v) => {
    const i = decls.findIndex((d) => d.startsWith(k + ":"));
    if (v === null) { if (i >= 0) decls.splice(i, 1); return; }
    if (i >= 0) decls[i] = k + ":" + v; else decls.push(k + ":" + v);
  };
  const fam = get("font-family");
  const sizeRaw = get("font-size");
  const size = sizeRaw && /^[\d.]+px$/.test(sizeRaw) ? parseFloat(sizeRaw) : null;
  const weightRaw = get("font-weight");
  const weight = weightRaw && /^\d+$/.test(weightRaw) ? Number(weightRaw) : null;
  const spacing = get("letter-spacing");
  // An icon glyph in a fixed box keeps its font and size, so icons do not shift or change shape.
  const iconBox = size !== null && size >= 16 && weight === null && !fam && /(^|;)\s*(width:\d+px|text-align:center)/.test(style) && /text-align:center|place-items:center/.test(style);
  if (fam && /serif/.test(fam) && !/sans/.test(fam)) return style; // the document page's serif stays
  const eyebrow = size !== null && size <= 12 && spacing && /^\.?\d*\.?\d+em$/.test(spacing) && parseFloat(spacing) >= 0.05;
  if (eyebrow) {
    set("font-family", "var(--font-body)"); set("font-weight", "400"); set("font-size", "12px"); set("letter-spacing", "0.04em");
    return decls.join(";");
  }
  const display = (fam && /Manrope/.test(fam)) || (weight !== null && weight >= 600);
  if (fam && /DM Sans/.test(fam)) set("font-family", "var(--font-body)");
  if (display) {
    set("font-family", "var(--font-display)");
    const px = size !== null ? toScale(size) : null;
    // 700 only for small numbers and badges; everything else in the UI is 600. No 800.
    set("font-weight", weight !== null && weight >= 700 && px !== null && px <= 12 ? "700" : "600");
    if (px !== null && px >= 20 && !spacing) set("letter-spacing", "-0.02em");
    if (px === 28) set("line-height", "1.15");
  }
  if (size !== null && !iconBox) set("font-size", toScale(size) + "px");
  if (weight === 800) set("font-weight", "600");
  return decls.join(";");
}
tpl = tpl.replace(/style="([^"]*)"/g, (m, st) => 'style="' + retype(st) + '"');
tpl = tpl.replace(/style-hover="([^"]*)"/g, (m, st) => 'style-hover="' + retype(st) + '"');
// The logo tile is a letter, not an icon: Outfit 700, 18px, as the mapping sets it.
const LOGO_TILE = "background:#18231c;color:#fff;display:grid;place-items:center;font-size:16.5px;flex:none";
if (!tpl.includes(LOGO_TILE)) throw new Error("typography: logo tile not found");
tpl = tpl.replace(LOGO_TILE, "background:#18231c;color:#fff;display:grid;place-items:center;font-family:var(--font-display);font-weight:700;font-size:18px;flex:none");
// Conversational shell (D-116): on a tablet or phone, Ask and the Space take the screen in turn —
// never stacked, never squeezed. The toggle is interface state only.
const SHELL_CSS = `
.asap-mobileonly{display:none}
@media(max-width:980px){
  .asap-mobileonly{display:block}
  .asap-desktoponly{display:none!important}
  .asap-body{overflow:hidden!important}
  .asap-body[data-view="ask"] .asap-pane{display:none!important}
  .asap-body[data-view="space"] .asap-ask{display:none!important}
  .asap-ask{min-height:0!important;border-right:0!important;border-top:0!important}
}`;
let typedCss = css
  .replace(/font-family:\s*"DM Sans"[^;}]*/g, "font-family:var(--font-body);font-variant-numeric:tabular-nums")
  .replace(/font-family:\s*Manrope[^;}]*/g, "font-family:var(--font-display)")
  .replace(/font-size:\s*([\d.]+)px/g, (m, n) => "font-size:" + toScale(parseFloat(n)) + "px")
  .replace(/font-weight:\s*800/g, "font-weight:600");
if (/Manrope|DM Sans/.test(tpl + typedCss)) throw new Error("typography: an old font name survived the retype");

// ---- a small, strict parser for the template dialect.
const VOID = new Set(["input", "link", "br", "img", "meta", "hr"]);
function parse(s) {
  let i = 0;
  const root = { tag: "#root", attrs: [], children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  while (i < s.length) {
    if (s.startsWith("<!--", i)) { i = s.indexOf("-->", i) + 3; continue; }
    if (s.startsWith("</", i)) {
      const end = s.indexOf(">", i);
      const name = s.slice(i + 2, end).trim();
      const node = stack.pop();
      if (node.tag !== name) throw new Error(`mismatched </${name}>, open <${node.tag}> near ${s.slice(i - 80, i)}`);
      i = end + 1;
      continue;
    }
    if (s[i] === "<") {
      const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(s.slice(i));
      const tag = m[1];
      i += m[0].length;
      const attrs = [];
      for (;;) {
        while (/\s/.test(s[i])) i++;
        if (s[i] === ">") { i++; break; }
        if (s.startsWith("/>", i)) { i += 2; attrs.selfClose = true; break; }
        const am = /^([a-zA-Z_:][a-zA-Z0-9_:.-]*)/.exec(s.slice(i));
        if (!am) throw new Error("bad attribute near " + s.slice(i, i + 40));
        i += am[0].length;
        let value = true;
        if (s[i] === "=") {
          const q = s[i + 1];
          const end = s.indexOf(q, i + 2);
          value = s.slice(i + 2, end);
          i = end + 1;
        }
        attrs.push([am[1], value]);
      }
      const node = { tag, attrs, children: [] };
      top().children.push(node);
      if (!attrs.selfClose && !VOID.has(tag)) stack.push(node);
      continue;
    }
    const next = s.indexOf("<", i);
    const text = s.slice(i, next === -1 ? s.length : next);
    i = next === -1 ? s.length : next;
    if (text.trim()) top().children.push({ text });
  }
  if (stack.length !== 1) throw new Error("unclosed <" + top().tag + ">");
  return root;
}

const decode = (t) => t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const J = JSON.stringify;

/** A string with {{ expr }} holes → JS expression over scope `v`. */
function interp(str, { raw = false } = {}) {
  const parts = [];
  let last = 0;
  for (const m of str.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
    if (m.index > last) parts.push(J(decode(str.slice(last, m.index))));
    parts.push(`r(v,${J(m[1])})`);
    last = m.index + m[0].length;
  }
  if (last < str.length) parts.push(J(decode(str.slice(last))));
  if (raw && parts.length === 1 && parts[0].startsWith("r(")) return parts[0];
  if (parts.length === 0) return '""';
  return parts.map((p) => (p.startsWith("r(") ? `s(${p})` : p)).join("+");
}

const hovers = [];
function hoverClass(style) {
  let idx = hovers.indexOf(style);
  if (idx === -1) { hovers.push(style); idx = hovers.length - 1; }
  return `dch${idx}`;
}

const BOOL = new Set(["disabled", "multiple"]);
const RENAME = { class: "className", "aria-label": "aria-label", "aria-modal": "aria-modal", rows: "rows" };

function gen(node, ind = "") {
  if (node.text !== undefined) {
    const t = node.text.replace(/\s+/g, " ");
    return interp(t, { raw: true });
  }
  const kids = () => node.children.map((c) => gen(c, ind + "  "));
  const attr = (n) => node.attrs.find(([k]) => k === n)?.[1];
  if (node.tag === "sc-if") {
    return `(r(v,${J(/\{\{\s*(.*?)\s*\}\}/.exec(attr("value"))[1])})?h(F,null,${kids().join(",")}):null)`;
  }
  if (node.tag === "sc-for") {
    const list = /\{\{\s*(.*?)\s*\}\}/.exec(attr("list"))[1];
    const as = attr("as");
    const body = node.children.map((c) => gen(c, ind + "  "));
    return `(r(v,${J(list)})||[]).map((it,ix)=>{const v2=sc(v,${J(as)},it);return h(F,{key:ix},...(((v)=>[${body.join(",")}])(v2)))})`;
  }
  const props = [];
  let styleExpr = null;
  let cls = [];
  for (const [k, val] of node.attrs) {
    if (k.startsWith("hint-")) continue;
    if (k === "style") { styleExpr = interp(val); continue; }
    if (k === "style-hover") { cls.push(J(hoverClass(val))); continue; }
    if (k === "class") { cls.push(interp(val)); continue; }
    const name = RENAME[k] ?? k;
    if (val === true) { props.push(`${J(name)}:true`); continue; }
    if (BOOL.has(k)) { props.push(`${J(name)}:!!(${interp(val, { raw: true })})`); continue; }
    props.push(`${J(name)}:${interp(val, { raw: true })}`);
  }
  if (styleExpr) props.push(`style:st(${styleExpr})`);
  if (cls.length) props.push(`className:[${cls.join(",")}].join(" ")`);
  const tag = node.tag === "#root" ? "F" : J(node.tag);
  const children = node.tag === "textarea" ? [] : kids();
  return `h(${tag},{${props.join(",")}}${children.length ? "," + children.join(",") : ""})`;
}

const tree = parse(tpl);
const body = gen(tree);

writeFileSync(
  join(outDir, "template.gen.js"),
  `// GENERATED by apps/web/scripts/compile-dc.mjs from the approved ASAP interface — do not edit.
import { Fragment as F, createElement as h } from "react";
import { resolvePath as r, str as s, cssToStyle as st, scope as sc } from "../dc-runtime.js";

export function renderTemplate(v) {
  return ${body};
}
`,
);

writeFileSync(
  join(outDir, "asap.css"),
  `/* GENERATED from the approved ASAP interface — do not edit. */\n${typedCss.trim()}\n${SHELL_CSS}\n\n/* hover rules (style-hover) */\n` +
    hovers.map((hv, i) => `.dch${i}:hover{${hv.split(";").filter(Boolean).map((d) => d.trim() + " !important").join(";")}}`).join("\n") +
    "\n",
);

writeFileSync(
  join(outDir, "logic.gen.js"),
  `// GENERATED by apps/web/scripts/compile-dc.mjs from the approved ASAP interface — do not edit.
/* eslint-disable */
import React from "react";
import { DCLogic } from "../dc-runtime.js";
${logic.trim()}

export default Component;
`,
);
writeFileSync(join(outDir, "logic.gen.d.ts"), "// GENERATED by apps/web/scripts/compile-dc.mjs — do not edit.\ndeclare const Component: unknown;\nexport default Component;\n");
writeFileSync(join(outDir, "template.gen.d.ts"), '// GENERATED by apps/web/scripts/compile-dc.mjs — do not edit.\nimport type { ReactElement } from "react";\nexport function renderTemplate(vals: Record<string, unknown>): ReactElement;\n');
console.log(`compiled: ${hovers.length} hover rules, template ${body.length} chars`);
