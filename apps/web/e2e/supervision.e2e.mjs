/**
 * Supervision on Renewal Autopilot, end to end in a real browser (D-131):
 *
 *   E2E_SCRIPT=apps/web/e2e/supervision.e2e.mjs DATABASE_URL=… POSTGREST_BIN=… bash scripts/test-e2e.sh
 *
 * Seven renewals are put into their states through the real API — requiring approval, blocked,
 * waiting on the insurer, with a moved follow-up, escalated, paused, completed — then a broker
 * starts and approves an eighth from the conversation. Ask, the Renewal Space, the supervision
 * board, Upcoming and the autonomy rules must agree, survive a refresh and a second tab, and show
 * no overflow, placeholder text or console error at 1440, 1360 and 390 px. Nothing is sent.
 */
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const URL_ = process.env.E2E_URL;
const API = process.env.CONNECTED_API_URL;
const DB = process.env.CONNECTED_OWNER_URL;
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots/supervision";
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
  if (res.status >= 500) throw new Error(`${method} ${path} → ${res.status}`);
  return json;
};

/* --------------------------------------------------------------------------- seed seven states */
sql(`insert into client_contacts (organization_id, client_id, full_name, email, is_primary)
  select '${ORG_A}', '${ACME}', 'Wanjiru Kamau', 'wanjiru@acme.test', true
  where not exists (select 1 from client_contacts where client_id = '${ACME}' and email is not null and deleted_at is null)`);
function period(code, days, number = `${code}-${TAG}`) {
  const pol = sql(`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
    values ('${ORG_A}', '${ACME}', '${JUBILEE}', 'Commercial motor', ${number === null ? "null" : `'${number}'`}) returning id`).split("\n")[0];
  return sql(`insert into policy_periods (organization_id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis)
    values ('${ORG_A}', '${pol}', '${iso(new Date(Date.now() - 300 * DAY))}', '${iso(new Date(Date.now() + days * DAY))}', 1200000, 'KES', 'gross') returning id`).split("\n")[0];
}
const start = async (p) => (await api("POST", "/workflows/renewals", { policyPeriodId: p })).run;
const approve = async (run) => api("POST", `/workflow-approvals/${run.approval.id}/decide`, { decision: "approve", bundleSha256: run.approval.bundleSha256 });
const deliver = async (runId) => {
  const run = await api("GET", `/workflows/runs/${runId}`);
  const out = run.steps.find((s) => s.key === "open_terms").output;
  await api("POST", `/opportunities/${out.opportunityId}/actions`, { action: "record_delivery", quoteRequestId: out.quoteRequestId, method: "own_email", reference: `Sent to Jubilee underwriting ${TAG}` });
  await api("POST", `/workflows/runs/${runId}/chasing`, { stop: false });
  return out;
};

const S = {};
S.approval = await start(period("SUPA", 95));
S.blocked = await start(period("SUPB", 96, null));
S.waiting = await start(period("SUPW", 97));
await approve(S.waiting);
await deliver(S.waiting.id);
S.moved = await start(period("SUPF", 98));
await approve(S.moved);
await deliver(S.moved.id);
await api("POST", `/workflows/runs/${S.moved.id}/follow-up`, { on: iso(new Date(Date.now() + 2 * DAY)) });
S.escalated = await start(period("SUPE", 99));
await api("POST", `/workflows/runs/${S.escalated.id}/escalate`, { reason: "Client asked for terms this week" });
S.paused = await start(period("SUPP", 100));
await approve(S.paused);
await api("POST", `/workflows/runs/${S.paused.id}/pause`, { reason: "Waiting for the client's broker letter" });
S.completed = await start(period("SUPC", 101));
await approve(S.completed);
const out = await deliver(S.completed.id);
await api("POST", `/opportunities/${out.opportunityId}/actions`, { action: "record_response", opportunityInsurerId: out.opportunityInsurerId, outcome: "quoted", receivedAt: new Date().toISOString(), premiumAmount: "1260000.00", premiumCurrency: "KES", validUntil: iso(new Date(Date.now() + 120 * DAY)), sourceNote: "Renewal terms letter." });
await api("POST", `/workflows/runs/${S.completed.id}/follow-up-now`);
const fresh = period("SUPN", 102);
const freshNumber = `SUPN-${TAG}`;

