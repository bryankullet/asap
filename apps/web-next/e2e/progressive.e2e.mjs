/**
 * The progressive interface, end to end, in headless Chromium (scripts/test-e2e.sh with
 * E2E_APP=apps/web-next). SUPPORTING EVIDENCE ONLY: it is not main-browser acceptance (D-172).
 *
 * Real apps/web-next → real API → supabase-js → PostgREST → disposable PostgreSQL with RLS. A
 * person signs in (a signed session in the browser's storage, exactly where supabase-js keeps it),
 * starts three intentions from Home and gets three different structures, refines them, saves
 * through the governed endpoints, refreshes, goes Back and Forward, and repeats at 390 px. Every page
 * is checked for console errors, horizontal overflow and placeholder text.
 */
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const ORIGIN = process.env.E2E_WEB_ORIGIN;
const OUT = process.env.E2E_SHOTS ?? "apps/web-next/.e2e-shots";
mkdirSync(OUT, { recursive: true });
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const jwt = (c) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...c });
  return `${h}.${b}.${createHmac("sha256", process.env.CONNECTED_JWT_SECRET).update(`${h}.${b}`).digest("base64url")}`;
};
const people = {
  amina: { id: "a0000000-0000-4000-8000-000000000001", email: "amina@connected.test" },
  reader: { id: "c0000000-0000-4000-8000-000000000001", email: "reader@connected.test" },
  beta: { id: "b0000000-0000-4000-8000-000000000001", email: "beta@connected.test" },
};
const RUN = Date.now().toString(36).slice(-5);
const CLIENT = `Progressive Test ${RUN} Ltd`;
const POLICY = `PRG-${RUN}`;

// One policy of Acme Motors ending this month, so the three experiences have real records to use.
const sqlRun = (q) => execFileSync("psql", [process.env.DATABASE_URL, "-X", "-q", "-At", "-c", q], { encoding: "utf8" }).trim();
const today = new Date();
const monthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
const ends = new Date(Math.min(today.getTime() + 5 * 86400000, monthEnd.getTime())).toISOString().slice(0, 10);
const starts = new Date(new Date(ends).getTime() - 360 * 86400000).toISOString().slice(0, 10);
const policyId = sqlRun(`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number) values ('10000000-0000-4000-8000-00000000000a', '70000000-0000-4000-8000-00000000000a', '60000000-0000-4000-8000-00000000000a', 'Commercial motor', '${POLICY}') returning id`).split("\n")[0];
sqlRun(`insert into policy_periods (organization_id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis) values ('10000000-0000-4000-8000-00000000000a', '${policyId}', '${starts}', '${ends}', 1850000, 'KES', 'gross')`);

const results = [];
let failures = 0;
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? "/opt/pw-browsers/chromium" });

