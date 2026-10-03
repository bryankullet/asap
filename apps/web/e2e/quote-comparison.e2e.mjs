/**
 * Quote comparison from real documents (D-135), in a real browser with the real extractor:
 *   E2E_REAL_DOCUMENTS=1 E2E_SCRIPT=apps/web/e2e/quote-comparison.e2e.mjs DATABASE_URL=… POSTGREST_BIN=… bash scripts/test-e2e.sh
 * A fresh brokerage uploads three fictional quotation PDFs (one read only in part), waits for
 * extraction, asks for the comparison, checks the unconfirmed and missing states, opens a value at
 * its document, and reloads. Nothing is confirmed, chosen, requested or sent.
 */
import { chromium } from "playwright";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const URL_ = process.env.E2E_URL;
const API = process.env.CONNECTED_API_URL;
const DB = process.env.CONNECTED_OWNER_URL;
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots/quote-comparison";
mkdirSync(OUT, { recursive: true });
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const jwt = (c) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...c });
  return `${h}.${b}.${createHmac("sha256", process.env.CONNECTED_JWT_SECRET).update(`${h}.${b}`).digest("base64url")}`;
};
const sql = (q) => execFileSync("psql", [DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const TAG = Date.now().toString(36).slice(-6).toUpperCase();

/* ---------------------------------------------------------------- a brand-new person, no brokerage */
const STACY = randomUUID();
sql(`insert into auth.users (id, aud, role, email, raw_user_meta_data) values ('${STACY}', 'authenticated', 'authenticated', 'stacy-${TAG.toLowerCase()}@qa.test', '{"full_name":"Stacy"}')`);
let TOKEN = jwt({ sub: STACY, email: `stacy-${TAG.toLowerCase()}@qa.test`, role: "authenticated", aud: "authenticated" });
const api = async (method, path, body) => {
  const res = await fetch(API + path, { method, headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};


/* ---------------------------------------------------------------- three fictional quotations */
const QUOTES = [
  { name: `02_UX_TEST_Quotation_APA_${TAG}.pdf`, insurer: "UX TEST APA Insurance", lines: ["Total Premium: KES 245,000.00", "Quotation valid until: 2026-10-31", "Excess: Own damage 2.5% minimum KES 20,000", "Limit of liability: Third party property KES 3,000,000", "Exclusions: Unlicensed drivers"] },
  { name: `03_UX_TEST_Quotation_CIC_${TAG}.pdf`, insurer: "UX TEST CIC General", lines: ["Total Premium: KES 231,500.00", "Quotation valid until: 2026-10-20", "Excess: Own damage 5% minimum KES 25,000"] },
  // Read only in part: no premium, no validity, no excess — the comparison must say "not found".
  { name: `04_UX_TEST_Quotation_Jubilee_${TAG}.pdf`, insurer: "UX TEST Jubilee", lines: ["Cover: comprehensive, five commercial vehicles"] },
];
for (const q of QUOTES) {
  execFileSync("python3", ["-c", `
import pymupdf
doc = pymupdf.open(); page = doc.new_page()
lines = ["FICTIONAL TEST DOCUMENT - SIMULATED QUOTATION FOR SOFTWARE TESTING", "MOTOR INSURANCE QUOTATION",
  "Quotation No: UX-Q-${TAG}-${q.insurer.split(" ")[2]}", "Insurer: ${q.insurer}", "Name of Insured: UX TEST Karibu Logistics Ltd",
  "Class of Business: Commercial Motor", ${q.lines.map((l) => JSON.stringify(l)).join(", ")}]
for i, t in enumerate(lines): page.insert_text((60, 80 + i * 26), t, fontsize=12)
doc.save("/tmp/${q.name}")
`]);
}

const results = [];
let failures = 0;
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? "/opt/pw-browsers/chromium" });
async function open(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((t) => { window.__E2E_TOKEN = t; }, TOKEN);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|status of (404|409|422)/.test(m.text())) page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(URL_);
  await page.getByPlaceholder("Tell ASAP what you need").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  return page;
}
const settle = async (page, ms = 1200) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
const reload = async (page) => { await page.reload(); await page.getByPlaceholder("Tell ASAP what you need").waitFor({ timeout: 30000 }); await settle(page, 2000); };
const pane = (page) => page.locator(".asap-pane").first();
async function ask(page, text) { await page.getByPlaceholder("Tell ASAP what you need").fill(text); await page.getByRole("button", { name: "Send" }).click(); await settle(page, 1500); }
const expectText = async (where, re) => { const t = await where.innerText(); if (!(typeof re === "string" ? t.includes(re) : re.test(t))) throw new Error(`expected ${re} on screen`); };
const refuseText = async (where, re) => { const t = await where.innerText(); if (typeof re === "string" ? t.includes(re) : re.test(t)) throw new Error(`did not expect ${re} on screen`); };
async function step(page, name, fn) {
  const problems = [];
  try { await fn(); } catch (e) { problems.push(String(e.message ?? e).split("\n")[0]); }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => 0);
  if (overflow > 1) problems.push(`horizontal overflow ${overflow}px`);
  if (page.errors.length) problems.push(`console: ${page.errors.join(" | ").slice(0, 300)}`);
  page.errors = [];
  const file = `${OUT}/${page.viewportSize().width}-${name}.png`;
  await page.screenshot({ path: file }).catch(() => {});
  results.push({ name, ok: !problems.length });
  if (problems.length) failures += 1;
  process.stdout.write(`${problems.length ? "✗" : "✓"} ${name}${problems.length ? " — " + problems.join("; ") : ""}\n`);
}
const check = (name, ok, detail = "") => { results.push({ name, ok }); if (!ok) failures += 1; process.stdout.write(`${ok ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}\n`); };

