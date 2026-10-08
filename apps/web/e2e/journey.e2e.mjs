/**
 * The conversational operating slice, end to end, in a real browser (scripts/test-e2e.sh).
 *
 * Real interface → real API → supabase-js → PostgREST → disposable PostgreSQL. A broker asks in
 * the centre, previews, confirms, sees the right-hand Space update and a receipt, refreshes, and
 * finds the same result. Each scenario is asserted and captured at 1440×900 (and the key ones at
 * 1360×900 and 390×844). Every page is checked for console errors, horizontal overflow and
 * placeholder text. No mailbox exists; nothing is sent.
 */
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";

const URL_ = process.env.E2E_URL;
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots";
mkdirSync(OUT, { recursive: true });
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const jwt = (c) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...c });
  return `${h}.${b}.${createHmac("sha256", process.env.CONNECTED_JWT_SECRET).update(`${h}.${b}`).digest("base64url")}`;
};
const AMINA = jwt({ sub: "a0000000-0000-4000-8000-000000000001", email: "amina@connected.test", role: "authenticated", aud: "authenticated" });
const READER = jwt({ sub: "c0000000-0000-4000-8000-000000000001", email: "reader@connected.test", role: "authenticated", aud: "authenticated" });
const RUN = Date.now().toString(36).slice(-5);
const CLIENT = `Parity Freight ${RUN} Ltd`;

const results = [];
let failures = 0;
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? "/opt/pw-browsers/chromium" });

