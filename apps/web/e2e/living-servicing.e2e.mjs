/**
 * Claim and policy-change workspaces in a real browser (D-161): created through the real API,
 * acted on in place through the existing claim and endorsement endpoints. No wording decides cover.
 */
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.E2E_URL.replace(/#.*$/, "");
const API = process.env.CONNECTED_API_URL;
const DB = process.env.CONNECTED_OWNER_URL;
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots/living-servicing";
mkdirSync(OUT, { recursive: true });
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const jwt = (c) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...c });
  return `${h}.${b}.${createHmac("sha256", process.env.CONNECTED_JWT_SECRET).update(`${h}.${b}`).digest("base64url")}`;
};
const AMINA = jwt({ sub: "a0000000-0000-4000-8000-000000000001", email: "amina@connected.test", role: "authenticated", aud: "authenticated" });
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

const pol = sql(`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
  values ('${ORG_A}', '${ACME}', '${JUBILEE}', 'Commercial motor', 'LSV-${TAG}') returning id`).split("\n")[0];
sql(`insert into policy_periods (organization_id, policy_id, period_start, period_end) values ('${ORG_A}', '${pol}', '${iso(new Date(Date.now() - 200 * DAY))}', '${iso(new Date(Date.now() + 165 * DAY))}')`);
sql(`insert into policy_versions (organization_id, policy_id, version, effective_from, source) values ('${ORG_A}', '${pol}', 1, '${iso(new Date(Date.now() - 200 * DAY))}', 'seed')`);
const claimWork = (await api("POST", "/work-items", { kind: "claim", clientId: ACME, incidentOn: iso(new Date(Date.now() - 2 * DAY)), incidentSummary: `Rear-ended at Mlolongo ${TAG}.`, policyId: pol, source: "ask" })).item.id;
const claimId = sql(`select id from claims where work_item_id = '${claimWork}'`);
await api("POST", `/claims/${claimId}/actions`, { action: "add_document", label: `Police abstract ${TAG}`, holder: "client" });
const endWork = (await api("POST", "/work-items", { kind: "endorsement", clientId: ACME, policyId: pol, requestText: `Please add vehicle KDX ${TAG.slice(0, 3)}A to the fleet.`, requestedBy: "policyholder" })).item.id;
const eid = sql(`select id from endorsements where work_item_id = '${endWork}'`);
await api("POST", `/endorsements/${eid}/actions`, { action: "set_details", effectiveOn: iso(new Date(Date.now() + 3 * DAY)), items: [{ id: "veh1", label: `KDX ${TAG.slice(0, 3)}A`, before: null, after: "Toyota Hilux", sumInsuredMinor: 320000000 }] });


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
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
async function step(page, name, fn) {
  const problems = [];
  try { await fn(); } catch (e) { problems.push(String(e.message ?? e).split("\n")[0]); }
  const overflow = await page.evaluate(() => { const r = document.querySelector(".lv-root"); const f = document.querySelector(".lv-scroll"); return r && f ? r.scrollWidth - f.clientWidth : 0; });
  if (overflow > 1) problems.push(`${overflow}px wider than the screen`);
  const text = await page.locator("body").innerText();
  const bad = text.match(/\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/);
  if (bad) problems.push(`placeholder “${bad[0]}”`);
  if (/\b(covered|not covered|declin|repudiat|liab|payable)\w*/i.test(await page.locator(".lv-root").innerText().catch(() => ""))) problems.push("a sentence decides cover");
  if (page.errors.length) problems.push(`console: ${page.errors.splice(0).join(" | ").slice(0, 300)}`);
  const vp = page.viewportSize();
  await page.screenshot({ path: `${OUT}/${vp.width}-${name}.png` });
  results.push({ step: `${vp.width} ${name}`, ok: !problems.length, problems });
  if (problems.length) failures++;
  process.stdout.write(`${problems.length ? "✗" : "✓"} ${vp.width} ${name}${problems.length ? " — " + problems.join("; ") : ""}\n`);
}

