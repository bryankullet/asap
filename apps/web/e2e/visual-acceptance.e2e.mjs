/**
 * The visual acceptance package (D-169): every major authenticated experience at desktop (1440) and
 * phone (390) width, captured from the real interface over the real API and a disposable database —
 * Home, Work, a renewal from approval to comparison, revision, a question asked in place, exploration
 * and a saved proposal, a claim with a handover, a policy change, a client investigation, the
 * portfolio, a conversation, the palettes and the designed states (loading, unavailable, error).
 * The nine-stage journey is captured from the UI Lab, which renders the composer's own output for a
 * fictional renewal at every stage. Nothing here asserts a design; it records it for review, and
 * fails only if a screen does not render.
 */
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const LIVE = process.env.E2E_URL.replace(/#.*$/, "");
const LAB = LIVE.replace(/\/e2e\/live\.html.*$/, "/e2e/lab.html");
const API = process.env.CONNECTED_API_URL;
const DB = process.env.CONNECTED_OWNER_URL;
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots/visual-acceptance";
mkdirSync(OUT, { recursive: true });
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const jwt = (c) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...c });
  return `${h}.${b}.${createHmac("sha256", process.env.CONNECTED_JWT_SECRET).update(`${h}.${b}`).digest("base64url")}`;
};
const AMINA = jwt({ sub: "a0000000-0000-4000-8000-000000000001", email: "amina@connected.test", role: "authenticated", aud: "authenticated" });
const KAMAU = jwt({ sub: "a0000000-0000-4000-8000-000000000002", email: "kamau@connected.test", role: "authenticated", aud: "authenticated" });
const BETA = jwt({ sub: "b0000000-0000-4000-8000-000000000001", email: "beta@connected.test", role: "authenticated", aud: "authenticated" });
const ORG_A = "10000000-0000-4000-8000-00000000000a";
const ACME = "70000000-0000-4000-8000-00000000000a";
const JUBILEE = "60000000-0000-4000-8000-00000000000a";
const CIC = "60000000-0000-4000-8000-00000000000b";
const TAG = Date.now().toString(36).slice(-4).toUpperCase();
const DAY = 86_400_000;
const iso = (d) => d.toISOString().slice(0, 10);
const sql = (q) => execFileSync("psql", [DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const api = async (method, path, body, token = AMINA) => {
  const res = await fetch(API + path, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json).slice(0, 300)}`);
  return json;
};

/* Records, through the real API wherever an endpoint owns them. --------------------------------- */
sql(`insert into client_contacts (organization_id, client_id, full_name, email, is_primary)
  select '${ORG_A}', '${ACME}', 'Wanjiru Kamau', 'wanjiru@acme.test', true
  where not exists (select 1 from client_contacts where client_id = '${ACME}' and email is not null and deleted_at is null)`);
const pol = sql(`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number) values ('${ORG_A}', '${ACME}', '${JUBILEE}', 'Commercial motor', 'MTR-${TAG}') returning id`).split("\n")[0];
const per = sql(`insert into policy_periods (organization_id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis)
  values ('${ORG_A}', '${pol}', '${iso(new Date(Date.now() - 330 * DAY))}', '${iso(new Date(Date.now() + 34 * DAY))}', 2400000, 'KES', 'gross') returning id`).split("\n")[0];
sql(`insert into policy_versions (organization_id, policy_id, version, effective_from, source) values ('${ORG_A}', '${pol}', 1, '${iso(new Date(Date.now() - 330 * DAY))}', 'seed')`);
const run = (await api("POST", "/workflows/renewals", { policyPeriodId: per })).run;
const renewal = run.workItemId;
const claimWork = (await api("POST", "/work-items", { kind: "claim", clientId: ACME, incidentOn: iso(new Date(Date.now() - 3 * DAY)), incidentSummary: `Rear-ended at the Mlolongo weighbridge (${TAG})`, policyId: pol, source: "ask" }, KAMAU)).item.id;
const claimId = sql(`select id from claims where work_item_id = '${claimWork}'`);
await api("POST", `/claims/${claimId}/actions`, { action: "add_document", label: "Police abstract", holder: "client" }, KAMAU);
await api("POST", `/claims/${claimId}/actions`, { action: "add_document", label: "Driver's licence", holder: "client" }, KAMAU);
const changeWork = (await api("POST", "/work-items", { kind: "endorsement", clientId: ACME, policyId: pol, requestText: `Please add KDQ 418${TAG.slice(0, 1)} (Isuzu FRR) to the fleet from Monday.`, requestedBy: "policyholder" }, KAMAU)).item.id;
const eid = sql(`select id from endorsements where work_item_id = '${changeWork}'`);
await api("POST", `/endorsements/${eid}/actions`, { action: "set_details", effectiveOn: iso(new Date(Date.now() + 3 * DAY)), items: [{ id: "veh1", label: `KDQ 418${TAG.slice(0, 1)}`, before: null, after: "Isuzu FRR, KES 4,800,000", sumInsuredMinor: 480000000 }] }, KAMAU);

/* Capture. --------------------------------------------------------------------------------------- */
const manifest = [];
let failures = 0;
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? "/opt/pw-browsers/chromium" });
const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
const settle = async (page, ms = 900) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
async function context(viewport, token = AMINA) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900, deviceScaleFactor: 1 });
  await ctx.addInitScript((t) => { window.__E2E_TOKEN = t; }, token);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  return page;
}
/** One screen: wait for it, capture the top, and further down where it scrolls. */
async function shot(page, group, name, title, note, ready, { lower = false, still = true } = {}) {
  const vp = page.viewportSize();
  try {
    await ready();
    if (still) await settle(page);
    const file = `${String(manifest.length + 1).padStart(3, "0")}-${vp.width}-${name}.png`;
    await page.screenshot({ path: `${OUT}/${file}` });
    manifest.push({ group, name, title, note, width: vp.width, file });
    if (lower) {
      const moved = await page.evaluate(() => { const s = document.querySelector(".lv-scroll") ?? document.querySelector(".sh-main") ?? document.scrollingElement; if (!s || s.scrollHeight <= s.clientHeight + 40) return false; s.scrollTop = Math.min(s.scrollHeight, s.clientHeight * 0.9); return true; });
      if (moved) {
        await page.waitForTimeout(400);
        const f2 = `${String(manifest.length + 1).padStart(3, "0")}-${vp.width}-${name}-lower.png`;
        await page.screenshot({ path: `${OUT}/${f2}` });
        manifest.push({ group, name: `${name}-lower`, title: `${title} (further down)`, note, width: vp.width, file: f2 });
        await page.evaluate(() => { const s = document.querySelector(".lv-scroll") ?? document.querySelector(".sh-main") ?? document.scrollingElement; if (s) s.scrollTop = 0; });
      }
    }
    process.stdout.write(`✓ ${vp.width} ${name}\n`);
  } catch (e) {
    failures++;
    await page.screenshot({ path: `${OUT}/failed-${vp.width}-${name}.png` }).catch(() => {});
    process.stdout.write(`✗ ${vp.width} ${name} — ${String(e.message ?? e).split("\n")[0]}\n`);
  }
}
const living = (page) => page.locator('.lv-root [data-component="ContextHeader"]').waitFor({ timeout: 30000 });
const go = async (page, hash) => { await page.goto(LIVE + hash); };

// The renewal before approval: the bundle exactly as it would leave, in place.
for (const vp of VIEWPORTS) {
  const page = await context(vp);
  await go(page, `#/s/living?workItemId=${renewal}`);
  await shot(page, "Renewal", "renewal-approval", "Renewal — what leaves the brokerage, for approval", "ApprovalBundle in full with the governed approve and return commands; nothing is sent until approved.", () => page.locator('[data-component="ApprovalBundle"]').waitFor({ timeout: 30000 }), { lower: true });
  await page.context().close();
}
// Approve, deliver and record two answers and a revision through the owning endpoints.
const detail0 = await api("GET", `/workflows/runs/${run.id}`);
await api("POST", `/workflow-approvals/${run.approval.id}/decide`, { decision: "approve", bundleSha256: detail0.approval?.bundleSha256 ?? run.approval.bundleSha256 });
const detail = await api("GET", `/workflows/runs/${run.id}`);
const out = detail.steps.find((s) => s.key === "open_terms")?.output ?? {};
if (out.opportunityId) {
  const opp0 = await api("GET", `/opportunities/${out.opportunityId}`);
  if (!opp0.insurers.some((i) => i.insurerName.startsWith("CIC"))) await api("POST", `/opportunities/${out.opportunityId}/actions`, { action: "add_insurer", insurerId: CIC }).catch(() => null);
  const opp = await api("GET", `/opportunities/${out.opportunityId}`);
  for (const i of opp.insurers) {
    if (i.request?.id && !i.request.approvedAt) await api("POST", `/opportunities/${out.opportunityId}/actions`, { action: "approve_request", quoteRequestId: i.request.id }).catch(() => null);
  }
  const opp2 = await api("GET", `/opportunities/${out.opportunityId}`);
  for (const i of opp2.insurers) {
    if (i.request?.id && !i.request.delivery && !i.request.sentAt) await api("POST", `/opportunities/${out.opportunityId}/actions`, { action: "record_delivery", quoteRequestId: i.request.id, method: "own_email", reference: `Sent to ${i.insurerName} underwriting` }).catch(() => null);
  }
  const opp3 = await api("GET", `/opportunities/${out.opportunityId}`);
  const jub = opp3.insurers.find((i) => i.insurerName.startsWith("Jubilee"));
  const cic = opp3.insurers.find((i) => i.insurerName.startsWith("CIC"));
  const respond = (i, amount, note) => api("POST", `/opportunities/${out.opportunityId}/actions`, { action: "record_response", opportunityInsurerId: i.id, outcome: "quoted", premiumAmount: amount, premiumCurrency: "KES", validUntil: iso(new Date(Date.now() + 30 * DAY)), sourceNote: note, ...(i.request?.delivery || i.request?.sentAt ? {} : { withoutRequest: true }) }, KAMAU);
  if (jub) { await respond(jub, "2510000", "Jubilee underwriting email"); await respond(jub, "2650000", "Jubilee revised terms email"); }
  if (cic) await respond(cic, "2585000", "CIC underwriting email").catch(() => null);
  globalThis.__jubilee = jub?.id ?? null;
}

