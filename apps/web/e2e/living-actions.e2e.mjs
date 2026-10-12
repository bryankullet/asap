/**
 * The Living renewal workspace, acted on in place, in a real browser (D-157):
 *
 *   real interface → real API → supabase-js → PostgREST → disposable PostgreSQL
 *
 * A renewal is started through the real API. The broker approves its bundle from the composed
 * workspace — through the existing approval endpoint, frozen hash and all — without leaving it.
 * Then insurer answers arrive through the existing quotation workflow while the broker is half-way
 * through typing an escalation: the workspace reconciles in place, marks what changed, keeps the
 * unsent text, and shows a revised premium beside the earlier one. Nothing is sent to anyone.
 */
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.E2E_URL.replace(/#.*$/, "");
const API = process.env.CONNECTED_API_URL;
const DB = process.env.CONNECTED_OWNER_URL;
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots/living-actions";
mkdirSync(OUT, { recursive: true });
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const jwt = (c) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...c });
  return `${h}.${b}.${createHmac("sha256", process.env.CONNECTED_JWT_SECRET).update(`${h}.${b}`).digest("base64url")}`;
};
const AMINA = jwt({ sub: "a0000000-0000-4000-8000-000000000001", email: "amina@connected.test", role: "authenticated", aud: "authenticated" });
const KAMAU = jwt({ sub: "a0000000-0000-4000-8000-000000000002", email: "kamau@connected.test", role: "authenticated", aud: "authenticated" });
const ORG_A = "10000000-0000-4000-8000-00000000000a";
const ACME = "70000000-0000-4000-8000-00000000000a";
const JUBILEE = "60000000-0000-4000-8000-00000000000a";
const TAG = Date.now().toString(36).slice(-5).toUpperCase();
const DAY = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);
const sql = (q) => execFileSync("psql", [DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const api = async (method, path, body, token = AMINA) => {
  const res = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

sql(`insert into client_contacts (organization_id, client_id, full_name, email, is_primary)
  select '${ORG_A}', '${ACME}', 'Wanjiru Kamau', 'wanjiru@acme.test', true
  where not exists (select 1 from client_contacts where client_id = '${ACME}' and email is not null and deleted_at is null)`);
const pol = sql(`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
  values ('${ORG_A}', '${ACME}', '${JUBILEE}', 'Commercial motor', 'LIVACT-${TAG}') returning id`).split("\n")[0];
const per = sql(`insert into policy_periods (organization_id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis)
  values ('${ORG_A}', '${pol}', '${iso(new Date(Date.now() - 330 * DAY))}', '${iso(new Date(Date.now() + 34 * DAY))}', 2400000, 'KES', 'gross') returning id`).split("\n")[0];
const run = (await api("POST", "/workflows/renewals", { policyPeriodId: per })).run;
const workItemId = run.workItemId;


import { createRequire } from "node:module";
const AXE_SRC = (await import("node:fs")).readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
/** Serious or critical accessibility violations on the Living surface (D-163). */
async function axeSerious(page) {
  await page.addScriptTag({ content: AXE_SRC });
  return page.evaluate(async () => (await window.axe.run(document.querySelector(".lv-root"), { resultTypes: ["violations"] })).violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")}`));
}

const results = [];
let failures = 0;
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? "/opt/pw-browsers/chromium" });
async function open(viewport, hash) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900 });
  await ctx.addInitScript((t) => { window.__E2E_TOKEN = t; }, AMINA);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|status of 404/.test(m.text())) page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push(String(e)));
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) page.errors.push(`${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, "")}`); });
  await page.goto(BASE + hash);
  await page.locator('.lv-root [data-component="ContextHeader"]').waitFor({ timeout: 30000 });
  return page;
}
const settle = async (page, ms = 600) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
async function step(page, name, fn) {
  const problems = [];
  try { await fn(); } catch (e) { problems.push(String(e.message ?? e).split("\n")[0]); }
  const overflow = await page.evaluate(() => { const r = document.querySelector(".lv-root"); const f = document.querySelector(".lv-scroll"); return r && f ? r.scrollWidth - f.clientWidth : 0; });
  if (overflow > 1) problems.push(`${overflow}px wider than the screen`);
  const text = await page.locator("body").innerText();
  const bad = text.match(/\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/);
  if (bad) problems.push(`placeholder “${bad[0]}”`);
  if (page.errors.length) problems.push(`console: ${page.errors.splice(0).join(" | ").slice(0, 300)}`);
  const vp = page.viewportSize();
  await page.screenshot({ path: `${OUT}/${vp.width}-${name}.png` });
  results.push({ step: `${vp.width} ${name}`, ok: !problems.length, problems });
  if (problems.length) failures++;
  process.stdout.write(`${problems.length ? "✗" : "✓"} ${vp.width} ${name}${problems.length ? " — " + problems.join("; ") : ""}\n`);
}
const focusRefresh = async (page) => { await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await settle(page, 1200); };