async function open(token, viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((t) => { window.__E2E_TOKEN = t; }, token);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource: the server responded with a status of 404/.test(m.text())) page.errors.push(m.text()); });
  page.on("pageerror", (e) => page.errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && /%o/.test(m.text())) page.errors.push("detail: " + m.args().map(String).join(" ").slice(0, 400)); });
  await page.goto(URL_);
  await page.getByPlaceholder("Tell ASAP what you need").waitFor({ timeout: 20000 });
  await page.getByText(/What matters now|Tell me what you need/).first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  return page;
}
const settle = async (page, ms = 900) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
const BASE = URL_.replace(/#.*$/, "");
/**
 * Ask from wherever the journey is. Work and Activity are full-width surfaces with no chat (D-155),
 * so after one of them the journey returns to its conversation (Back), or starts a new one.
 */
async function ask(page, text) {
  let box = page.getByPlaceholder("Tell ASAP what you need");
  if (!(await box.first().isVisible().catch(() => false))) {
    await page.goBack();
    await settle(page, 900);
    if (!(await box.first().isVisible().catch(() => false))) {
      await page.goto(BASE + "#/ask");
      await settle(page, 900);
    }
    box = page.getByPlaceholder("Tell ASAP what you need");
  }
  await box.fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await settle(page, 1200);
}
const lastPending = (page) => page.locator(".asap-pending").last();
async function confirm(page, label) {
  await lastPending(page).getByRole("button", { name: label, exact: true }).click();
  await settle(page, 1600);
}
async function checks(page) {
  const body = await page.locator("body").innerText();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const bad = body.match(/\bundefined\b|\bNaN\b|\.demo\b|@example\.|\bnull\b/);
  const problems = [];
  if (overflow > 1) problems.push(`horizontal overflow ${overflow}px`);
  if (bad) problems.push(`placeholder text “${bad[0]}”`);
  if (page.errors.length) problems.push(`console: ${page.errors.join(" | ").slice(0, 300)}`);
  page.errors = [];
  return problems;
}
async function step(page, name, fn, { shot = true } = {}) {
  const problems = [];
  try {
    await fn();
  } catch (e) {
    problems.push(String(e.message ?? e).split("\n")[0]);
  }
  problems.push(...(await checks(page)));
  const vp = page.viewportSize();
  const file = `${OUT}/${vp.width}x${vp.height}-${name}.png`;
  if (shot) await page.screenshot({ path: file });
  results.push({ name: `${vp.width}×${vp.height} ${name}`, ok: problems.length === 0, problems, file: shot ? file : null });
  if (problems.length) failures += 1;
  process.stdout.write(`${problems.length ? "✗" : "✓"} ${vp.width}×${vp.height} ${name}${problems.length ? " — " + problems.join("; ") : ""}\n`);
}
const expectText = async (page, re, where = page.locator("body")) => {
  const t = await where.innerText();
  if (!(typeof re === "string" ? t.includes(re) : re.test(t))) throw new Error(`expected ${re} on screen`);
};

/* ------------------------------------------------------------------ desktop, 1440×900 ---- */
{
  const page = await open(AMINA, { width: 1440, height: 900 });
  // D-155: Home is calm and full width; a conversation is centred until it opens a Space.
  await step(page, "01-home-no-transcript", async () => {
    await page.goto(BASE + "#/");
    await settle(page, 600);
    await expectText(page, "What would you like ASAP to handle?");
    if (await page.locator(".asap-ask").count()) throw new Error("Home shows a transcript");
  });
  await step(page, "02-centred-ask-no-space", async () => {
    await page.goto(BASE + "#/ask");
    await settle(page, 600);
    if (await page.locator(".asap-pane").count()) throw new Error("a Space is shown beside a new conversation");
    await page.getByPlaceholder("Tell ASAP what you need").waitFor();
  });

  // 1. Add client: preview, confirm, receipt, Client Space.
  await step(page, "03-add-client-preview", async () => {
    await ask(page, `add ${CLIENT} as a company client`);
    await expectText(page, /I can add .* as a company/);
    await expectText(page, "No message is sent to anyone", lastPending(page));
  });
  await step(page, "04-add-client-receipt", async () => {
    await confirm(page, "Add client");
    await expectText(page, /Audit|audit entry/);
    await expectText(page, CLIENT);
  });

  // A second record keeps its own tab.
  await step(page, "05-second-client-space", async () => {
    await ask(page, "Open Acme Motors");
    await expectText(page, "Acme Motors");
    const tabs = await page.locator("text=" + CLIENT).count();
    if (tabs < 1) throw new Error("the first client's tab was replaced");
  });

  // 2. Quotation lifecycle, without Gmail.
  await step(page, "06-start-quotation-preview", async () => {
    await ask(page, `Start a quotation for ${CLIENT} for a motor fleet of three trucks`);
    await expectText(page, "No insurer is asked", lastPending(page));
  });
  await step(page, "07-quotation-stage-and-next-action", async () => {
    await confirm(page, "Start quotation");
    await expectText(page, "Where this quotation stands");
    await expectText(page, /Next:/);
  });
  await step(page, "08-add-insurer", async () => {
    await ask(page, "Add Jubilee as an insurer to this quotation");
    await confirm(page, "Add insurer");
    await expectText(page, /Jubilee/);
  });
  await step(page, "09-request-approval", async () => {
    await ask(page, "Prepare the request to Jubilee");
    await confirm(page, "Prepare request");
    await expectText(page, /awaiting approval|Approve the request/);
    const body = await page.locator("body").innerText();
    const claimsSent = body.split("\n").filter((l) => /\bsent\b/i.test(l) && !/\b(no|not|nothing|never|isn’t|isn't)\b/i.test(l));
    if (claimsSent.length) throw new Error("a prepared request is called sent: " + claimsSent[0]);
  });
  await step(page, "10-approved-copy-download", async () => {
    await ask(page, "Approve the request to Jubilee");
    await confirm(page, "Approve request");
    await expectText(page, "Copy it into the email or portal");
    await expectText(page, "Download as a text file");
  });
  await step(page, "11-delivery-evidence", async () => {
    const form = page.locator("text=Record how it reached").first().locator("xpath=ancestor::*[.//button][1]");
    await form.locator("select").first().selectOption({ index: 1 }).catch(() => {});
    await form.locator("input, textarea").first().fill("Emailed from Outlook to underwriting at 10:02, ref 7781");
    await form.getByRole("button", { name: "Record delivery" }).click();
    await settle(page, 1500);
    await expectText(page, /With Jubilee/);
  });

  // 3. Claim from Ask in a client's context.
  await step(page, "12-claim-clarification", async () => {
    await ask(page, "Open Acme Motors");
    await ask(page, "Report a claim for the accident yesterday");
    await expectText(page, /Which policy does this claim relate to\?|Report a claim for Acme Motors/);
  });
  await step(page, "13-claim-receipt", async () => {
    const chip = page.getByRole("button", { name: /JUB\/MC|Policy not known yet/ }).first();
    if (await chip.count()) { await chip.click(); await settle(page, 1200); }
    await confirm(page, "Report the claim");
    await expectText(page, "Claim reported as a draft — not registered");
  });
  await step(page, "14-claim-space", async () => {
    await expectText(page, "Draft — not registered");
    await expectText(page, "Documents the claim needs");
    await expectText(page, "Nothing is sent from here");
    await expectText(page, /Next check/);
  });

  // Work: assign and due date, previewed from the server, from the Work item in front.
  await step(page, "15-work-assignment", async () => {
    // Work is the full-width inbox (D-155); its row opens the Work item's Space, and "Ask about
    // this" opens the conversation scoped to it.
    await ask(page, "Show my work");
    await page.getByRole("tablist", { name: "Work views" }).waitFor();
    if (await page.locator(".asap-ask").count()) throw new Error("chat opened with Work");
    // Whichever view holds work: a colleague's items are with them, not in "Needs me".
    const counts = await page.locator(".sh-tab .sh-count").allInnerTexts();
    const at = counts.findIndex((c) => Number(c) > 0);
    if (at < 0) throw new Error("Work is empty");
    await page.getByRole("tab").nth(at).click();
    await page.locator(".sh-work").getByRole("button", { name: /^(Open|Review)$/ }).first().click();
    await settle(page, 1000);
    await page.getByRole("button", { name: "Ask about this" }).click();
    await settle(page, 600);
    await ask(page, "Assign this to Amina");
    await expectText(page, /Owner: .+ → /, lastPending(page));
    await confirm(page, "Assign");
    await expectText(page, /Work assigned|already/);
  });
  await step(page, "16-due-date-change", async () => {
    await ask(page, "Make this due 15 Oct 2026");
    await expectText(page, /Due: .+ → 15 Oct 2026/, lastPending(page));
    await confirm(page, "Change due date");
    await expectText(page, /Due date changed/);
  });

  // A failure with Retry: the save never reaches the server, then does.
  await step(page, "17-failed-action-with-retry", async () => {
    await ask(page, "Make this due 20 Oct 2026");
    await page.route("**/manage", (r) => r.abort());
    await confirm(page, "Change due date");
    await expectText(page, /cannot reach|Nothing was changed/i, lastPending(page));
    page.errors = page.errors.filter((e) => !/ERR_FAILED/.test(e));
    await lastPending(page).getByRole("button", { name: "Retry" }).waitFor({ timeout: 3000 });
  });
  await step(page, "18-retry-succeeds", async () => {
    await page.unroute("**/manage");
    await lastPending(page).getByRole("button", { name: "Retry" }).click();
    await settle(page, 1500);
    await expectText(page, /Due date changed/);
  });

  // Activity for a manager: the person who acted, never "system".
  await step(page, "19-activity-manager-view", async () => {
    await page.evaluate(() => { const el = document.querySelector("body"); return el; });
    await ask(page, "Show activity");
    await page.locator(".sh-activity-row").first().waitFor();
    const body = await page.locator(".sh-activity").innerText();
    if (/\bsystem\b/i.test(body)) throw new Error("an action is attributed to “system”");
  });

  // Renewal Autopilot (D-129): start from Ask, ASAP prepares everything, one approval, then it carries on.
  await step(page, "27-renewal-start-preview", async () => {
    await ask(page, "Prepare the renewal of JUB/MC/2026/0142");
    await expectText(page, "ASAP WILL", lastPending(page));
    await expectText(page, "No message is sent to anyone", lastPending(page));
  });
  await step(page, "28-renewal-stops-safely", async () => {
    await confirm(page, "Start renewal");
    await settle(page, 1500);
    await expectText(page, /Renewal started|already in hand/);
    // D-131: the approval card in the conversation, and the Space's one status and one action.
    // This journey's client has no contact with an email, so the renewal stops safely before any
    // approval is asked for (D-131); approval in chat is covered by e2e/supervision.e2e.mjs.
    await expectText(page, "Stopped safely — information is missing");
    await expectText(page, "Waiting for information: a client contact with an email address");
    await expectText(page, "What ASAP has done");
  });
  await step(page, "29-renewal-blocked-offers-resume", async () => {
    // No bundle exists to approve; the one action is to resume once the contact is added.
    await expectText(page, "I've fixed it — resume");
    if (await page.getByRole("button", { name: "Approve bundle" }).count()) throw new Error("an approval is offered for a bundle that cannot be used");
    const body = await page.locator("body").innerText();
    const claimsSent = body.split("\n").filter((l) => /\bsent\b/i.test(l) && !/\b(no|not|nothing|never|isn’t|isn't)\b/i.test(l));
    if (claimsSent.length) throw new Error("something is called sent: " + claimsSent[0]);
  });

  // Refresh: the same records, the tab restored, nothing from browser storage but a tab address.
  await step(page, "20-refresh-persists", async () => {
    await page.reload();
    await page.getByPlaceholder("Tell ASAP what you need").waitFor({ timeout: 20000 });
    await settle(page, 1500);
    await ask(page, `Which policies does ${CLIENT} have?`);
    await expectText(page, CLIENT);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    const hit = stored.replace(/"asap\.openRef":"[^"]*"/, "").match(/.{0,60}(Parity Freight|premium|incident).{0,60}/i);
    if (hit) throw new Error("business records in browser storage: " + hit[0]);
  });
  await page.context().close();
}

/* ------------------------------------------------ a read-only member is refused, 1440×900 ---- */
{
  const page = await open(READER, { width: 1440, height: 900 });
  await step(page, "21-blocked-action", async () => {
    await ask(page, `add Reader Attempt ${RUN} as a company client`);
    const body = await page.locator("body").innerText();
    if (!/cannot add clients|not permitted|Your role/i.test(body)) {
      const confirmBtn = lastPending(page).getByRole("button", { name: "Add client", exact: true });
      if (await confirmBtn.count()) { await confirmBtn.click(); await settle(page, 1500); }
    }
    await expectText(page, /cannot add clients|not permitted|Your role|You cannot/i);
  });
  await page.context().close();
}

/* ---------------------------------------------------------------- 1360×900 ---- */
{
  const page = await open(AMINA, { width: 1360, height: 900 });
  await step(page, "01-home", async () => { await page.goto(BASE + "#/"); await settle(page, 600); await expectText(page, "What would you like ASAP to handle?"); });
  await step(page, "05-client-space", async () => { await ask(page, "Open Acme Motors"); await expectText(page, "Acme Motors"); });
  await step(page, "19-activity", async () => { await ask(page, "Show activity"); });
  await page.context().close();
}

/* ---------------------------------------------------------------- mobile 390×844 ---- */
{
  const page = await open(AMINA, { width: 390, height: 844 });
  await step(page, "22-mobile-ask", async () => {
    // Ask is the prominent middle action of the bottom navigation (D-155).
    await page.getByRole("navigation", { name: "Main" }).getByRole("button", { name: /Ask/ }).waitFor();
    await page.getByPlaceholder("Tell ASAP what you need").waitFor();
  });
  await step(page, "23-mobile-full-screen-space", async () => {
    await ask(page, "Open Acme Motors");
    await page.getByText(/Open Space/).first().click();
    await settle(page, 600);
    if (await page.getByPlaceholder("Tell ASAP what you need").isVisible()) throw new Error("the Space is not full screen");
    await expectText(page, "Acme Motors");
  });
  await step(page, "24-mobile-return-to-conversation", async () => {
    await page.getByRole("button", { name: /Back to conversation/ }).first().click();
    await settle(page, 600);
    await page.getByPlaceholder("Tell ASAP what you need").waitFor();
  });
  await step(page, "25-mobile-keyboard-focus", async () => {
    await page.getByPlaceholder("Tell ASAP what you need").focus();
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    if (focused !== "TEXTAREA") throw new Error("the composer does not take focus");
  });
  await page.context().close();
}

/* ------------------------------------------------------------ keyboard, 1440×900 ---- */
{
  const page = await open(AMINA, { width: 1440, height: 900 });
  await step(page, "26-keyboard-focus-visible", async () => {
    for (let i = 0; i < 6; i++) await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body) return "none"; const s = getComputedStyle(el); return s.outlineStyle + " " + s.outlineWidth + " " + s.boxShadow; });
    if (/^none 0px none$/.test(outline) || outline === "none") throw new Error("no visible focus: " + outline);
    await page.keyboard.press("Control+k");
    await settle(page, 400);
    await expectText(page, /Search every record/);
    await page.keyboard.press("Escape");
  });
  await page.context().close();
}

await browser.close();
const passed = results.filter((r) => r.ok).length;
process.stdout.write(`\nE2E: ${passed} passed, ${results.length - passed} failed, ${results.length} scenarios\n`);
process.exit(failures ? 1 : 0);
