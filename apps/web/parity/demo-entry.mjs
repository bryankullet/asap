#!/usr/bin/env node
/**
 * The deployed-entry check: does the *production build* of the demonstration open for a stranger?
 *
 * The unit tests prove the route tree; this proves the artefact. It opens a fresh browser context
 * with no cookies, no localStorage and no session — an incognito window — hits every demo
 * destination on a real server, and fails if any of them redirects to sign-in, renders no shell,
 * shows no presenter bar, or calls the API.
 *
 *   node apps/web/parity/demo-entry.mjs            # against PARITY_REACT (default :4177)
 *   DEMO_BASE=https://asap-web.onrender.com node apps/web/parity/demo-entry.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.DEMO_BASE ?? process.env.PARITY_REACT ?? "http://127.0.0.1:4177";

const ROUTES = [
  "/",
  "/discover",
  "/ask",
  "/work",
  "/work?view=waiting",
  "/jobs",
  "/automations",
  "/search",
  "/new",
  "/email",
  "/documents",
  "/audit",
  "/settings/connections",
  "/work/w-acme-kdn",
  "/jobs/j-meridian-confirm",
  "/automations/a-servicing",
];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM ?? "/opt/pw-browsers/chromium",
  args: ["--no-sandbox", "--proxy-server=direct://", "--proxy-bypass-list=*"],
});

const failures = [];
for (const route of ROUTES) {
  // A brand new context each time: no cookies, no storage, nothing carried from the last route.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  /*
   * Any call to a service is a defect in demo mode, whatever it returns. The webfont stylesheet
   * is the one exception: it is the page's own typography, not the brokerage's data.
   */
  const FONTS = ["https://fonts.googleapis.com/", "https://fonts.gstatic.com/"];
  const apiCalls = [];
  page.on("request", (r) => {
    const url = r.url();
    const own = url.startsWith(BASE) || url.startsWith("data:") || url.startsWith("blob:");
    if (!own && !FONTS.some((f) => url.startsWith(f))) apiCalls.push(`${r.method()} ${url}`);
  });

  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);

  const landed = new URL(page.url()).pathname;
  const shell = await page.locator('nav[aria-label="Main"]').count();
  const bar = await page.getByText("DEMO MODE").count();
  const problems = [];
  if (landed === "/sign-in") problems.push(`redirected to /sign-in`);
  if (shell === 0) problems.push("no shell");
  if (bar === 0) problems.push("no presenter bar");
  if (apiCalls.length > 0) problems.push(`called out: ${apiCalls.join(", ")}`);

  console.log(`  ${route.padEnd(30)} → ${landed.padEnd(28)} ${problems.length ? "FAILED: " + problems.join("; ") : "ok"}`);
  if (problems.length) failures.push(`${route}: ${problems.join("; ")}`);
  await ctx.close();
}

// And the reload case: a demo route refreshed in place must stay in the demonstration.
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto(`${BASE}/work?view=review`, { waitUntil: "networkidle" });
await page.reload({ waitUntil: "networkidle" });
const after = new URL(page.url()).pathname;
console.log(`  ${"reload /work".padEnd(30)} → ${after.padEnd(28)} ${after === "/work" ? "ok" : "FAILED"}`);
if (after !== "/work") failures.push("a reloaded demo route did not stay in the demonstration");
await ctx.close();

await browser.close();

if (failures.length) {
  console.error("\nThe demonstration does not open for a stranger:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("\nEvery demo destination opened with no session, no cookie and no API call.");
