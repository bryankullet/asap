/**
 * Chat attachments and setup (D-132), end to end:  E2E_SCRIPT=apps/web/e2e/onboarding.e2e.mjs …
 * Files are attached through the + picker (several at once, one unsupported, one malformed CSV),
 * their cards show truthful states, the Setup Space agrees, a refresh keeps it, and the phone
 * layout works. No extractor runs here, so documents must stay "waiting to be read" — never "read".
 *
 * (Header kept from the supervision script:)
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
const DB = process.env.CONNECTED_OWNER_URL;
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots/onboarding";
mkdirSync(OUT, { recursive: true });
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const jwt = (c) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...c });
  return `${h}.${b}.${createHmac("sha256", process.env.CONNECTED_JWT_SECRET).update(`${h}.${b}`).digest("base64url")}`;
};
const AMINA = jwt({ sub: "a0000000-0000-4000-8000-000000000001", email: "amina@connected.test", role: "authenticated", aud: "authenticated" });
const TAG = Date.now().toString(36).slice(-5).toUpperCase();

const sql = (q) => execFileSync("psql", [DB, "-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();

/* ------------------------------------------------------------------------------ the browser */
const results = [];
let failures = 0;
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? "/opt/pw-browsers/chromium" });
async function open(viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript((t) => { window.__E2E_TOKEN = t; }, AMINA);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource: the server responded with a status of (404|409|422|503)/.test(m.text())) page.errors.push(m.text()); });
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
// D-155: the address is the surface — a Space opens beside the conversation at its own address.
const packRef = (ref) => {
  const q = new URLSearchParams(Object.entries(ref).filter(([k, v]) => k !== "ws" && v != null).map(([k, v]) => [k, String(v)])).toString();
  return ref.ws + (q ? "?" + q : "");
};
const openRef = async (page, ref) => {
  const conv = (new URL(page.url()).hash.match(/^#\/ask\/([0-9a-f-]{36})/) || [])[1];
  await page.goto(process.env.E2E_URL.replace(/#.*$/, "") + `#/ask${conv ? "/" + conv : ""}?space=` + encodeURIComponent(packRef(ref)));
  await page.reload();
  await page.getByPlaceholder("Tell ASAP what you need").waitFor({ timeout: 30000 });
  await settle(page, 1800);
};


const csv = { name: `book-${TAG}.csv`, mimeType: "text/csv", buffer: Buffer.from(`client_name,policy_number,insurer,class_of_business,period_start,period_end,premium\nSimba ${TAG} Traders,ST-${TAG},Jubilee,Motor,2026-01-01,2026-12-31,120000\n`) };
const pdf = (n) => ({ name: `schedule-${n}-${TAG}.pdf`, mimeType: "application/pdf", buffer: Buffer.from(`%PDF-1.4\n% schedule ${n} ${TAG}\n`) });
const bad = { name: `notes-${TAG}.docx`, mimeType: "application/octet-stream", buffer: Buffer.from("not a pdf") };
const broken = { name: `broken-${TAG}.csv`, mimeType: "text/csv", buffer: Buffer.from("") };

for (const w of [1440, 390]) {
  const page = await open({ width: w, height: w === 390 ? 844 : 900 });
  await step(page, "01-attach-menu", async () => {
    await page.getByRole("button", { name: "Add files or records" }).click();
    await settle(page, 600);
    await expectText(page.locator("body"), "Upload documents");
    await expectText(page.locator("body"), "Connect email (optional, not needed yet)");
  });
  await step(page, "02-documents-attached-truthful-state", async () => {
    await page.locator(".asap-attach-input").setInputFiles([pdf(w + "a"), pdf(w + "b"), bad]);
    await settle(page, 3000);
    // Locally there is no file store, so the truthful state is "could not read"; hosted, "reading".
    await expectText(lastPending(page), /Reading 2 files…|Could not read 2 files/);
    await expectText(page.locator("body"), /is not a file ASAP reads/);
    const t = await lastPending(page).innerText();
    if (/ — Read\b/.test(t)) throw new Error("a file is shown as read before extraction finished");
  });
  await step(page, "03-same-file-again-not-stored-twice", async () => {
    await page.locator(".asap-attach-input").setInputFiles([pdf(w + "a")]);
    await settle(page, 3000);
    await expectText(lastPending(page), "already on file");
  });
  await step(page, "04-malformed-spreadsheet-fails-clearly", async () => {
    await page.locator(".asap-attach-input").setInputFiles([broken]);
    await settle(page, 3000);
    await expectText(page.locator("body"), /could not be read|no columns|empty/i);
  });
  await step(page, "05-spreadsheet-preview-card", async () => {
    await page.locator(".asap-attach-input").setInputFiles([csv]);
    await settle(page, 3500);
    await expectText(page.locator("body"), /I found 1 client and 1 policy/);
  });
  await step(page, "06-setup-space", async () => {
    await openRef(page, { ws: "setup" });
    if (w === 390) { const b = page.getByRole("button", { name: /Open Space/ }); if (await b.count()) await b.first().click(); await settle(page, 800); }
    await expectText(page.locator("body"), /Setup · \d of 4 done|Your book is in/);
  });
  await step(page, "07-typed-import-request", async () => {
    if (w === 390) { const b = page.getByRole("button", { name: /Back to conversation/ }); if (await b.count()) await b.first().click(); else await page.goBack(); await settle(page, 800); }
    await ask(page, "Import these policy schedules");
    await expectText(page.locator("body"), "Choose files");
  });
}
const sends = Number(sql("select count(*) from email_send_attempts"));
if (sends !== 0) { failures += 1; process.stdout.write(`✗ ${sends} email send attempts\n`); } else process.stdout.write("✓ no email send attempts — Gmail stays optional and disconnected\n");
const dup = Number(sql(`select count(*) from documents where filename = 'schedule-1440a-${TAG}.pdf'`));
if (dup !== 1) { failures += 1; process.stdout.write(`✗ the same file is stored ${dup} times\n`); } else process.stdout.write("✓ the same file is stored once\n");
await browser.close();
process.stdout.write(`\n${results.length - failures} of ${results.length} steps passed; screenshots in ${OUT}\n`);
process.exit(failures ? 1 : 0);
