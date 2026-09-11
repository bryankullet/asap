#!/usr/bin/env node
/**
 * The live-wiring harness: the approved screens, on real records.
 *
 * It drives a production-mode build (demo mode **off**) against the real Hono API, which reads a
 * real, fully migrated, seeded PostgreSQL through `packages/db/scripts/dev-supabase-stub.mjs`.
 * Every card, count and sentence in the screenshots it writes came out of a database row.
 *
 * What it does not prove, and says so: RLS is not exercised (the stand-in connects as the owner —
 * `pnpm test:rls` is what proves isolation, 395 pgTAP assertions against the same database), and
 * the session is a stand-in token rather than a verified JWT.
 *
 *   node apps/web/parity/live-wiring.mjs      # LIVE_BASE (default :4179)
 *
 * See docs/audit/live-wiring/README.md for how to bring the four processes up.
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.LIVE_BASE ?? "http://127.0.0.1:4179";
const OUT = "docs/audit/live-wiring";
const USER = process.env.LIVE_USER ?? "admin@acme-brokers.test";

const SCREENS = [
  ["Discover", "/discover"],
  ["Work-active", "/work?view=active"],
  ["Work-waiting", "/work?view=waiting"],
  ["Jobs", "/jobs?filter=all"],
  ["Automations", "/automations"],
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--proxy-server=direct://", "--proxy-bypass-list=*"],
});

/** A session as the browser stores it. The stand-in accepts a seeded user's email as its token. */
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
      /* private mode: the harness still runs, it just signs in again */
    }
  },
  ["sb-127-auth-token", SESSION],
);

const page = await ctx.newPage();
const failures = [];
page.on("pageerror", (e) => failures.push(`page error: ${e.message.slice(0, 200)}`));

for (const [name, route] of SCREENS) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });

  const body = await page.locator("body").innerText();
  // The failure states the screens are designed to show. Any of them means the wiring is not up.
  for (const bad of [
    "We cannot reach the ASAP service",
    "Your session is no longer valid",
    "This deployment is part-upgraded",
    "different builds",
    "ASAP could not start",
  ]) {
    if (body.includes(bad)) failures.push(`${name}: ${bad}`);
  }
  // The demonstration must not be anywhere near a production-mode build.
  if (body.includes("DEMO MODE")) failures.push(`${name}: the presenter bar is in a live build`);
  for (const fictional of ["Acme Manufacturing Ltd", "Karibu Logistics", "Bluewave Properties"]) {
    if (body.includes(fictional)) failures.push(`${name}: fictional fixture "${fictional}" on screen`);
  }
  console.log(`  ${name.padEnd(14)} ${body.replace(/\n+/g, " | ").slice(0, 160)}`);
}

await browser.close();

if (failures.length > 0) {
  console.error("\nThe live wiring is not up:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nEvery screen rendered real records. Screenshots in ${OUT}.`);
