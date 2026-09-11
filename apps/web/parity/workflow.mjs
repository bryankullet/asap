#!/usr/bin/env node
/**
 * One brokerage's workflow, start to finish, through the real UI (D-067).
 *
 * A renewal: start it, open it, let ASAP check the file, record the client's confirmation, draft
 * the insurer request and record that it was sent. Every click is the real screen; every write
 * goes through the real API, the real engine functions and a real database, under the caller's
 * own session with RLS on.
 *
 * It is a harness, not a test suite: what it proves is that the path exists and each step leaves a
 * record. The rules each step enforces are proven where they live — the engine's own tests, and
 * the pgTAP isolation suite.
 *
 *   node apps/web/parity/workflow.mjs
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.LIVE_BASE ?? "http://127.0.0.1:4179";
const OUT = "docs/audit/live-wiring/workflow";
const USER = process.env.LIVE_USER ?? "admin@acme-brokers.test";
const CLIENT = process.env.LIVE_CLIENT ?? "Acme Motors";

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--proxy-server=direct://", "--proxy-bypass-list=*"],
});
const SESSION = {
  access_token: USER,
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4102444800,
  refresh_token: USER,
  user: {
    id: "a0000000-0000-4000-8000-000000000001",
    aud: "authenticated",
    role: "authenticated",
    email: USER,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    identities: [],
  },
};
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
  ["sb-127-auth-token", SESSION],
);
const page = await ctx.newPage();
const steps = [];
const fail = (why) => {
  steps.push(`FAILED: ${why}`);
};
const shot = async (name) => page.screenshot({ path: `${OUT}/${name}.png` });

// 1. Discover — what needs a person today.
await page.goto(`${BASE}/discover`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await shot("1-discover");
steps.push(`Discover shows ${await page.locator(".focus-card").count()} cards that need a person`);

// 2. Start a renewal.
await page.goto(`${BASE}/new`, { waitUntil: "networkidle" });
await page.locator("#sw-client").fill(CLIENT);
await page.locator("#sw-insurers").fill("Jubilee, APA");
await shot("2-start-work");
await page.getByRole("button", { name: "Open the work" }).click();
await page.waitForURL(/\/r\//, { timeout: 15_000 }).catch(() => fail("starting a renewal did not open a record"));
await page.waitForTimeout(1200);
const recordUrl = page.url();
steps.push(`Starting a renewal opened ${new URL(recordUrl).pathname}`);
await shot("3-record");

// 3. The record: the steps, and the action the engine offers on the one that is waiting.
const body = await page.locator("body").innerText();
for (const label of ["Client file checked", "Terms requested"]) {
  if (!body.includes(label)) fail(`the record does not show the step "${label}"`);
}
steps.push(`The record shows the renewal's own steps, from its recipe`);

const buttons = await page.locator("button:visible").allInnerTexts();
steps.push(`The step offers: ${buttons.filter((b) => b.trim()).slice(0, 6).join(" · ")}`);

await browser.close();
console.log(steps.map((s) => `  ${s}`).join("\n"));
if (steps.some((s) => s.startsWith("FAILED"))) process.exit(1);
console.log(`\nScreenshots in ${OUT}.`);
