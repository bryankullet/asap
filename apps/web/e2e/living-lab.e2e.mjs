/**
 * The UI Lab in a real browser (D-156): every renewal stage at desktop, laptop, tablet and phone
 * widths — asserted for its stage-specific blocks, overflow, placeholder text and console errors,
 * and captured for review.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.E2E_URL.replace(/\/e2e\/live\.html.*$/, "/e2e/lab.html");
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots/living";
mkdirSync(OUT, { recursive: true });
const lab = JSON.parse(readFileSync("apps/web/e2e/living-lab.json", "utf8"));
const EXPECT = {
  preparing: ["ProgressOpportunity", "CoverageEffectiveState"],
  awaiting_terms: ["QuoteComparison", "ObligationTracker"],
  comparing: ["QuoteComparison", "ChangeComparison", "ConsequencePanel"],
  placing: ["PlacementProgress", "ChangeComparison"],
  issuing: ["PlacementProgress", "ConsequencePanel"],
  verified: ["PlacementProgress", "CoverageEffectiveState"],
  stopped: ["ProgressOpportunity"],
};
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? "/opt/pw-browsers/chromium" });
const results = [];
for (const viewport of [{ width: 1440, height: 1000 }, { width: 1360, height: 900 }, { width: 900, height: 1100 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  for (const s of lab) {
    const problems = [];
    await page.goto(`${BASE}#stage=${s.key}`);
    await page.locator(".lv-root [data-component=ContextHeader]").waitFor({ timeout: 20000 }).catch((e) => problems.push(e.message.split("\n")[0]));
    await page.waitForTimeout(300);
    for (const c of EXPECT[s.key] ?? []) if (!(await page.locator(`.lv-root [data-component=${c}]`).count())) problems.push(`missing ${c}`);
    const text = await page.locator(".lv-root").innerText().catch(() => "");
    const bad = text.match(/\bundefined\b|\bNaN\b|\[object Object\]|\bnull\b/);
    if (bad) problems.push(`placeholder “${bad[0]}”`);
    const clipped = await page.evaluate(() => { const r = document.querySelector(".lv-root"); const f = document.querySelector(".lv-scroll"); return r && f ? r.scrollWidth - f.clientWidth : 0; });
    if (clipped > 1) problems.push(`${clipped}px wider than the screen`);
    if (errors.length) problems.push(`console: ${errors.splice(0).join(" | ").slice(0, 300)}`);
    await page.screenshot({ path: `${OUT}/${viewport.width}-${s.key}.png`, fullPage: false });
    results.push({ step: `${viewport.width} ${s.key}`, ok: !problems.length, problems });
    process.stdout.write(`${problems.length ? "✗" : "✓"} ${viewport.width} ${s.key}${problems.length ? " — " + problems.join("; ") : ""}\n`);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
process.stdout.write(`\n${results.length - failed}/${results.length} steps passed\n`);
process.exit(failed ? 1 : 0);