async function open(who, viewport) {
  const ctx = await browser.newContext({ viewport });
  const token = jwt({ sub: who.id, email: who.email, role: "authenticated", aud: "authenticated" });
  const session = { access_token: token, refresh_token: "e2e", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: who.id, email: who.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
  await ctx.addInitScript((s) => localStorage.setItem("sb-127-auth-token", JSON.stringify(s)), session);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|status of 40[349]|ERR_CONNECTION_REFUSED|127\.0\.0\.1:9/.test(m.text())) page.errors.push(m.text());
  });
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(`${ORIGIN}/`);
  await page.getByRole("heading", { name: "What would you like ASAP to handle?" }).waitFor({ timeout: 30000 });
  return page;
}
const settle = async (page, ms = 700) => {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(ms);
};
async function checks(page) {
  const body = await page.locator("body").innerText();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const bad = body.match(/\bundefined\b|\bNaN\b|\[object Object\]/);
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
  await page.screenshot({ path: `${OUT}/${vp.width}-${name}.png`, fullPage: true });
  results.push({ name: `${vp.width} ${name}`, ok: problems.length === 0, problems });
  if (problems.length) failures++;
  console.log(`${problems.length ? "✗" : "✓"} ${vp.width} ${name}${problems.length ? ` — ${problems.join("; ")}` : ""}`);
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
async function start(page, text) {
  await page.locator("#intent").fill(text);
  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForURL(/\/x\/[0-9a-f-]{36}$/, { timeout: 20000 });
  await page.locator("[data-experience]").waitFor({ timeout: 20000 });
  await settle(page);
}
async function ask(page, text) {
  await page.locator("#x-ask-input").fill(text);
  await page.getByRole("button", { name: "Ask" }).click();
  await settle(page, 1000);
}
const layoutOf = (page) => page.locator("[data-experience] [data-node=root]").first().getAttribute("class");

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  const page = await open(people.amina, viewport);
  const mobile = viewport.width < 900;
  const name = mobile ? `${CLIENT} M` : CLIENT;

  await step(page, "home", async () => {
    expect(await page.getByText("Needs you").isVisible(), "Needs you section missing");
    expect(await page.getByText("Continue where you left off").isVisible(), "recent work missing");
  });

  let clientUrl = "";
  await step(page, "A1-client-form", async () => {
    await start(page, "Add a new client");
    clientUrl = page.url();
    expect((await layoutOf(page))?.includes("x-l-flow"), "client creation is not a flow");
    expect(await page.getByLabel("Client name").isVisible(), "name field missing");
    expect((await page.getByLabel("Contact's full name").count()) === 0, "contact shown before asked for");
  });
  await step(page, "A2-progressive-and-refresh", async () => {
    await page.getByLabel("Client name").fill(name);
    await page.getByRole("radio", { name: "A company" }).check({ force: true });
    await page.getByRole("button", { name: /Add the primary contact now/ }).click();
    await page.getByLabel("Contact's full name").fill("Grace Wanjiku");
    await page.waitForTimeout(1200); // the draft is saved with the experience
    await page.reload();
    await page.getByLabel("Client name").waitFor();
    expect((await page.getByLabel("Client name").inputValue()) === name, "the draft did not survive refresh");
    expect((await page.getByLabel("Contact's full name").inputValue()) === "Grace Wanjiku", "the contact draft did not survive refresh");
  });
  await step(page, "A3-saved", async () => {
    await page.getByRole("button", { name: "Add the client" }).click();
    // A similar name already on file (the desktop pass added one) opens the duplicate review first.
    const dup = page.getByText("A client with a similar name is already on file.");
    if (await dup.waitFor({ timeout: 4000 }).then(() => true).catch(() => false)) await page.getByRole("button", { name: /It is a different client/ }).click();
    await page.getByText(`${name} is on file`).waitFor({ timeout: 15000 });
    const rows = execFileSync("psql", [process.env.DATABASE_URL, "-X", "-At", "-c", `select count(*) from clients where name = '${name.replace(/'/g, "''")}'`], { encoding: "utf8" }).trim();
    expect(rows === "1", `expected one client row, found ${rows}`);
    await page.reload();
    await page.getByText(`${name} is on file`).waitFor({ timeout: 15000 });
  });

  await step(page, "B1-explore-table", async () => {
    await page.getByRole("link", { name: "ASAP" }).click();
    await start(page, "Show me motor policies expiring this month");
    expect((await layoutOf(page))?.includes("x-l-table"), "exploration is not a table");
    await page.getByRole("table").getByText(POLICY).waitFor({ timeout: 10000 });
  });
  await step(page, "B2-select-detail", async () => {
    await page.getByRole("table").getByText(POLICY).click();
    await settle(page, 1000);
    await page.locator("[data-component=RecordDetail]").getByText("Acme Motors").waitFor({ timeout: 10000 });
    expect(await page.locator("[data-component=RecordDetail]").getByText("KES 1,850,000.00").isVisible(), "expiring premium missing in detail");
  });
  await step(page, "B3-refine-overdue", async () => {
    await ask(page, "only show overdue renewals");
    await page.getByText("Overdue only").waitFor({ timeout: 10000 });
    expect((await page.getByRole("table").getByText(POLICY).count()) === 0, "a future period is listed as overdue");
    await page.reload();
    await page.getByText("Overdue only").waitFor({ timeout: 10000 });
  });
  await step(page, "B4-back-forward", async () => {
    // Back returns to where the person came from (Home), Forward to the work — with its refinement.
    const exploreUrl = page.url();
    await page.goBack();
    await page.getByRole("heading", { name: "What would you like ASAP to handle?" }).waitFor({ timeout: 10000 });
    await page.goForward();
    await page.waitForURL(exploreUrl, { timeout: 10000 });
    await page.getByText("Overdue only").waitFor({ timeout: 10000 });
    // The earlier client work is still there to resume.
    await page.goto(clientUrl);
    await page.getByText(`${name} is on file`).waitFor({ timeout: 15000 });
    await page.goto(exploreUrl);
    await page.getByText("Overdue only").waitFor({ timeout: 10000 });
  });
  await step(page, "C1-renew-resolve", async () => {
    await page.getByRole("link", { name: "ASAP" }).click();
    await start(page, "Help me renew Acme's motor fleet");
    if (await page.locator("[data-component=RecordChoice]").count()) {
      await page.getByRole("listitem").filter({ hasText: POLICY }).first().click();
      await settle(page, 1200);
    }
    await page.locator("[data-component=GovernedAction], [data-component=ContextSummary]").first().waitFor({ timeout: 15000 });
  });
  await step(page, "C2-start-confirmed", async () => {
    if (await page.locator("[data-component=GovernedAction]").count()) {
      await page.locator("[data-component=GovernedAction]").getByRole("button", { name: "Start the renewal" }).click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor();
      expect(await dialog.getByText(/Nothing is sent/).isVisible(), "confirmation does not say what happens");
      await dialog.getByRole("button", { name: "Start the renewal" }).click();
    }
    await page.locator("[data-component=Milestones]").waitFor({ timeout: 20000 });
    expect((await layoutOf(page)) !== null, "no layout");
  });
  await step(page, "C3-ask-focus", async () => {
    await ask(page, "What is blocking this renewal?");
    expect((await layoutOf(page))?.includes("x-l-focus"), "asking did not recompose around a focus");
    await page.locator("[data-component=Answer]").waitFor({ timeout: 10000 });
    await ask(page, "go back");
    expect(!(await layoutOf(page))?.includes("x-l-focus"), "go back did not return");
  });
  await step(page, "C4-switch-keeps-work", async () => {
    const renewUrl = page.url();
    await ask(page, "Add a new client");
    await page.waitForURL((u) => u.toString() !== renewUrl, { timeout: 10000 });
    await page.getByLabel("Client name").waitFor({ timeout: 10000 });
    await page.goBack();
    await page.locator("[data-component=Milestones]").waitFor({ timeout: 15000 });
  });
  await page.context().close();
}

