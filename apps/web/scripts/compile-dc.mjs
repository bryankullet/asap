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
];
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
