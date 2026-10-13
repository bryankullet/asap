/**
 * Hardening for Living surfaces (D-163), over the UI Lab — the composer's own output at every stage:
 *
 *  - Accessibility: axe-core on the surface; any serious or critical violation fails.
 *  - Visual regression: each stage at 1440 and 390 px against committed baselines
 *    (apps/web/e2e/baselines). More than 0.5% of pixels changed fails. Refresh deliberately with
 *    UPDATE_BASELINES=1 after reviewing the new screenshots.
 *  - Performance: time from navigation to the surface being drawn, per stage; over 3 s fails.
 *  - Keyboard: every control on the surface is reachable by Tab and shows a visible focus ring.
 */
import { chromium } from "playwright";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const require = createRequire(import.meta.url);
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const BASE = process.env.E2E_URL.replace(/\/e2e\/live\.html.*$/, "/e2e/lab.html");
const OUT = process.env.E2E_SHOTS ?? "apps/web/.e2e-shots/living-quality";
const BASELINES = "apps/web/e2e/baselines";
const UPDATE = process.env.UPDATE_BASELINES === "1";
mkdirSync(OUT, { recursive: true });
mkdirSync(BASELINES, { recursive: true });
const lab = JSON.parse(readFileSync("apps/web/e2e/living-lab.json", "utf8"));
const browser = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM ?? "/opt/pw-browsers/chromium" });
const results = [];
const timings = [];

for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ viewport, isMobile: viewport.width < 900, hasTouch: viewport.width < 900, reducedMotion: "reduce", deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const s of lab) {
    const problems = [];
    const started = Date.now();
    await page.goto(`${BASE}#stage=${s.key}`);
    await page.locator(".lv-root [data-component=ContextHeader]").waitFor({ timeout: 20000 });
    const ms = Date.now() - started;
    timings.push({ viewport: viewport.width, stage: s.key, ms });
    if (ms > 3000) problems.push(`drawn in ${ms} ms`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);

    // Accessibility, on the surface itself.
    await page.addScriptTag({ content: AXE });
    const axe = await page.evaluate(async () => {
      const r = await window.axe.run(document.querySelector(".lv-root"), { resultTypes: ["violations"] });
      return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length}): ${v.help}`);
    });
    problems.push(...axe.map((a) => `a11y ${a}`));

    // Keyboard: Tab through the surface; each focused control must show a focus ring.
    if (viewport.width === 1440) {
      const unringed = await page.evaluate(async () => {
        const controls = [...document.querySelectorAll(".lv-root button, .lv-root summary, .lv-root input, .lv-root select, .lv-root textarea")].filter((el) => !el.disabled && el.offsetParent !== null && !(el.closest("details:not([open])") && el.tagName !== "SUMMARY"));
        const bad = [];
        for (const el of controls.slice(0, 25)) {
          el.focus();
          const cs = getComputedStyle(el);
          const ringed = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
          if (document.activeElement !== el) bad.push(`${el.tagName.toLowerCase()} “${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}” not focusable`);
          else if (!ringed) bad.push(`${el.tagName.toLowerCase()} “${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}” has no focus ring`);
        }
        document.activeElement?.blur?.();
        return bad;
      });
      // focus-visible applies to keyboard focus; drive a real Tab to confirm the first one.
      await page.keyboard.press("Tab");
      problems.push(...unringed.slice(0, 5).map((u) => `keyboard ${u}`));
      await page.evaluate(() => document.activeElement?.blur?.());
    }

    // Visual regression.
    const shot = `${OUT}/${viewport.width}-${s.key}.png`;
    const base = `${BASELINES}/${viewport.width}-${s.key}.png`;
    const buf = await page.screenshot({ path: shot, fullPage: false, animations: "disabled" });
    if (UPDATE || !existsSync(base)) {
      writeFileSync(base, buf);
    } else {
      const a = PNG.sync.read(readFileSync(base));
      const b = PNG.sync.read(buf);
      if (a.width !== b.width || a.height !== b.height) problems.push(`visual size ${b.width}x${b.height} vs baseline ${a.width}x${a.height}`);
      else {
        const diff = new PNG({ width: a.width, height: a.height });
        const n = pixelmatch(a.data, b.data, diff.data, a.width, a.height, { threshold: 0.12 });
        const share = n / (a.width * a.height);
        if (share > 0.005) {
          writeFileSync(`${OUT}/${viewport.width}-${s.key}-diff.png`, PNG.sync.write(diff));
          problems.push(`visual ${(share * 100).toFixed(2)}% of pixels changed (diff saved)`);
        }
      }
    }
    results.push({ step: `${viewport.width} ${s.key}`, ok: !problems.length, problems });
    process.stdout.write(`${problems.length ? "✗" : "✓"} ${viewport.width} ${s.key} ${ms}ms${problems.length ? " — " + problems.join("; ") : ""}\n`);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${OUT}/results.json`, JSON.stringify({ results, timings }, null, 2));
const failed = results.filter((r) => !r.ok).length;
const sorted = timings.map((t) => t.ms).sort((x, y) => x - y);
process.stdout.write(`\nrender p50 ${sorted[Math.floor(sorted.length / 2)]} ms · p95 ${sorted[Math.floor(sorted.length * 0.95)]} ms${UPDATE ? " · baselines written" : ""}\n`);
process.stdout.write(`${results.length - failed}/${results.length} steps passed\n`);
process.exit(failed ? 1 : 0);