/* ------------------------------------------------------------------------------ the browser */
const results = [];
let failures = 0;
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? "/opt/pw-browsers/chromium" });
async function open(viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((t) => { window.__E2E_TOKEN = t; }, AMINA);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource: the server responded with a status of 404/.test(m.text())) page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(URL_);
  await page.getByPlaceholder("Tell ASAP what you need").waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  return page;
}
const settle = async (page, ms = 1200) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
async function ask(page, text) {
  await page.getByPlaceholder("Tell ASAP what you need").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await settle(page, 1500);
}
const lastPending = (page) => page.locator(".asap-pending").last();
const pane = (page) => page.locator(".asap-pane").first();
async function checks(page) {
  const body = await page.locator("body").innerText();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const bad = body.match(/\bundefined\b|\bNaN\b|\.demo\b|@example\.|\bnull\b|\[object Object\]/);
  const problems = [];
  if (overflow > 1) problems.push(`horizontal overflow ${overflow}px`);
  if (bad) problems.push(`placeholder text “${bad[0]}”`);
  if (page.errors.length) problems.push(`console: ${page.errors.join(" | ").slice(0, 300)}`);
  page.errors = [];
  return problems;
}
async function step(page, name, fn) {
  const problems = [];
  try {
    await fn();
  } catch (e) {
    problems.push(String(e.message ?? e).split("\n")[0]);
  }
  problems.push(...(await checks(page)));
  const vp = page.viewportSize();
  const file = `${OUT}/${vp.width}-${name}.png`;
  await page.screenshot({ path: file });
  results.push({ name: `${vp.width} ${name}`, ok: !problems.length, problems, file });
  if (problems.length) failures += 1;
  process.stdout.write(`${problems.length ? "✗" : "✓"} ${vp.width} ${name}${problems.length ? " — " + problems.join("; ") : ""}\n`);
}
const expectText = async (where, re) => {
  const t = await where.innerText();
  if (!(typeof re === "string" ? t.includes(re) : re.test(t))) throw new Error(`expected ${re} on screen`);
};
const openRun = async (page, runId, view) => {
  await page.evaluate(([r, v]) => sessionStorage.setItem("asap.openRef", JSON.stringify({ ws: "renewal", runId: r, ...(v ? { view: v } : {}) })), [runId, view]);
  await page.reload();
  await page.getByPlaceholder("Tell ASAP what you need").waitFor({ timeout: 30000 });
  await settle(page, 1800);
};
const openRef = async (page, ref) => {
  await page.evaluate((r) => sessionStorage.setItem("asap.openRef", JSON.stringify(r)), ref);
  await page.reload();
  await page.getByPlaceholder("Tell ASAP what you need").waitFor({ timeout: 30000 });
  await settle(page, 1800);
};