/* the brokerage, created through the onboarding call */
const org = await api("POST", "/organizations", { name: `UX TEST Quote Comparison ${TAG}`, country: "KE", currency: "KES", timezone: "Africa/Nairobi", accepted_terms: true, request_key: randomUUID() });
check("01 a fresh test brokerage", org.status < 300, String(org.status));

const page = await open();
await step(page, "02-upload-three-quotations", async () => {
  await page.locator(".asap-attach-input").setInputFiles(QUOTES.map((q) => "/tmp/" + q.name));
  await settle(page, 2000);
  await expectText(page.locator("body"), /3 files received/);
});
const state = () => sql(`select string_agg(extraction_state, ',' order by filename) from documents where filename like '%_UX_TEST_Quotation_%_${TAG}.pdf'`);
let read = false;
for (let i = 0; i < 60 && !read; i++) {
  read = state() === "extracted,extracted,extracted";
  if (!read) await page.waitForTimeout(1500);
}
check("03 the extractor read all three", read, state());
const proposed = sql(`select count(*) from document_fields f join documents d on d.id = f.document_id where d.filename like '%_${TAG}.pdf' and f.state <> 'proposed'`);
check("03 nothing was confirmed on anyone's behalf", proposed === "0", proposed + " decided");

await step(page, "04-compare-opens-a-real-comparison", async () => {
  await reload(page);
  await ask(page, "Compare all three UX TEST quotations and show me what could hurt the client");
  await expectText(page.locator("body"), "Comparing 3 quotations as ASAP read them.");
  const p = pane(page);
  await expectText(p, "Comparing 3 quotations as read");
  await expectText(p, "No recommendation");
  await expectText(p, /No quotation can be recommended: material terms are missing/);
  await expectText(p, "UX TEST APA Insurance");
  await expectText(p, "(page 1 · read, not confirmed)");
  await expectText(p, "Not extracted — check the document");
  await refuseText(p, "Not found in the document");
  await expectText(p, "Not read by ASAP — check the document");
  await expectText(p, "What could hurt the client");
  await expectText(p, "Excludes: Unlicensed drivers");
  await refuseText(p, /Excess — Excess|Excludes: Exclusions/);
  await refuseText(p, "is not connected to your records yet");
  await refuseText(p, /we recommend|best quote/i);
});

await step(page, "05-a-value-opens-its-source-document", async () => {
  // The value's own row, and its Open control.
  const row = pane(page).locator("div").filter({ has: page.getByText(/^UX TEST APA Insurance · Premium$/) }).filter({ has: page.getByRole("button", { name: /^Open/ }) }).last();
  await row.getByRole("button", { name: /^Open/ }).click();
  await settle(page, 1500);
  await expectText(pane(page), "What ASAP read");
  await expectText(pane(page), QUOTES[0].name);
});

await step(page, "06-after-refresh-the-same-comparison", async () => {
  await reload(page);
  await ask(page, "Compare all three UX TEST quotations");
  const p = pane(page);
  await expectText(p, "Comparing 3 quotations as read");
  await expectText(p, "(page 1 · read, not confirmed)");
  await expectText(p, "Not extracted — check the document");
});

const effects = sql(`select (select count(*) from quote_requests) || '/' || (select count(*) from insurer_responses) || '/' || (select count(*) from email_send_attempts) || '/' || (select count(*) from document_fields f join documents d on d.id = f.document_id where d.filename like '%_${TAG}.pdf' and f.state <> 'proposed')`);
check("07 no request, reply, email or confirmation was created by comparing", effects.endsWith("/0/0") || /^\d+\/\d+\/0\/0$/.test(effects), effects);
const before = effects.split("/").slice(0, 2).join("/");
check("07 the counts of requests and replies did not move", before === sql(`select (select count(*) from quote_requests) || '/' || (select count(*) from insurer_responses)`), before);

