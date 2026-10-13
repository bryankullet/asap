/**
 * The renewal portfolio, refined in plain language, in a real browser (D-158):
 *
 *   real interface → real API → supabase-js → PostgREST → disposable PostgreSQL
 *
 * Two renewals are started and answered through the real API — one insurer raising the premium,
 * one lowering it. A broker asks Home for "renewals in the next 60 days", then refines the view in
 * words: grouping, a premium-change filter, a comparison, something it cannot understand. Every
 * figure must be the recorded one; Back must undo a refinement; a row must open its workspace.
 */
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.E2E_URL.replace(/#.*$/, "");
const API = process.env.CONNECTED_API_URL;
const DB = process.env.CONNECTED_OWNER_URL;
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots/living-portfolio";
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
const api = async (method, path, body) => {
  const res = await fetch(API + path, { method, headers: { Authorization: `Bearer ${AMINA}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

const CIC = "60000000-0000-4000-8000-00000000000b";
sql(`insert into client_contacts (organization_id, client_id, full_name, email, is_primary)
  select '${ORG_A}', '${ACME}', 'Wanjiru Kamau', 'wanjiru@acme.test', true
  where not exists (select 1 from client_contacts where client_id = '${ACME}' and email is not null and deleted_at is null)`);
async function renewal(code, insurer, expiring, quoted) {
  const pol = sql(`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
    values ('${ORG_A}', '${ACME}', '${insurer}', 'Commercial motor', '${code}-${TAG}') returning id`).split("\n")[0];
  const per = sql(`insert into policy_periods (organization_id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis)
    values ('${ORG_A}', '${pol}', '${iso(new Date(Date.now() - 330 * DAY))}', '${iso(new Date(Date.now() + 30 * DAY))}', ${expiring}, 'KES', 'gross') returning id`).split("\n")[0];
  const run = (await api("POST", "/workflows/renewals", { policyPeriodId: per })).run;
  if (!run.approval) throw new Error(`${code}: the renewal did not reach approval (${run.state} ${JSON.stringify(run.exception)})`);
  await api("POST", `/workflow-approvals/${run.approval.id}/decide`, { decision: "approve", bundleSha256: run.approval.bundleSha256 });
  const out = (await api("GET", `/workflows/runs/${run.id}`)).steps.find((s) => s.key === "open_terms").output;
  await api("POST", `/opportunities/${out.opportunityId}/actions`, { action: "record_delivery", quoteRequestId: out.quoteRequestId, method: "own_email", reference: `Sent ${code} ${TAG}` });
  const opp = await api("GET", `/opportunities/${out.opportunityId}`);
  const oi = opp.insurers.find((i) => i.insurerId === insurer);
  await api("POST", `/opportunities/${out.opportunityId}/actions`, { action: "record_response", opportunityInsurerId: oi.id, outcome: "quoted", premiumAmount: String(quoted), premiumCurrency: "KES", sourceNote: `Email ${code} ${TAG}` });
  return run;
}
await renewal("PORTI", JUBILEE, 1200000, 1320000);
await renewal("PORTD", CIC, 800000, 760000);


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
  await page.locator(".sh-root").waitFor({ timeout: 30000 });
  await page.locator(".sh-loading").waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
  return page;
}
const settle = async (page, ms = 700) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
const must = (cond, msg) => { if (!cond) throw new Error(msg); };
async function step(page, name, fn) {
  const problems = [];
  try { await fn(); } catch (e) { problems.push(String(e.message ?? e).split("\n")[0]); }
  const overflow = await page.evaluate(() => { const r = document.querySelector(".lv-root"); const f = document.querySelector(".lv-scroll"); return r && f ? r.scrollWidth - f.clientWidth : document.documentElement.scrollWidth - window.innerWidth; });
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
const refine = async (page, text) => {
  await page.getByLabel("Ask ASAP to change this view").fill(text);
  await page.getByRole("button", { name: "Change view" }).click();
  await settle(page, 1200);
};
const rowsText = async (page) => page.locator('[data-component="PortfolioGroups"]').innerText();
const hash = (page) => decodeURIComponent(new URL(page.url()).hash.replace(/\+/g, " "));

const page = await open({ width: 1440, height: 1000 }, "#/");
await step(page, "home-request-opens-the-portfolio", async () => {
  await page.locator(".sh-command-box textarea").fill("renewals in the next 60 days");
  await page.getByRole("button", { name: "Send" }).click();
  await page.locator('[data-component="PortfolioGroups"]').waitFor({ timeout: 20000 });
  await settle(page, 1000);
  must(hash(page).startsWith("#/s/portfolio") && hash(page).includes('"label":"in the next 60 days"'), `the address does not carry the view: ${hash(page)}`);
  must(!hash(page).includes("t="), "the request text stayed in the address");
  const t = await rowsText(page);
  must(t.includes(`PORTI-${TAG}`) && t.includes(`PORTD-${TAG}`), "the renewals in the window are not listed");
  must(await page.getByText("Ending in the next 60 days").count(), "the window is not said back");
  must((await page.locator(".asap-ask").count()) === 0, "a conversation opened instead of the view");
});
await step(page, "group-by-insurer-in-words", async () => {
  await refine(page, "group by insurer");
  must(await page.getByText("Grouped by insurer").count(), "the grouping is not said back");
  const heads = await page.locator(".lv-group-head h3").allInnerTexts();
  must(heads.some((h) => /Jubilee/.test(h)) && heads.some((h) => /CIC/.test(h)), `groups are not insurers: ${heads.join(", ")}`);
  must(hash(page).includes('"groupBy":"insurer"'), "the grouping is not in the address");
});
await step(page, "only-increases-with-recorded-figures", async () => {
  await refine(page, "only premium increases");
  const t = await rowsText(page);
  must(t.includes(`PORTI-${TAG}`) && !t.includes(`PORTD-${TAG}`), "the filter did not keep only the increase");
  must(t.includes("KES 1,200,000.00") && t.includes("KES 1,320,000.00") && t.includes("+KES 120,000.00 (+10.0%)"), "figures are not the recorded ones");
  must(await page.getByText("Grouped by insurer").count(), "refining lost the grouping");
});
await step(page, "back-undoes-a-refinement", async () => {
  await page.goBack();
  await settle(page, 1500);
  const t = await rowsText(page);
  must(t.includes(`PORTD-${TAG}`), "Back did not restore the view before the filter");
  await page.goForward();
  await settle(page, 1500);
  must(!(await rowsText(page)).includes(`PORTD-${TAG}`), "Forward did not reapply the filter");
});
await step(page, "unclear-is-said-not-guessed", async () => {
  const before = await rowsText(page);
  await refine(page, "for the blue sky project");
  must(await page.getByText(/I did not understand “blue sky project”/).count(), "what was not understood is not said");
  must((await rowsText(page)) === before, "an unclear request changed the view");
});
await step(page, "remove-a-part-of-the-view", async () => {
  await page.getByRole("button", { name: "Remove: Premium increases" }).click();
  await settle(page, 1500);
  must((await rowsText(page)).includes(`PORTD-${TAG}`), "removing the filter did not bring the decrease back");
});
await step(page, "compare-insurers-in-words", async () => {
  await refine(page, "compare CIC and Jubilee");
  const cards = page.locator(".lv-compare-card");
  must((await cards.count()) === 2, `expected two insurers side by side, saw ${await cards.count()}`);
  must(await page.getByText(/Comparing .*CIC.* and .*Jubilee/).count(), "the comparison is not said back");
  const a11y = await axeSerious(page);
  must(a11y.length === 0, `accessibility: ${a11y.join(" | ")}`);
});
await step(page, "refresh-reopens-the-same-view", async () => {
  const at = hash(page);
  await page.reload();
  await page.locator('[data-component="PortfolioGroups"]').waitFor({ timeout: 20000 });
  await settle(page, 800);
  must(hash(page) === at, "refresh moved the address");
  must((await page.locator(".lv-compare-card").count()) === 2, "refresh lost the comparison");
});
await step(page, "row-opens-its-workspace", async () => {
  await page.locator(".lv-rowlink", { hasText: "Acme" }).first().click();
  await settle(page, 1500);
  must(hash(page).startsWith("#/s/living"), `a row opened ${hash(page)}`);
  await page.locator('.lv-root [data-component="ContextHeader"]').waitFor({ timeout: 15000 });
});
await page.context().close();

const phone = await open({ width: 390, height: 844 }, "#/s/portfolio");
await step(phone, "mobile-portfolio", async () => {
  await phone.locator('[data-component="PortfolioGroups"]').waitFor({ timeout: 20000 });
  await phone.getByLabel("Ask ASAP to change this view").waitFor();
});
await phone.context().close();

await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
process.stdout.write(`\n${results.length - failures}/${results.length} steps passed\n`);
process.exit(failures ? 1 : 0);