const page = await open({ width: 1440, height: 1000 }, `#/s/living?workItemId=${workItemId}`);
await step(page, "approval-in-place", async () => {
  const bundle = page.locator('[data-component="ApprovalBundle"]');
  await bundle.waitFor();
  must((await bundle.locator(".lv-approval-item").count()) >= 1, "the bundle shows no message");
  must((await bundle.locator(".lv-approval-body").first().innerText()).length > 20, "the message text is not shown in full");
  await bundle.getByRole("button", { name: "Approve and send" }).click();
  await bundle.getByText("Approve and send?").waitFor();
  await bundle.locator(".lv-command").getByRole("button", { name: "Approve and send" }).click();
  await page.locator(".lv-receipt").getByText("Approve and send — done").waitFor({ timeout: 15000 });
  await settle(page, 1500);
  must((await page.locator('[data-component="ApprovalBundle"]').count()) === 0, "the approved bundle is still waiting");
  must(sql(`select state from workflow_approvals where id = '${run.approval.id}'`) === "approved", "the approval was not recorded");
  must(new URL(page.url()).hash.startsWith("#/s/living"), "approving navigated away from the workspace");
});

const detail = await api("GET", `/workflows/runs/${run.id}`);
const out = detail.steps.find((s) => s.key === "open_terms").output;

// The broker delivered the approved request from their own mailbox and records it, in place.
await step(page, "record-delivery-in-place", async () => {
  const quotes = page.locator('[data-component="QuoteComparison"]');
  await quotes.getByRole("button", { name: /^Record delivery to / }).click();
  const form = quotes.locator(".lv-command");
  await form.locator("select").selectOption("own_email");
  await form.locator('input[type="text"]').fill(`Sent to Jubilee underwriting ${TAG}`);
  await form.getByRole("button", { name: /^Record delivery to / }).click();
  await page.locator(".lv-receipt").getByText(/Record delivery to .* — done/).waitFor({ timeout: 15000 });
  must(sql(`select count(*) from quote_request_deliveries where quote_request_id = '${out.quoteRequestId}' and reference like '%${TAG}%'`) === "1", "the delivery was not recorded on the quotation");
});
const opp = await api("GET", `/opportunities/${out.opportunityId}`);
const jubilee = opp.insurers.find((i) => i.insurerName.startsWith("Jubilee")) ?? opp.insurers[0];

await step(page, "run-controls-in-place", async () => {
  await focusRefresh(page);
  const ob = page.locator('[data-block="obligations"]');
  await ob.getByRole("button", { name: "Escalate" }).waitFor({ timeout: 10000 });
  await ob.getByRole("button", { name: "Escalate" }).click();
  await ob.locator("textarea").fill(`Client wants terms this week ${TAG}`);
  await page.evaluate(() => { document.querySelector('[data-component="ContextHeader"]')?.setAttribute("data-e2e-mark", "kept"); });
});

await step(page, "inbound-response-reconciles-in-place", async () => {
  await api("POST", `/opportunities/${out.opportunityId}/actions`, { action: "record_response", opportunityInsurerId: jubilee.id, outcome: "quoted", premiumAmount: "2510000", premiumCurrency: "KES", validUntil: iso(new Date(Date.now() + 30 * DAY)), sourceNote: `Jubilee email ${TAG}` }, KAMAU);
  await focusRefresh(page);
  const quotes = page.locator('[data-component="QuoteComparison"]');
  await quotes.waitFor({ timeout: 10000 });
  must((await quotes.innerText()).includes("2,510,000.00"), "the quoted premium is not the recorded one");
  must(await page.locator('[data-component="ContextHeader"][data-e2e-mark="kept"]').count(), "the workspace remounted instead of reconciling");
  must((await page.locator('[data-block="obligations"] textarea').inputValue()).includes(`Client wants terms this week ${TAG}`), "the unsent escalation text was lost");
  must((await page.locator(".lv-marked").count()) > 0, "nothing was marked as changed");
  // The broker keeps Jubilee in focus and opens the sources behind the comparison.
  await quotes.locator(".lv-focus-btn", { hasText: "Jubilee" }).click();
  await quotes.locator(".lv-sources summary").click();
  await page.waitForTimeout(500);
});