for (const vp of VIEWPORTS) {
  const page = await context(vp);
  await go(page, `#/s/living?workItemId=${renewal}`);
  await shot(page, "Renewal", "renewal-comparison", "Renewal — insurer answers side by side, with the revision", "QuoteComparison (named facts, never ranked) and ChangeComparison (earlier beside revised); the journey across the top.", () => page.locator('[data-component="QuoteComparison"]').waitFor({ timeout: 30000 }), { lower: true });
  await shot(page, "Renewal", "renewal-header", "Renewal — header and nine-stage journey (live)", "ContextHeader actions wrap onto a second row at narrower widths; the journey shows nine stages.", () => living(page));
  await go(page, `#/s/living?workItemId=${renewal}&focus=compare_revisions&fq=${encodeURIComponent("Compare the revised terms")}&fsrc=rules`);
  await shot(page, "Ask ASAP in place", "renewal-ask-compare", "Asked in the renewal: “Compare the revised terms”", "The workspace recomposes: a FocusPanel answer from records after the header, the concerned blocks brought forward and marked.", () => page.locator('[data-component="FocusPanel"]').waitFor({ timeout: 30000 }), { lower: true });
  if (globalThis.__jubilee) {
    await go(page, `#/s/living?workItemId=${renewal}&explore=${globalThis.__jubilee}`);
    await shot(page, "Renewal", "renewal-explore", "Exploring a client choice (hypothetical)", "Drawn dashed in purple, never a status colour; nothing is recorded; save as a numbered proposal.", () => page.locator(".lv-explore-card").first().waitFor({ timeout: 30000 }), { lower: true });
  }
  await page.context().close();
}
if (globalThis.__jubilee) await api("POST", `/living/${renewal}/proposals`, { explore: globalThis.__jubilee, note: "Client asked to see Jubilee's revised terms" }).catch(() => null);
for (const vp of VIEWPORTS) {
  const page = await context(vp);
  await go(page, `#/s/living?workItemId=${renewal}`);
  await shot(page, "Renewal", "renewal-proposals", "Saved proposals beside the workspace", "ProposalVersions: numbered, hypothetical, never the instruction; says when an answer was revised since.", async () => { await page.locator('[data-block="proposals"]').waitFor({ timeout: 30000 }); await page.locator('[data-block="proposals"]').scrollIntoViewIfNeeded(); });
  await page.context().close();
}

