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
   "      if (o.isBuilder && b.fields) {\n        const d = this.state.builder;\n        const ns = b.formId || 'form';\n        const opts = (x) => (x.options || []).map(v => (typeof v === 'string' ? { value: v, label: v } : v));\n        const val = (x) => (d[ns + ':' + x.key] ?? x.value ?? (x.options ? (opts(x)[0] || {}).value ?? '' : ''));\n        o.fields = b.fields.map(x => ({ label: x.label, placeholder: x.placeholder || '', type: x.type, value: val(x), isSelect: !!x.options, isInput: !x.options, options: opts(x),\n          onChange: (e) => this.setState({ builder: { ...this.state.builder, [ns + ':' + x.key]: e.target.value } }) }));\n        o.saveLabel = b.saveLabel || 'Save'; o.saveNote = b.saveNote || '';\n        o.save = () => this.act(b.action, { ...(b.payload || {}), ...Object.fromEntries(b.fields.map(x => [x.key, String(val(x)).trim()])) });\n      } else if (o.isBuilder) {\n        const d = this.state.builder;\n        o.saveLabel = 'Save automation'; o.saveNote = 'Saved automations start paused. Test mode writes nothing.';"],
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
  ["    if (a.a === 'unstage') {", "    if (a.a === 'link') { if (a.url) window.open(a.url, '_blank', 'noopener'); else this.flash('The file could not be opened just now. Refresh records and try again.'); return; }\n    if (a.a === 'unstage') {"],
  // A reload reopens the workspace that was in front, not Today. Only the reference is kept, in
  // this tab's session; the records themselves are always read again.
  ["    if (!ref) return;\n    const ident = ", "    if (!ref) return;\n    try { sessionStorage.setItem('asap.openRef', JSON.stringify(ref)); } catch { /* storage blocked: a reload opens Today */ }\n    const ident = "],
  ["go: () => this.setState({ activeId: t.id, contextRef: t.ref }),", "go: () => { try { sessionStorage.setItem('asap.openRef', JSON.stringify(t.ref)); } catch { /* storage blocked */ } this.setState({ activeId: t.id, contextRef: t.ref }); },"],
  ["    const tabs = [{ id: 't1', ref: { ws: 'today' }, pinned: true }];\n    this.setState({ ready: true, tabs, activeId: 't1',", "    const tabs = [{ id: 't1', ref: { ws: 'today' }, pinned: true }];\n    let reopen = null;\n    try { reopen = JSON.parse(sessionStorage.getItem('asap.openRef') || 'null'); } catch { reopen = null; }\n    let back = null;\n    try { back = reopen && reopen.ws && reopen.ws !== 'today' && reopen.ws !== 'nothing' ? A.ai.workspace(reopen) : null; } catch { back = null; }\n    if (back) tabs.push({ id: 't2', ref: reopen, pinned: false });\n    this.setState({ ready: true, tabs, activeId: back ? 't2' : 't1', contextRef: back ? reopen : undefined,"],
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
];
const TEMPLATE_PATCHES = [
  // The form block's button and note come from the block, so one form serves every live form.
  ['>Save automation</button>', '>{{ b.saveLabel }}</button>'],
  ['>Saved automations start paused. Test mode writes nothing.</small>', '>{{ b.saveNote }}</small>'],
  // A form field is a text/date input, or a dropdown when its vocabulary is closed (a client is a
  // company or a person — never whatever was typed).
  ['<input value="{{ f.value }}" onChange="{{ f.onChange }}" placeholder="{{ f.placeholder }}" style="width:100%;border:1px solid #d7ded8;border-radius:10px;padding:9px 10px;font-size:13.5px" />',
   '<sc-if value="{{ f.isSelect }}"><select value="{{ f.value }}" onChange="{{ f.onChange }}" style="width:100%;border:1px solid #d7ded8;border-radius:10px;padding:9px 10px;font-size:13.5px;background:#fff"><sc-for list="{{ f.options }}" as="o"><option value="{{ o.value }}">{{ o.label }}</option></sc-for></select></sc-if><sc-if value="{{ f.isInput }}"><input type="{{ f.type }}" value="{{ f.value }}" onChange="{{ f.onChange }}" placeholder="{{ f.placeholder }}" style="width:100%;border:1px solid #d7ded8;border-radius:10px;padding:9px 10px;font-size:13.5px" /></sc-if>'],
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
  `/* GENERATED from the approved ASAP interface — do not edit. */\n${css.trim()}\n\n/* hover rules (style-hover) */\n` +
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