// A read-only member: the form says why it cannot save, and the endpoint refuses independently.
{
  const page = await open(people.reader, { width: 1440, height: 900 });
  await step(page, "R1-reader-cannot-add", async () => {
    await start(page, "Add a new client");
    await page.getByText(/cannot add clients/).first().waitFor({ timeout: 10000 });
    const status = await page.evaluate(async ({ api, token }) => (await fetch(`${api}/clients`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Reader Attempt Ltd", kind: "corporate" }) })).status, { api: process.env.CONNECTED_API_URL, token: jwt({ sub: people.reader.id, email: people.reader.email, role: "authenticated", aud: "authenticated" }) });
    expect(status === 403, `the API accepted a read-only write (${status})`);
  });
  await page.context().close();
}

// Another brokerage cannot open this brokerage's experience by its address.
{
  const page = await open(people.beta, { width: 1440, height: 900 });
  await step(page, "T1-tenant-isolation", async () => {
    const id = execFileSync("psql", [process.env.DATABASE_URL, "-X", "-At", "-c", "select id from experience_sessions where organization_id = '10000000-0000-4000-8000-00000000000a' order by created_at desc limit 1"], { encoding: "utf8" }).trim();
    await page.goto(`${ORIGIN}/x/${id}`);
    await page.getByRole("heading", { name: "Not available" }).waitFor({ timeout: 15000 });
  });
  await page.context().close();
}

await browser.close();
console.log(`\n${results.length - failures} of ${results.length} steps passed; screenshots in ${OUT}`);
process.exit(failures ? 1 : 0);