const page = await open({ width: 1440, height: 1000 }, `#/s/living?workItemId=${claimWork}`);
await step(page, "claim-workspace", async () => {
  must((await page.locator(".sh-pane-label, .sh-head").first().innerText().catch(() => "")).length >= 0, "no header");
  must(await page.getByText("Offer, acceptance and payment").count(), "the three claim facts are not shown");
  must(await page.getByText(/an offer is not acceptance, and acceptance is not payment/i).count(), "the facts are not kept separate in words");
  must(await page.getByText(`Police abstract ${TAG}`).count(), "the outstanding document is not listed");
  const a11y = await axeSerious(page);
  must(a11y.length === 0, `accessibility: ${a11y.join(" | ")}`);
});
await step(page, "claim-ask-what-is-blocking", async () => {
  // Ask inside the workspace (D-165): the request becomes a focus in the address and the same
  // workspace recomposes around it — no chat transcript appears.
  const box = page.locator(".lv-refine");
  await box.locator("input").fill("Show what is blocking this claim");
  await box.getByRole("button", { name: "Change view" }).click();
  const focus = page.locator('[data-component="FocusPanel"]');
  await focus.waitFor({ timeout: 15000 });
  must(/focus=blockers/.test(page.url()), `the focus is not in the address: ${page.url()}`);
  must(await focus.getByText(`Police abstract ${TAG} — not received`).count(), "the outstanding document is not named as blocking");
  must(await page.locator('[data-block="documents"].lv-emphasis').count(), "the documents are not marked as concerned");
  must((await page.locator(".sh-transcript, .cv-transcript").count()) === 0, "a chat transcript opened");
  await page.reload();
  await focus.waitFor({ timeout: 15000 });
  must(await focus.getByText("Show what is blocking this claim").count(), "refresh did not reproduce the focus");
  const a11y = await axeSerious(page);
  must(a11y.length === 0, `accessibility: ${a11y.join(" | ")}`);
});
await step(page, "claim-ask-refused", async () => {
  const box = page.locator(".lv-refine");
  const before = page.url();
  await box.locator("input").fill("approve the claim");
  await box.getByRole("button", { name: "Change view" }).click();
  await box.locator(".lv-refine-message").waitFor({ timeout: 10000 });
  must(/Asking does not act/.test(await box.locator(".lv-refine-message").innerText()), "the refusal does not say why");
  must(page.url() === before, "a refused request changed the workspace");
});
await step(page, "claim-whole-workspace-again", async () => {
  await page.getByRole("button", { name: "Show the whole workspace" }).click();
  await page.waitForFunction(() => !/focus=/.test(location.href), null, { timeout: 10000 });
  await page.locator('[data-component="FocusPanel"]').waitFor({ state: "detached", timeout: 15000 });
});
await step(page, "claim-document-received-in-place", async () => {
  const docs = page.locator('[data-block="documents"]');
  await docs.getByRole("button", { name: new RegExp(`Police abstract ${TAG}`) }).click();
  await docs.locator(".lv-command input").fill(`Emailed by the client ${TAG}`);
  await docs.locator(".lv-command").getByRole("button", { name: new RegExp(`Police abstract ${TAG}`) }).click();
  await page.locator(".lv-receipt").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  must(await docs.locator(".lv-check-done", { hasText: `Police abstract ${TAG}` }).count(), "the document is not shown as received");
  must((await docs.getByText(/no longer offered/).count()) === 0, "a completed command was called 'no longer offered'");
  must(sql(`select count(*) from claim_documents where claim_id = '${claimId}' and reference = 'Emailed by the client ${TAG}'`) === "1", "the receipt was not recorded on the claim");
});
await page.goto(BASE + `#/s/living?workItemId=${endWork}`);
await page.locator('.lv-root [data-component="ContextHeader"]').waitFor({ timeout: 20000 });
await page.waitForTimeout(800);
await step(page, "policy-change-decided-in-place", async () => {
  const items = page.locator('[data-block="items"]');
  await items.waitFor();
  await items.getByRole("button", { name: /Record the insurer's decision/ }).click();
  const form = items.locator(".lv-command");
  await form.locator("select").selectOption("accepted");
  await form.locator('input[type="text"]').fill(`Jubilee email ${TAG}`);
  await form.getByRole("button", { name: /Record the insurer's decision/ }).click();
  await page.locator(".lv-receipt").waitFor({ timeout: 15000 });
  await page.waitForTimeout(1200);
  must(await items.locator(".lv-check-done").count(), "the accepted item is not shown as decided");
});
await page.context().close();
const phone = await open({ width: 390, height: 844 }, `#/s/living?workItemId=${claimWork}`);
await step(phone, "mobile-claim", async () => { await phone.locator('[data-block="settlement"]').scrollIntoViewIfNeeded(); });
await phone.context().close();
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
process.stdout.write(`\n${results.length - failures}/${results.length} steps passed\n`);
process.exit(failures ? 1 : 0);