/* ------------------------------------------------- D-136: the real quotation layouts, term by term */
// A second brokerage holding the three fictional quotations as they are laid out — APA with each
// label above its value, CIC as one combined paragraph, Jubilee as the two-column table — read by
// the real extractor. Every term must land in its own row, and the status warning must survive a
// refresh.
const LAYOUTS = [["APA", "stacked"], ["CIC", "block"], ["Jubilee", "table"]];
const KEN = randomUUID();
sql(`insert into auth.users (id, aud, role, email, raw_user_meta_data) values ('${KEN}', 'authenticated', 'authenticated', 'ken-${TAG.toLowerCase()}@qa.test', '{"full_name":"Ken"}')`);
TOKEN = jwt({ sub: KEN, email: `ken-${TAG.toLowerCase()}@qa.test`, role: "authenticated", aud: "authenticated" });
const org2 = await api("POST", "/organizations", { name: `UX TEST Quote Layouts ${TAG}`, country: "KE", currency: "KES", timezone: "Africa/Nairobi", accepted_terms: true, request_key: randomUUID() });
check("08 a second test brokerage", org2.status < 300, String(org2.status));
const files = LAYOUTS.map(([n, layout], i) => `/tmp/0${i + 2}_UX_TEST_Quotation_${n}_${layout}_${TAG}.pdf`);
execFileSync("python3", ["-c", `
import sys; sys.path.insert(0, "apps/extractor/tests")
from quotation_fixtures import build
for (name, layout), path in zip(${JSON.stringify(LAYOUTS)}, ${JSON.stringify(files)}):
    open(path, "wb").write(build(name, layout))
`]);
const page2 = await open();
await step(page2, "09-upload-the-three-layouts", async () => {
  await page2.locator(".asap-attach-input").setInputFiles(files);
  await settle(page2, 2000);
  await expectText(page2.locator("body"), /3 files received/);
});
const like2 = `'%_UX_TEST_Quotation_%_${TAG}.pdf'`;
const state2 = () => sql(`select string_agg(d.extraction_state, ',' order by d.filename) from documents d join organizations o on o.id = d.organization_id where o.name = 'UX TEST Quote Layouts ${TAG}' and d.filename like ${like2}`);
let read2 = false;
for (let i = 0; i < 60 && !read2; i++) {
  read2 = state2() === "extracted,extracted,extracted";
  if (!read2) await page2.waitForTimeout(1500);
}
check("10 the extractor read all three layouts", read2, state2());
const termsOf = sql(`select string_agg(split_part(d.filename, '_', 5) || ':' || t.term_type || ':' || t.label, ' | ' order by d.filename, t.ordinal) from document_term_proposals t join documents d on d.id = t.document_id join organizations o on o.id = d.organization_id where o.name = 'UX TEST Quote Layouts ${TAG}'`);
for (const n of ["APA", "CIC", "Jubilee"])
  check(`11 ${n}: each term read on its own`, ["excess:Excess", "other:Geographic scope", "exclusion:Key exclusions", "other:Outstanding information", "other:Quote validity", "other:Status"].every((t) => termsOf.includes(`${n}:${t}`)), termsOf);
const bled = sql(`select count(*) from document_term_proposals t join documents d on d.id = t.document_id join organizations o on o.id = d.organization_id where o.name = 'UX TEST Quote Layouts ${TAG}' and ((t.label <> 'Key exclusions' and t.proposed_value ~* 'wear and tear|goods carried') or (t.label <> 'Status' and t.proposed_value ~* 'no cover is in force') or t.proposed_value ~* 'use restriction|outstanding information|key exclusions')`);
check("11 no term carries a neighbour's words", bled === "0", bled + " bled");

const layoutChecks = async (p) => {
  await expectText(p, "Comparing 3 quotations as read");
  await expectText(p, "Status warnings in these quotations");
  await expectText(p, "Indicative terms only - not accepted, bound, or issued. No cover is in force.");
  await expectText(p, "Kenya and Uganda; other territories by written agreement. (page 1 · read, not confirmed)");
  await expectText(p, "Kenya, Uganda and Tanzania subject to trip declaration.");
  await expectText(p, "Requires final vehicle values");
  await expectText(p, "30 days from simulated issue date");
  await expectText(p, "Outstanding information");
  await expectText(p, "Not extracted — check the document"); // no limits in any of the three
  await refuseText(p, /agreement\. Wear and tear|Not found in the document|Not read by ASAP — check the document\s*\n?\s*Geographic/);
};
await step(page2, "12-compare-the-three-layouts", async () => {
  await reload(page2);
  await ask(page2, "Compare all three UX TEST quotations");
  await layoutChecks(pane(page2));
});
await step(page2, "13-warnings-survive-refresh", async () => {
  await reload(page2);
  await ask(page2, "Compare all three UX TEST quotations");
  await layoutChecks(pane(page2));
});
const decided2 = sql(`select count(*) from document_term_proposals t join documents d on d.id = t.document_id join organizations o on o.id = d.organization_id where o.name = 'UX TEST Quote Layouts ${TAG}' and t.state <> 'proposed'`);
check("14 nothing was confirmed on anyone's behalf", decided2 === "0", decided2);

await browser.close();
process.stdout.write(`\n${results.filter((r) => r.ok).length} of ${results.length} checks passed; screenshots in ${OUT}\n`);
process.exit(failures ? 1 : 0);