// The claim: documents, the three settlement facts, related work, a handover, an arrived email.
const runId = sql(`insert into workflow_runs (organization_id, workflow, subject_type, subject_id, work_item_id, state, current_step, next_run_at, facts)
  values ('${ORG_A}', 'claim', 'claim', '${claimId}', '${claimWork}', 'waiting_party', 'documents', now() + interval '30 days',
  '{"inbound":[{"messageId":"${crypto.randomUUID()}","from":"wanjiru@acme.test","subject":"Police abstract attached","at":"${new Date().toISOString()}","kind":"claim_update","party":null,"step":"documents","by":"auto","acknowledged":false}]}'::jsonb) returning id`).split("\n")[0];
void runId;
const version = sql(`select version from work_items where id = '${claimWork}'`);
await api("POST", `/work-items/${claimWork}/hand-over`, { version, toUserId: "a0000000-0000-4000-8000-000000000001", done: "Notified Jubilee by phone; police abstract requested from the client.", open: "Record the abstract when it arrives; register the claim with Jubilee.", watch: "The client asked for a call before Friday." }, KAMAU);
for (const vp of VIEWPORTS) {
  const page = await context(vp);
  await go(page, `#/s/living?workItemId=${claimWork}`);
  await shot(page, "Claim", "claim", "Claim — handed to you, arrived email, documents, settlement facts", "HandoverNote first for its receiver; ArrivedMail labels ASAP's reading “Not a fact”; offer, acceptance and payment kept as three facts.", () => living(page), { lower: true });
  await go(page, `#/s/living?workItemId=${claimWork}&focus=blockers&fq=${encodeURIComponent("Show what is blocking this claim")}&fsrc=rules`);
  await shot(page, "Ask ASAP in place", "claim-ask-blocking", "Asked in the claim: “Show what is blocking this claim”", "Blockers from records; documents brought forward; abstention text appears only when nothing is listed.", () => page.locator('[data-component="FocusPanel"]').waitFor({ timeout: 30000 }));
  await go(page, `#/s/living?workItemId=${claimWork}`);
  await shot(page, "Claim", "claim-command-form", "A governed command opened in place", "Receiving a document: the form asks for what proves it; nothing is pre-filled with a chosen value.", async () => {
    await living(page);
    const docs = page.locator('[data-block="documents"]');
    await docs.getByRole("button", { name: /Police abstract/ }).first().click();
    await docs.locator(".lv-command").waitFor();
    await docs.scrollIntoViewIfNeeded();
  });
  await page.context().close();
}
for (const vp of VIEWPORTS) {
  const page = await context(vp);
  await go(page, `#/s/living?workItemId=${changeWork}`);
  await shot(page, "Policy change", "policy-change", "Policy change — each item waiting for the insurer's written decision", "WorkChecklist of items; consequences; related work on the same policy.", () => living(page), { lower: true });
  await go(page, `#/s/investigation?clientId=${ACME}`);
  await shot(page, "Investigation", "investigation", "Client investigation — everything on file for Acme Motors", "Open work (most pressing first), cover ending soonest, claims, arrived email, recent changes; no commands.", () => page.locator('.lv-root [data-component="ContextHeader"]', { hasText: "Client" }).waitFor({ timeout: 30000 }), { lower: true });
  await go(page, `#/s/portfolio?t=${encodeURIComponent("renewals in the next 60 days by insurer")}`);
  await shot(page, "Portfolio", "portfolio", "Renewal portfolio, refined in words", "“renewals in the next 60 days by insurer”: the query in removable chips, groups and totals from records.", () => page.locator('[data-component="PortfolioGroups"], [data-component="QueryInterpretation"]').first().waitFor({ timeout: 30000 }), { lower: true });
  await page.context().close();
}

