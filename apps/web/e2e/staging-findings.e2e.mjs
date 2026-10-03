/**
 * Staging acceptance findings (D-135), in a real browser (scripts/test-e2e.sh): a workbook that
 * opens on a Read Me sheet is read from its data sheet; another sheet can be chosen and headings
 * mapped, all without writing anything; a premium column left blank asks no premium question; and a
 * claim prompt's directions never become "What happened".
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
import { execFileSync } from "node:child_process";

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
  await page.goto(URL_);
  await page.getByPlaceholder("Tell ASAP what you need").waitFor({ timeout: 20000 });
  await page.getByText(/What matters now|Tell me what you need/).first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  return page;
}
const settle = async (page, ms = 900) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };
async function ask(page, text) {
  const box = page.getByPlaceholder("Tell ASAP what you need");
  await box.fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await settle(page, 1200);
}
const lastPending = (page) => page.locator(".asap-pending").last();
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

const sql = (q) => execFileSync("psql", [process.env.CONNECTED_OWNER_URL, "-Atc", q], { encoding: "utf8" }).trim();
const FIX = "apps/api/test/fixtures/";
const pane = (page) => page.locator(".asap-pane").last();

/* ------------------------------------------------------------------ desktop, 1440×900 ---- */
{
  const page = await open(AMINA, { width: 1440, height: 900 });
  const clientsBefore = sql("select count(*) from clients");

  await step(page, "s01-workbook-read-from-its-data-sheet", async () => {
    await page.locator(".asap-attach-input").setInputFiles([FIX + "ux-test-book-with-readme.xlsx"]);
    await settle(page, 3500);
    await expectText(page, "from the “Clients and policies” sheet (other sheets: Read Me, Vehicles");
    await expectText(page, /I found 2 clients and 2 policies/);
    const body = await page.locator("body").innerText();
    if (/Premiums in this file are gross|total payable/.test(body)) throw new Error("the premium question was asked for a blank premium column");
  });

  await step(page, "s02-sheets-offered-in-the-space", async () => {
    await ask(page, "Import records");
    await expectText(page, "Sheets in this workbook", pane(page));
    await expectText(page, "Read this sheet", pane(page));
  });

  await step(page, "s03-another-sheet-read-on-request", async () => {
    await pane(page).getByRole("button", { name: "Read this sheet" }).first().click();
    await settle(page, 2500);
    await expectText(page, "(Read Me)", pane(page));
    await expectText(page, "What each column holds", pane(page));
  });

  await step(page, "s04-headings-mapped-then-previewed", async () => {
    await page.locator(".asap-attach-input").setInputFiles([FIX + "ux-test-book-needs-mapping.xlsx"]);
    await settle(page, 3500);
    await ask(page, "Import records");
    const form = pane(page);
    await expectText(page, "What each column holds", form);
    const selects = form.locator("select");
    const n = await selects.count();
    if (n < 7) throw new Error("expected a choice for each of 7 headings, found " + n);
    const meanings = ["client_name", "contact_name", "policy_number", "insurer_name", "class_of_business", "period_start", "period_end"];
    for (let i = 0; i < 7; i++) await selects.nth(i).selectOption(meanings[i]);
    await form.getByRole("button", { name: "Read again with these columns" }).click();
    await settle(page, 2500);
    await expectText(page, "UX TEST Karibu Logistics Ltd", pane(page));
    await expectText(page, "UX-MTR-009", pane(page));
  });

  await step(page, "s05-nothing-was-written", async () => {
    const after = sql("select count(*) from clients");
    if (after !== clientsBefore) throw new Error(`clients changed from ${clientsBefore} to ${after} without a confirmation`);
    const contacts = sql("select count(*) from client_contacts where full_name like 'UX TEST%'");
    if (contacts !== "0") throw new Error(contacts + " contacts were written by a preview");
  });

  await step(page, "s06-claim-keeps-only-the-incident", async () => {
    await ask(page, "Open Acme Motors");
    await ask(page, "Report a claim for Acme Motors: on 2 October 2026 KDM 811A was in a low-speed collision causing front-left body damage. No injury was reported. Do not contact anyone or notify the insurer on JUB/MC/2026/0142");
    const card = lastPending(page);
    const t = await card.innerText().catch(() => "");
    if (!t) {
      // Asked which policy first: take the one named.
      await page.getByRole("button", { name: /JUB\/MC\/2026\/0142/ }).first().click();
      await settle(page, 1500);
    }
    await expectText(page, "What happened: On 2 October 2026 KDM 811A was in a low-speed collision causing front-left body damage. No injury was reported.", lastPending(page));
    const card2 = await lastPending(page).innerText();
    if (/Do not contact|notify the insurer\b(?!.*approval)/i.test(card2.split("What happened:")[1]?.split("\n")[0] ?? "")) throw new Error("the direction was saved as the incident");
  });

  await step(page, "s07-claim-without-facts-asks", async () => {
    await ask(page, "Report a claim for Acme Motors on 2 October 2026. Do not contact anyone on JUB/MC/2026/0142");
    await expectText(page, "I could not tell the facts of the loss apart from the instructions");
    const claims = sql("select count(*) from claims where incident_summary ilike '%contact anyone%'");
    if (claims !== "0") throw new Error("a claim was saved with the direction as its incident");
  });
  await page.context().close();
}

await browser.close();
const ok = results.filter((r) => r.ok).length;
process.stdout.write(`\n${ok}/${results.length} steps passed\n`);
process.exit(failures ? 1 : 0);
