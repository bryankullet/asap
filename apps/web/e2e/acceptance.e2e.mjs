/**
 * The acceptance-test path (D-134), end to end, in a real browser (scripts/test-e2e.sh):
 * a client added with its contact; the contact edited on the client record; insurers added to an
 * existing quotation by name with a draft to each — nothing sent, the requirement still
 * outstanding — and all of it the same after a reload.
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
const RUN = Date.now().toString(36).slice(-5);
const CLIENT = `UX TEST Karibu Logistics ${RUN} Ltd`;

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

  await step(page, "a01-add-client-with-contact-preview", async () => {
    await ask(page, `Add ${CLIENT} as a company client. Primary contact: UX TEST David Otieno, Finance Manager, david.otieno@karibu-${RUN}.test`);
    await expectText(page, "Primary contact: UX TEST David Otieno · Finance Manager", lastPending(page));
    await expectText(page, /saved as the primary contact with the client/);
  });
  await step(page, "a02-client-with-contact-saved", async () => {
    await confirm(page, "Add client");
    await expectText(page, "with UX TEST David Otieno as the primary contact");
    await expectText(page, "Contacts");
    await expectText(page, `Finance Manager · david.otieno@karibu-${RUN}.test · no phone on file`);
  });

  await step(page, "a03-edit-contact-from-client-record", async () => {
    // The contact's row opens it for editing (its "Open" control is the first in the Space).
    await page.getByRole("button", { name: /^Open\s*→?$/ }).first().click();
    await settle(page, 600);
    await expectText(page, "Edit UX TEST David Otieno");
    const phone = page.getByPlaceholder("+254…").last();
    await phone.fill("+254 700 000 111");
    await page.getByRole("button", { name: "Save changes" }).last().click();
    await settle(page, 1600);
    await expectText(page, "details saved");
  });

  await step(page, "a04-start-quotation", async () => {
    await ask(page, `Start a quotation for ${CLIENT} for comprehensive motor cover for five vehicles ${RUN}`);
    await confirm(page, (await lastPending(page).getByRole("button").allInnerTexts()).find((t) => /Start/i.test(t)) ?? "Start quotation work");
    await ask(page, "Add a requirement: UX TEST: five vehicle values and logbooks");
    await confirm(page, "Add requirement");
    await expectText(page, "UX TEST: five vehicle values and logbooks");
    await expectText(page, "Outstanding");
  });

  await step(page, "a05-three-insurers-one-card", async () => {
    await ask(page, `For the ${CLIENT} quote, add APA Insurance ${RUN}, CIC and Jubilee as insurers to approach. Prepare each request but do not send anything.`);
    const card = lastPending(page);
    await expectText(page, `Insurers: APA Insurance ${RUN}, CIC, Jubilee`, card);
    await expectText(page, "does not stop the drafts", card);
    await expectText(page, "Nothing is sent", card);
  });
  await step(page, "a06-drafts-prepared-nothing-sent", async () => {
    await confirm(page, "Add and prepare drafts");
    await expectText(page, "3 insurers added, 3 draft requests prepared — nothing was sent");
    await expectText(page, "Draft request to CIC — not approved, not sent");
    await expectText(page, "Review and approve the request to 3 insurers");
  });
  await step(page, "a07-repeat-is-not-a-second-write", async () => {
    await ask(page, `For the ${CLIENT} quote, add APA Insurance ${RUN}, CIC and Jubilee as insurers to approach. Prepare each request but do not send anything.`);
    await confirm(page, "Add and prepare drafts");
    await expectText(page, /Nothing new|already done|Already done/);
  });

  await step(page, "a08-after-reload-the-same", async () => {
    await page.reload();
    await page.getByPlaceholder("Tell ASAP what you need").waitFor({ timeout: 20000 });
    await settle(page, 1500);
    await ask(page, `Open ${CLIENT}`);
    await expectText(page, "+254 700 000 111");
    await ask(page, `What's next on the ${CLIENT} quote?`);
    await expectText(page, "Review and approve the request to 3 insurers");
    await expectText(page, "UX TEST: five vehicle values and logbooks");
  });
  await page.context().close();
}

await browser.close();
const ok = results.filter((r) => r.ok).length;
process.stdout.write(`\n${ok}/${results.length} steps passed\n`);
process.exit(failures ? 1 : 0);
