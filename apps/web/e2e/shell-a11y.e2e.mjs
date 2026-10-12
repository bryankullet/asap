/**
 * Accessibility across the whole authenticated shell (D-168), in a real browser against the real API:
 * every destination, sheet and palette at desktop and phone widths has no serious or critical axe-core
 * violation (WCAG 2.1 A/AA rules), shows a visible focus indicator when reached by keyboard, and runs no
 * animation when the person asks for reduced motion.
 */
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.E2E_URL.replace(/#.*$/, "");
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots/shell-a11y";
mkdirSync(OUT, { recursive: true });
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
const jwt = (c) => {
  const h = b64({ alg: "HS256", typ: "JWT" });
  const b = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...c });
  return `${h}.${b}.${createHmac("sha256", process.env.CONNECTED_JWT_SECRET).update(`${h}.${b}`).digest("base64url")}`;
};
const AMINA = jwt({ sub: "a0000000-0000-4000-8000-000000000001", email: "amina@connected.test", role: "authenticated", aud: "authenticated" });
const ACME = "70000000-0000-4000-8000-00000000000a";
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const results = [];
let failures = 0;
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? "/opt/pw-browsers/chromium" });
const settle = async (page, ms = 900) => { await page.waitForLoadState("networkidle").catch(() => {}); await page.waitForTimeout(ms); };

async function open(viewport, reducedMotion = "no-preference") {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900, reducedMotion });
  await ctx.addInitScript((t) => { window.__E2E_TOKEN = t; }, AMINA);
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(String(e)));
  await page.goto(BASE + "#/");
  await page.locator(".sh-root").waitFor({ timeout: 30000 });
  await page.locator(".sh-loading").waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
  return page;
}
async function axe(page) {
  if (!(await page.evaluate(() => Boolean(window.axe)))) await page.addScriptTag({ content: AXE });
  return page.evaluate(async (detail) => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
    return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ") + (detail ? ` [${(n.any[0]?.message ?? n.failureSummary ?? "").slice(0, 160)} | ${n.html.slice(0, 120)}]` : "")).join(", ")}`);
  }, process.env.A11Y_DETAIL === "1");
}
/** Tabs into the page and checks the focused control is drawn as focused. */
async function focusVisible(page, presses = 3) {
  const missing = [];
  for (let i = 0; i < presses; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      // Drawn if the control, or a container within three levels, looks different focused than not:
      // a ring on a composer box counts; a card's permanent shadow does not.
      const chain = [el, el.parentElement, el.parentElement?.parentElement, el.parentElement?.parentElement?.parentElement].filter(Boolean);
      const look = () => chain.map((x) => { const c = getComputedStyle(x); return [c.outlineStyle, c.outlineWidth, c.boxShadow, c.borderColor, c.backgroundColor].join("|"); });
      const focused = look();
      el.blur();
      const blurred = look();
      el.focus({ preventScroll: true });
      const drawn = focused.some((f, i) => f !== blurred[i]);
      return { drawn, what: `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""} “${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}”` };
    });
    if (r && !r.drawn) missing.push(r.what);
  }
  return missing;
}
async function step(page, name, fn) {
  const problems = [];
  try { await fn(problems); } catch (e) { problems.push(String(e.message ?? e).split("\n")[0]); }
  if (page.errors.length) problems.push(`page error: ${page.errors.splice(0).join(" | ").slice(0, 200)}`);
  const vp = page.viewportSize();
  await page.screenshot({ path: `${OUT}/${vp.width}-${name}.png` });
  results.push({ step: `${vp.width} ${name}`, ok: !problems.length, problems });
  if (problems.length) failures++;
  process.stdout.write(`${problems.length ? "✗" : "✓"} ${vp.width} ${name}${problems.length ? " — " + problems.join("; ") : ""}\n`);
}
const audit = async (page, problems, { keyboard = true } = {}) => {
  const v = await axe(page);
  if (v.length) problems.push(`axe: ${v.join(" | ")}`);
  if (keyboard) {
    const m = await focusVisible(page);
    if (m.length) problems.push(`no visible focus on: ${m.join(", ")}`);
  }
};

const DESTINATIONS = [
  ["home", "#/"],
  ["work-needs-me", "#/work"],
  ["work-handling", "#/work?view=handling"],
  ["work-waiting", "#/work?view=waiting"],
  ["work-upcoming", "#/work?view=upcoming"],
  ["work-done", "#/work?view=done"],
  ["automations", "#/automations"],
  ["activity", "#/activity"],
  ["settings", "#/s/settings"],
  ["connections", "#/s/connections"],
  ["client", `#/s/client?clientId=${ACME}`],
  ["investigation", `#/s/investigation?clientId=${ACME}`],
  ["portfolio", "#/s/portfolio"],
  ["conversation", "#/ask"],
];

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  const page = await open(viewport);
  for (const [name, hash] of DESTINATIONS) {
    await step(page, name, async (problems) => {
      await page.goto(BASE + hash);
      await settle(page, 1200);
      await page.locator(".sh-root").waitFor();
      await audit(page, problems);
    });
  }
  await step(page, "search-palette", async (problems) => {
    await page.goto(BASE + "#/");
    await settle(page);
    await page.keyboard.press("Control+k");
    await page.getByRole("dialog").first().waitFor({ timeout: 5000 });
    await audit(page, problems, { keyboard: false });
    const inside = await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")));
    if (!inside) problems.push("the search palette did not take focus");
    await page.keyboard.press("Escape");
  });
  await step(page, "new-palette", async (problems) => {
    await page.goto(BASE + "#/");
    await settle(page);
    await page.getByRole("button", { name: /New/ }).first().click();
    await page.getByRole("dialog").first().waitFor({ timeout: 5000 });
    await audit(page, problems, { keyboard: false });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    if (await page.getByRole("dialog").count()) problems.push("Escape did not close the New sheet");
  });
  if (viewport.width < 900)
    await step(page, "more-sheet", async (problems) => {
      await page.goto(BASE + "#/");
      await settle(page);
      await page.getByRole("button", { name: /More/ }).first().click();
      await page.getByRole("dialog").first().waitFor({ timeout: 5000 });
      await audit(page, problems, { keyboard: false });
    });
  await page.context().close();
}

// Reduced motion: no animation runs anywhere the person can go.
const still = await open({ width: 1440, height: 1000 }, "reduce");
for (const [name, hash] of [["home", "#/"], ["work", "#/work"], ["living", `#/s/investigation?clientId=${ACME}`]]) {
  await step(still, `reduced-motion-${name}`, async (problems) => {
    await still.goto(BASE + hash);
    await settle(still, 1500);
    const running = await still.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && (a.effect?.getComputedTiming().duration ?? 0) > 1).map((a) => a.animationName ?? a.constructor.name));
    if (running.length) problems.push(`animations still running: ${[...new Set(running)].join(", ")}`);
  });
}
await still.context().close();
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
process.stdout.write(`\n${results.length - failures}/${results.length} steps passed\n`);
process.exit(failures ? 1 : 0);
