#!/usr/bin/env node
/**
 * A brand-new brokerage, from the first screen (D-068).
 *
 * A person who has just signed up: no brokerage, no clients, no policies, no work. This walks the
 * path they actually take — land, create the brokerage, then look at every screen — and captures
 * what each one says when there is genuinely nothing in it.
 *
 * An empty screen is a designed state (§36), not an absence: it has to say what is missing, why,
 * and what to do. This harness fails if any screen is blank, shows a failure state, or shows a
 * fictional record.
 *
 *   node apps/web/parity/onboarding.mjs
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.LIVE_BASE ?? "http://127.0.0.1:4179";
const OUT = "docs/audit/live-wiring/onboarding";
const USER = process.env.NEW_USER ?? "new.broker@fresh.test";
const USER_ID = process.env.NEW_USER_ID ?? "f0000000-0000-4000-8000-0000000000f1";

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--proxy-server=direct://", "--proxy-bypass-list=*"],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  reducedMotion: "reduce",
});
await ctx.addInitScript(
  ([k, v]) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* private mode */
    }
  },
  [
    "sb-127-auth-token",
    {
      access_token: USER,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: 4102444800,
      refresh_token: USER,
      user: {
        id: USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: USER,
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: {},
        created_at: "2026-09-01T00:00:00Z",
        updated_at: "2026-09-01T00:00:00Z",
        identities: [],
      },
    },
  ],
);

const page = await ctx.newPage();
const notes = [];
const failures = [];
const look = async (name, route) => {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim();
  const landed = new URL(page.url()).pathname;
  notes.push(`${name.padEnd(16)} ${landed.padEnd(22)} ${text.slice(0, 120)}`);
  if (text.length < 40) failures.push(`${name}: the screen is effectively blank`);
  for (const bad of [
    "We cannot reach the ASAP service",
    "Your session is no longer valid",
    "This deployment is part-upgraded",
    "ASAP could not start",
    "Acme Manufacturing Ltd",
    "Karibu Logistics",
    "DEMO MODE",
  ]) {
    if (text.includes(bad)) failures.push(`${name}: "${bad}"`);
  }
  return text;
};

// 1. A person with no brokerage lands on the create-or-join path, not on an empty Discover.
const landing = await look("1-first-landing", "/discover");
if (!/brokerage/i.test(landing)) {
  failures.push("a person with no brokerage is not offered one");
}

// 2. Create the brokerage. This is the first thing a new brokerage does, and it is a real write:
//    app.create_organization seeds the nine system roles and makes this person its owner.
await page.goto(`${BASE}/onboarding/create`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
const nameField = page.locator('input#name, input[name="name"]').first();
if ((await nameField.count()) === 0) {
  failures.push("the create-a-brokerage form has no name field");
} else {
  await nameField.fill(process.env.NEW_ORG ?? "Fresh Start Insurance Brokers");
  const terms = page.locator('input[type="checkbox"]');
  for (let i = 0; i < (await terms.count()); i++) await terms.nth(i).check().catch(() => {});
  await page.screenshot({ path: `${OUT}/2-create-brokerage.png` });
  await page.getByRole("button", { name: /Create/i }).first().click();
  await page.waitForTimeout(2500);
  notes.push(`create           ${new URL(page.url()).pathname.padEnd(22)} after creating the brokerage`);
}

// 3. Every screen, with nothing in it yet. An empty screen has to say what is missing and why.
for (const [name, route] of [
  ["3-discover", "/discover"],
  ["4-work", "/work?view=active"],
  ["5-jobs", "/jobs?filter=all"],
  ["6-automations", "/automations"],
  ["7-start-work", "/new"],
  ["8-clients", "/files"],
  ["9-team", "/settings/members"],
]) {
  await look(name, route);
}

await browser.close();
console.log(notes.map((n) => `  ${n}`).join("\n"));
if (failures.length) {
  console.error("\nThe first run is not honest yet:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nScreenshots in ${OUT}.`);
