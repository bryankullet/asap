/**
 * The first-document onboarding journey, end to end (2 Oct hosted QA defects):
 *
 *   E2E_REAL_DOCUMENTS=1 E2E_SCRIPT=apps/web/e2e/first-document.e2e.mjs DATABASE_URL=… POSTGREST_BIN=… \
 *     bash scripts/test-e2e.sh
 *
 * A brand-new person creates a brokerage, reaches the welcome, refreshes, uploads a clearly
 * fictional policy schedule, waits for the real extractor to read it, refreshes BEFORE confirming
 * (the precise failure seen on hosted), opens the review from all three entry points, checks the
 * values against the PDF, confirms them, creates the client and policy, confirms twice, refreshes,
 * and signs in again in a fresh browser — the same state each time. Real API, real extractor,
 * PostgREST and Postgres; the only stand-ins are the session token and local file storage.
 */
import { chromium } from "playwright";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const URL_ = process.env.E2E_URL;
const API = process.env.CONNECTED_API_URL;
const DB = process.env.CONNECTED_OWNER_URL;
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots/first-document";
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

/* ---------------------------------------------------------------- the fictional schedule */
const PDF = `/tmp/ASAP_QA_TEST_${TAG}.pdf`;
const V = { policy: `QA-MTR-${TAG}`, insured: `QA Fictional Traders ${TAG} Ltd`, insurer: "Jubilee", cls: "Commercial Motor", from: "2026-11-01", to: "2027-10-31", premium: "145,000.00" };
execFileSync("python3", ["-c", `
import pymupdf
doc = pymupdf.open(); page = doc.new_page()
lines = ["FICTIONAL TEST DOCUMENT - NOT A REAL POLICY", "MOTOR POLICY SCHEDULE",
  "Policy No: ${V.policy}", "Name of Insured: ${V.insured}", "Insurer: ${V.insurer}",
  "Class of Business: ${V.cls}", "Period From: ${V.from}", "Period To: ${V.to}", "Total Premium: KES ${V.premium}"]
for i, t in enumerate(lines): page.insert_text((60, 80 + i * 26), t, fontsize=12)
doc.save("${PDF}")
`]);

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
const lastPending = (page) => page.locator(".asap-pending").last();
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
const openFromSetup = async (page) => { await ask(page, "Show setup progress"); };
// The review is open only when the document's own review is in front — its title and what ASAP read —
// not merely when its name appears somewhere (Setup lists it too).
const reviewIsOpen = async (page) => {
  await expectText(pane(page), "What ASAP read");
  await expectText(pane(page).locator("h1, h2").first(), `ASAP_QA_TEST_${TAG}.pdf`);
  await refuseText(pane(page), "What matters now");
  await refuseText(pane(page), "Setting up your book");
};

/* 1 · create the brokerage (the onboarding screen's own call), and a retry creates nothing twice */
const requestKey = randomUUID();
const orgBody = { name: `ASAP QA Onboarding ${TAG}`, country: "KE", currency: "KES", timezone: "Africa/Nairobi", accepted_terms: true, request_key: requestKey };
const c1 = await api("POST", "/organizations", orgBody);
const c2 = await api("POST", "/organizations", orgBody);
check("01 create brokerage; a retry with the same request is the same brokerage", c1.status < 300 && c2.status < 300 && Number(sql(`select count(*) from organizations where name = 'ASAP QA Onboarding ${TAG}'`)) === 1, `${c1.status}/${c2.status}`);
check("01 one membership for Stacy", Number(sql(`select count(*) from organization_memberships where user_id = '${STACY}'`)) === 1);