// The shell: Home, Work, Automations, Activity, a conversation, the palettes.
for (const vp of VIEWPORTS) {
  const page = await context(vp);
  await go(page, "#/");
  await shot(page, "Shell", "home", "Home", "Calm and full width: what needs you, what ASAP is handling, what changed since you last looked.", () => page.locator(".sh-root").waitFor({ timeout: 30000 }), { lower: true });
  await go(page, "#/work");
  await shot(page, "Shell", "work-needs-me", "Work — Needs me", "Each row an outcome: title, client, status, owner, waiting party, next date, urgency.", () => page.getByRole("tablist", { name: "Work views" }).waitFor({ timeout: 30000 }));
  await go(page, "#/work?view=waiting");
  await shot(page, "Shell", "work-waiting", "Work — Waiting on others", "Outside parties named with the date: “With Jubilee since …”.", () => page.getByRole("tablist", { name: "Work views" }).waitFor({ timeout: 30000 }));
  await go(page, "#/automations");
  await shot(page, "Shell", "automations", "Automations", "Standing instructions and every firing, including the ones that did nothing.", () => page.locator(".sh-root").waitFor({ timeout: 30000 }));
  await go(page, "#/activity");
  await shot(page, "Shell", "activity", "Activity", "What ASAP processed; never the only place something important lives.", () => page.locator(".sh-root").waitFor({ timeout: 30000 }));
  await go(page, "#/ask");
  await shot(page, "Ask ASAP", "conversation", "Ask ASAP — a new conversation, centred", "Chat opens only from Home, + New, an earlier conversation or “Ask about this”.", () => page.locator("textarea").first().waitFor({ timeout: 30000 }));
  await go(page, "#/");
  await shot(page, "Shell", "search-palette", "Search (Ctrl/⌘ K)", "Every record and conversation.", async () => { await page.locator(".sh-root").waitFor(); await settle(page); await page.keyboard.press("Control+k"); await page.getByRole("dialog").first().waitFor(); });
  await page.keyboard.press("Escape");
  await shot(page, "Shell", "new-palette", "+ New", "What can be started.", async () => { await page.getByRole("button", { name: /New/ }).first().click(); await page.getByRole("dialog").first().waitFor(); });
  await page.keyboard.press("Escape");
  if (vp.width < 900) await shot(page, "Shell", "more-sheet", "More (phone)", "The bottom bar's overflow.", async () => { await page.getByRole("button", { name: /More/ }).first().click(); await page.getByRole("dialog").first().waitFor(); });
  await page.context().close();
}