{
  const page = await open({ width: 1440, height: 900 });
  await step(page, "01-coming-up-window-vs-manual", async () => {
    await ask(page, "What renewals are coming up?");
    await expectText(page.locator("body"), /No policy period ends within the 60-day renewal window|within the 60-day renewal window/);
    await expectText(page.locator("body"), /started by a person, outside the automatic window/);
  });
  await step(page, "02-start-renewal-card", async () => {
    await ask(page, `Prepare the renewal of ${freshNumber}`);
    await expectText(lastPending(page), "Start the renewal of " + freshNumber);
  });
  await step(page, "03-approval-card-in-chat", async () => {
    await lastPending(page).getByRole("button", { name: "Start renewal", exact: true }).click();
    await settle(page, 2500);
    await expectText(lastPending(page), "Renewal pack ready");
    await expectText(lastPending(page), "Nothing will be sent automatically");
    await expectText(pane(page), /Waiting for approval from/);
  });
  await step(page, "04-approved-not-sent", async () => {
    await lastPending(page).getByRole("button", { name: "Approve bundle", exact: true }).click();
    await settle(page, 2500);
    await expectText(page.locator("body"), "Approved — not sent");
    await expectText(page.locator("body"), "ASAP opened the next step: deliver the insurer request");
    await expectText(pane(page), "Approved — not delivered");
  });
  await step(page, "05-refresh-keeps-workflow-and-chat", async () => {
    await page.reload();
    await page.getByPlaceholder("Tell ASAP what you need").waitFor({ timeout: 30000 });
    await settle(page, 2500);
    await expectText(page.locator("body"), "Approved — not sent");
    await expectText(pane(page), "Approved — not delivered");
  });
  await step(page, "06-space-requiring-approval", async () => {
    await openRun(page, S.approval.id);
    await expectText(pane(page), /Waiting for approval from/);
    await expectText(pane(page), /of 11 steps complete/);
    await expectText(pane(page), "Approve bundle");
  });
  await step(page, "07-space-review-view", async () => {
    await openRun(page, S.approval.id, "review");
    await expectText(pane(page), "Reject — say what is wrong");
  });
  await step(page, "08-space-blocked", async () => {
    await openRun(page, S.blocked.id);
    await expectText(pane(page), "Waiting for information: policy number");
    await expectText(pane(page), "Blocking");
    await expectText(pane(page), "I've fixed it — resume");
  });
  await step(page, "09-space-waiting-on-insurer", async () => {
    await openRun(page, S.waiting.id);
    await expectText(pane(page), "Waiting for terms from Jubilee");
    await expectText(pane(page), "Next follow-up");
  });
  await step(page, "10-space-escalated", async () => {
    await openRun(page, S.escalated.id);
    await expectText(pane(page), /Escalated to/);
  });
  await step(page, "11-space-paused", async () => {
    await openRun(page, S.paused.id);
    await expectText(pane(page), /Paused by .* ASAP will not act until it is resumed/);
  });
  await step(page, "12-space-completed-receipt", async () => {
    await openRun(page, S.completed.id, "receipt");
    await expectText(pane(page), "Renewal terms ready to present — Jubilee quoted KES 1,260,000");
  });
  await step(page, "13-space-actions-why-unavailable", async () => {
    await openRun(page, S.approval.id, "actions");
    await expectText(pane(page), "Not available now");
    await expectText(pane(page), "the insurer request has not been delivered");
  });
  await step(page, "14-ask-where-and-follow-up", async () => {
    await openRun(page, S.moved.id);
    await ask(page, "When will ASAP follow up?");
    await expectText(page.locator("body"), /ASAP follows up on/);
  });
  await step(page, "15-ask-move-follow-up-card", async () => {
    await ask(page, "Move the next follow-up to Friday");
    await expectText(lastPending(page), /Move the next follow-up to/);
    await lastPending(page).getByRole("button", { name: "Move follow-up", exact: true }).click();
    await settle(page, 2500);
    await expectText(page.locator("body"), /Next follow-up moved to/);
  });
  await step(page, "16-board-needs-me", async () => {
    await openRef(page, { ws: "renewal", view: "needs_me" });
    await expectText(pane(page), "Needs me");
    await expectText(pane(page), "Rules ASAP is working to");
  });
  await step(page, "17-board-waiting-on-others", async () => {
    await openRef(page, { ws: "renewal", view: "waiting_on_others" });
    await expectText(pane(page), /Waiting for terms from Jubilee/);
  });
  await step(page, "18-upcoming", async () => {
    await openRef(page, { ws: "renewal", view: "upcoming" });
    await expectText(pane(page), "What ASAP plans to do");
    await expectText(pane(page), /Follow up with Jubilee|Escalate to/);
  });
  await step(page, "19-autonomy-rules", async () => {
    await openRef(page, { ws: "autonomy" });
    await expectText(pane(page), "What ASAP may do on its own");
    await expectText(pane(page), "Never automatic");
    await expectText(pane(page), "Approval always");
  });
  await step(page, "20-ask-needs-approval", async () => {
    await ask(page, "What needs my approval?");
    await expectText(page.locator("body"), /waiting for approval/);
  });
  // A second tab sees the same state.
  const other = await open({ width: 1440, height: 900 });
  await step(other, "21-second-tab-same-state", async () => {
    await openRun(other, S.paused.id);
    await expectText(pane(other), /Paused by/);
  });
  // Duplicate action: Resume twice from two tabs records one resume.
  await step(other, "22-duplicate-resume-once", async () => {
    await openRun(page, S.paused.id, "actions");
    await openRun(other, S.paused.id, "actions");
    await Promise.all([
      page.getByRole("button", { name: "Resume", exact: true }).first().click(),
      other.getByRole("button", { name: "Resume", exact: true }).first().click(),
    ]);
    await settle(page, 2500);
    await settle(other, 500);
    const n = Number(sql(`select count(*) from audit_log where object_id = '${S.paused.id}' and action = 'workflow.resumed' and result = 'success'`));
    if (n !== 1) throw new Error(`resume recorded ${n} times`);
  });
}

for (const w of [1360, 390]) {
  const page = await open({ width: w, height: w === 390 ? 844 : 900 });
  await step(page, "30-space-waiting", async () => {
    await openRun(page, S.waiting.id);
    if (w === 390) {
      const toSpace = page.getByRole("button", { name: /Open Space/ });
      if (await toSpace.count()) await toSpace.first().click();
      await settle(page, 800);
    }
    await expectText(page.locator("body"), "Waiting for terms from Jubilee");
  });
  await step(page, "31-board", async () => {
    await openRef(page, { ws: "renewal", view: "needs_me" });
    if (w === 390) {
      const toSpace = page.getByRole("button", { name: /Open Space/ });
      if (await toSpace.count()) await toSpace.first().click();
      await settle(page, 800);
    }
    await expectText(page.locator("body"), "Needs me");
  });
  await step(page, "32-blocked", async () => {
    await openRun(page, S.blocked.id);
    if (w === 390) {
      const toSpace = page.getByRole("button", { name: /Open Space/ });
      if (await toSpace.count()) await toSpace.first().click();
      await settle(page, 800);
    }
    await expectText(page.locator("body"), "Waiting for information: policy number");
  });
}

// Nothing left the building.
const sends = Number(sql("select count(*) from email_send_attempts"));
if (sends !== 0) { failures += 1; console.log(`✗ ${sends} email send attempts recorded`); }
else console.log("✓ no email send attempts — nothing was sent");

await browser.close();
console.log(`\n${results.length - failures} of ${results.length} steps passed; screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