const page = await open();
// D-155: a brokerage with nothing yet is welcomed on Home with the setup entry point.
await step(page, "02-welcome", async () => {
  await page.goto(process.env.E2E_URL.replace(/#.*$/, "") + "#/"); await settle(page, 1500);
  await expectText(page.locator("body"), "Add the records you already have. ASAP will organize your clients, policies and current work.");
  await expectText(page.locator("body"), "Upload documents");
  await page.goBack(); await settle(page, 1200);
});
await step(page, "03-refresh-setup-still-there", async () => {
  await reload(page);
  await openFromSetup(page);
  await expectText(pane(page), "Setting up your book");
  await expectText(pane(page), "○ Documents or records added");
});

/* 3–4 · upload; real states; never "read" or "reviewed" early */
await step(page, "04-upload-waiting-not-confirmed", async () => {
  await page.locator(".asap-attach-input").setInputFiles(PDF);
  await settle(page, 1500);
  await expectText(lastPending(page), `ASAP_QA_TEST_${TAG}.pdf`);
  await openFromSetup(page);
  const t = await pane(page).innerText();
  if (/✓ Everything read and reviewed/.test(t)) throw new Error("setup claims everything reviewed while the file is not yet read");
  if (/✓ Client and policy records created/.test(t)) throw new Error("setup claims records created before any exist");
});
let extracted = false;
for (let i = 0; i < 40 && !extracted; i++) {
  extracted = sql(`select extraction_state from documents where filename = 'ASAP_QA_TEST_${TAG}.pdf'`) === "extracted";
  if (!extracted) await page.waitForTimeout(1500);
}
check("05 the extractor read the file", extracted, sql(`select extraction_state || coalesce(' · ' || extraction_error, '') from documents where filename = 'ASAP_QA_TEST_${TAG}.pdf'`));
const docId = sql(`select id from documents where filename = 'ASAP_QA_TEST_${TAG}.pdf'`);
const proposed = Number(sql(`select count(*) from document_fields where document_id = '${docId}' and state = 'proposed'`));
check("05 values wait for confirmation", proposed >= 5, `${proposed} proposed`);

/* the precise hosted failure: refresh BEFORE confirming */
await step(page, "06-refresh-before-confirming-keeps-document", async () => {
  await reload(page);
  await openFromSetup(page);
  await expectText(pane(page), `ASAP_QA_TEST_${TAG}.pdf`);
  await expectText(pane(page), /values? needs? confirmation/);
  await expectText(pane(page), "Documents");
  // D-155: documents still waiting are named on Home, with one action.
  await page.goto(process.env.E2E_URL.replace(/#.*$/, "") + "#/"); await settle(page, 1500);
  await expectText(page.locator("body"), /waiting for review/);
});

/* 5 · each review entry point opens that exact document */
await step(page, "07-chat-card-review-values", async () => {
  await page.locator(".sh-row", { hasText: /waiting for review/ }).getByRole("button", { name: "Review" }).click();
  await settle(page, 2000);
  await reviewIsOpen(page);
  // Back to the conversation the journey continues in.
  await page.goBack(); await settle(page, 800); await page.goBack(); await settle(page, 1500);
});
await step(page, "08-setup-confirm-what-asap-read", async () => {
  await openFromSetup(page);
  await pane(page).getByRole("button", { name: /Confirm what ASAP read/ }).first().click();
  await settle(page, 2000);
  await reviewIsOpen(page);
});
await step(page, "09-file-row-open", async () => {
  await openFromSetup(page);
  await pane(page).getByRole("button", { name: /^Open/ }).first().click();
  await settle(page, 2000);
  await reviewIsOpen(page);
});
await step(page, "10-values-match-the-pdf", async () => {
  for (const v of [V.policy, V.insured, V.from, V.to]) await expectText(pane(page), v);
});

/* 7 · confirm the values, then create the client and policy through the intended flow */
await step(page, "11-confirm-values", async () => {
  await pane(page).getByRole("button", { name: "Confirm these values" }).click();
  await settle(page, 2500);
  const left = Number(sql(`select count(*) from document_fields where document_id = '${docId}' and state = 'proposed'`));
  if (left !== 0) throw new Error(`${left} values still proposed`);
  await expectText(pane(page), "Create the client and policy from this document");
});
await step(page, "12-create-client-and-policy", async () => {
  // A broker says what the premium is; the schedule does not.
  await pane(page).locator("select").filter({ hasText: "The gross premium" }).selectOption("gross");
  await pane(page).getByRole("button", { name: "Create client and policy" }).click();
  await settle(page, 3000);
  await expectText(page.locator("body"), /Created .*the policy/);
});
const clients = Number(sql(`select count(*) from clients c join organizations o on o.id = c.organization_id where o.name = 'ASAP QA Onboarding ${TAG}' and c.name = '${V.insured}'`));
const policies = Number(sql(`select count(*) from policies where policy_number = '${V.policy}'`));
const periods = Number(sql(`select count(*) from policy_periods p join policies x on x.id = p.policy_id where x.policy_number = '${V.policy}' and p.period_start = '${V.from}' and p.period_end = '${V.to}'`));
const filed = sql(`select client_id is not null from documents where id = '${docId}'`) === "t";
const linked = Number(sql(`select count(*) from document_applications where document_id = '${docId}'`).replace(/\D/g, "") || "0");
check("12 one client, one policy, the right period", clients === 1 && policies === 1 && periods === 1, `${clients}/${policies}/${periods}`);
check("12 the document is filed under the client", filed);
check("12 confirmed values are linked to the document as evidence", linked >= 3, `${linked} applications`);
const prem = sql(`select coalesce(premium_amount::text,'-') || '|' || coalesce(premium_basis,'-') || '|' || coalesce(premium_source,'-') || '|' || (premium_evidence_document_id = '${docId}')::text from policy_periods p join policies x on x.id = p.policy_id where x.policy_number = '${V.policy}'`);
check("12 the premium is recorded from the document, gross, with it as evidence", prem === "145000.00|gross|document|true", prem);

/* 10 · confirming twice creates nothing twice */
await step(page, "13-confirm-twice-nothing-twice", async () => {
  // D-155: the document review has its own address; a reload reopens it.
  await page.goto(process.env.E2E_URL.replace(/#.*$/, "") + `#/ask?space=${encodeURIComponent("document?documentId=" + docId)}`);
  await reload(page);
  const again = await api("POST", "/policies", { clientName: V.insured, insurerName: V.insurer, classOfBusiness: V.cls, policyNumber: V.policy, periodStart: V.from, periodEnd: V.to });
  if (again.body.outcome === "recorded" && again.body.created) throw new Error("a second policy was created");
  if (Number(sql(`select count(*) from policies where policy_number = '${V.policy}'`)) !== 1) throw new Error("duplicate policy");
  if (Number(sql(`select count(*) from clients where name = '${V.insured}'`)) !== 1) throw new Error("duplicate client");
});

/* 8 · refresh: document, review state, records and setup progress */
await step(page, "14-refresh-after-confirming", async () => {
  await reload(page);
  await openFromSetup(page);
  await expectText(pane(page), "✓ Everything read and reviewed");
  await expectText(pane(page), "✓ Client and policy records created");
  await expectText(pane(page), `ASAP_QA_TEST_${TAG}.pdf`);
});

/* 9 · sign out and back in: a fresh browser, the same person */
const again = await open();
await step(again, "15-sign-in-again-same-state", async () => {
  await openFromSetup(again);
  await expectText(pane(again), "Your book is in");
  await ask(again, "What clients do I have?");
  await expectText(again.locator("body"), "You have 1 client.");
});

/* phone */
const phone = await open({ width: 390, height: 844 });
await step(phone, "16-phone-setup", async () => {
  await openFromSetup(phone);
  const b = phone.getByRole("button", { name: /Open Space/ });
  if (await b.count()) await b.first().click();
  await settle(phone, 800);
  await expectText(phone.locator("body"), "Your book is in");
});

check("no email send attempts", Number(sql("select count(*) from email_send_attempts")) === 0);
writeFileSync(`${OUT}/values.json`, JSON.stringify({ docId, V }, null, 2));
await browser.close();
process.stdout.write(`\n${results.filter((r) => r.ok).length} of ${results.length} checks passed; screenshots in ${OUT}\n`);
process.exit(failures ? 1 : 0);