// Designed states: loading, not available to you, could not be composed.
for (const vp of VIEWPORTS) {
  const slow = await context(vp);
  await slow.route(`${API}/living/**`, async (r) => { await new Promise((ok) => setTimeout(ok, 4000)); await r.continue().catch(() => {}); });
  await go(slow, `#/s/living?workItemId=${renewal}`);
  await shot(slow, "States", "state-loading", "Loading — composing the workspace", "Skeleton blocks in the surface's own geometry, announced to screen readers.", () => slow.locator(".lv-skeleton, .lv-loading, [aria-busy=true]").first().waitFor({ timeout: 3500 }), { still: false });
  await slow.context().close();
  const other = await context(vp, BETA);
  await go(other, `#/s/living?workItemId=${renewal}`);
  await shot(other, "States", "state-unavailable", "Another brokerage opens the link", "“This renewal is not available to you” — the record does not exist for them; no example is drawn.", () => other.getByText(/not available to you/).waitFor({ timeout: 30000 }));
  await other.context().close();
  const broken = await context(vp);
  // The API's own refusal, as it answers a surface the validator rejected (CORS headers as the API sends them).
  await broken.route(`${API}/living/**`, (r) => r.request().method() === "OPTIONS"
    ? r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET,POST,OPTIONS" } })
    : r.fulfill({ status: 422, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: { code: "surface_invalid", message: "This workspace could not be composed" } }) }));
  await go(broken, `#/s/living?workItemId=${renewal}`);
  await shot(broken, "States", "state-refused", "A surface the validator refused", "ASAP shows nothing it could not validate, and says the record itself is unaffected.", () => broken.getByText(/could not be composed/).waitFor({ timeout: 30000 }));
  await broken.context().close();
}

// The nine-stage journey, stage by stage, from the UI Lab (the composer's output, fictional records).
for (const vp of VIEWPORTS) {
  const page = await context(vp);
  for (const stage of ["preparing", "awaiting_terms", "comparing", "placing", "issuing", "verified", "continuing", "stopped"]) {
    await page.goto(`${LAB}#stage=${stage}`);
    await shot(page, "Journey (UI Lab)", `journey-${stage}`, `Journey — ${stage.replace("_", " ")}`, "UI Lab: the real renderer over the composer's output for one fictional renewal.", () => page.locator('[data-component="RenewalJourney"]').waitFor({ timeout: 30000 }));
  }
  await page.context().close();
}

await browser.close();
writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
process.stdout.write(`\n${manifest.length} screenshots, ${failures} screens did not render\n`);
process.exit(failures ? 1 : 0);