await step(page, "revision-shown-beside-earlier", async () => {
  await api("POST", `/opportunities/${out.opportunityId}/actions`, { action: "record_response", opportunityInsurerId: jubilee.id, outcome: "quoted", premiumAmount: "2650000", premiumCurrency: "KES", validUntil: iso(new Date(Date.now() + 30 * DAY)), sourceNote: `Jubilee revised email ${TAG}` }, KAMAU);
  await focusRefresh(page);
  const change = page.locator('[data-component="ChangeComparison"]');
  await change.waitFor({ timeout: 10000 });
  const t = await change.innerText();
  must(t.includes("2,510,000.00") && t.includes("2,650,000.00"), `earlier and revised premiums are not side by side: ${t.slice(0, 200)}`);
  must((await page.locator('[data-block="obligations"] textarea').inputValue()).includes(TAG), "the unsent text was lost on the second update");
  must(await page.locator('[data-block="obligations"] .lv-command').getByText("Why it is escalated").count(), "the open form is no longer the escalation it was opened for");
  must(await page.locator('[data-component="QuoteComparison"] .lv-focus-btn[aria-pressed="true"]', { hasText: "Jubilee" }).count(), "the focused insurer was lost on the update");
  must(await page.locator('[data-component="QuoteComparison"] .lv-sources[open]').count(), "the open sources closed on the update");
});

await step(page, "explore-a-choice-without-recording", async () => {
  const before = sql(`select count(*) from client_instructions where opportunity_id = '${out.opportunityId}'`);
  const panel = page.locator('[data-component="ExplorationPanel"]');
  await panel.waitFor({ timeout: 10000 });
  await panel.getByRole("button", { name: /^Jubilee/ }).click();
  await settle(page, 1500);
  must(decodeURIComponent(new URL(page.url()).hash).includes(`explore=${jubilee.id}`), "the exploration is not in the address");
  const card = page.locator(".lv-explore-card", { hasText: "Jubilee" });
  await card.waitFor({ timeout: 10000 });
  const t = await card.innerText();
  must(t.includes("KES 2,650,000.00") && t.includes("+KES 250,000.00 against the expiring KES 2,400,000.00 (+10.4%)"), `the explored figures are not the recorded ones: ${t.slice(0, 200)}`);
  must(t.includes("Renews with the current insurer"), "the insurer change is not said");
  const a11y = await axeSerious(page);
  must(a11y.length === 0, `accessibility: ${a11y.join(" | ")}`);
  must(await panel.getByText(/nothing is recorded/i).count(), "the exploration does not say nothing is recorded");
  must(sql(`select count(*) from client_instructions where opportunity_id = '${out.opportunityId}'`) === before, "exploring recorded something");
  // The unsent escalation is still being typed.
  must((await page.locator('[data-block="obligations"] textarea').inputValue()).includes(TAG), "exploring lost the unsent text");
  await page.goBack();
  await settle(page, 1500);
  must((await page.locator(".lv-explore-card").count()) === 0, "Back did not undo the exploration");
});

await step(page, "escalate-through-surface", async () => {
  await page.locator('[data-block="obligations"] .lv-command').getByRole("button", { name: "Escalate" }).click();
  await page.locator('[data-block="obligations"]').getByText("Done.").waitFor({ timeout: 10000 });
  must(sql(`select coalesce(facts->'escalated'->>'reason', '') from workflow_runs where id = '${run.id}'`).includes(TAG), "the escalation was not recorded on the run");
});
await step(page, "home-says-what-a-colleague-did", async () => {
  await page.goto(BASE + "#/");
  const changes = page.locator(".sh-changes");
  await changes.waitFor({ timeout: 15000 });
  await changes.getByText("An insurer's answer was recorded").first().waitFor({ timeout: 15000 });
  const t = await changes.innerText();
  must(!/2,510,000|2,650,000/.test(t), "Home showed a figure instead of opening the record");
  await changes.locator(".sh-row", { hasText: "An insurer's answer was recorded" }).first().getByRole("button", { name: "Open" }).click();
  await page.locator('.lv-root [data-component="ContextHeader"]').waitFor({ timeout: 15000 });
  must(new URL(page.url()).hash.includes(workItemId), "the change did not open its renewal");
});
await step(page, "selection-restored-on-return", async () => {
  await page.locator('[data-component="QuoteComparison"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  must(await page.locator('[data-component="QuoteComparison"] .lv-focus-btn[aria-pressed="true"]', { hasText: "Jubilee" }).count(), "the focused insurer was not restored after leaving and returning");
  must(await page.locator('[data-component="QuoteComparison"] .lv-sources[open]').count(), "the open sources were not restored");
  await page.reload();
  await page.locator('[data-component="QuoteComparison"] .lv-focus-btn[aria-pressed="true"]').waitFor({ timeout: 15000 });
});
await page.context().close();

const phone = await open({ width: 390, height: 844 }, `#/s/living?workItemId=${workItemId}`);
await step(phone, "mobile-after-actions", async () => {
  await phone.locator('[data-component="QuoteComparison"]').waitFor();
  await phone.locator('[data-component="ChangeComparison"]').scrollIntoViewIfNeeded();
});
await phone.context().close();

await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
process.stdout.write(`\n${results.length - failures}/${results.length} steps passed\n`);
process.exit(failures ? 1 : 0);
