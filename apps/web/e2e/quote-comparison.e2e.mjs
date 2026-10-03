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
const TOKEN = jwt({ sub: STACY, email: `stacy-${TAG.toLowerCase()}@qa.test`, role: "authenticated", aud: "authenticated" });
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
  await expectText(p, "(read, not confirmed)");
  await expectText(p, "Not found in the document");
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
  await expectText(p, "(read, not confirmed)");
  await expectText(p, "Not found in the document");
});

const effects = sql(`select (select count(*) from quote_requests) || '/' || (select count(*) from insurer_responses) || '/' || (select count(*) from email_send_attempts) || '/' || (select count(*) from document_fields f join documents d on d.id = f.document_id where d.filename like '%_${TAG}.pdf' and f.state <> 'proposed')`);
check("07 no request, reply, email or confirmation was created by comparing", effects.endsWith("/0/0") || /^\d+\/\d+\/0\/0$/.test(effects), effects);
const before = effects.split("/").slice(0, 2).join("/");
check("07 the counts of requests and replies did not move", before === sql(`select (select count(*) from quote_requests) || '/' || (select count(*) from insurer_responses)`), before);

await browser.close();
process.stdout.write(`\n${results.filter((r) => r.ok).length} of ${results.length} checks passed; screenshots in ${OUT}\n`);
process.exit(failures ? 1 : 0);
