/**
 * First-use onboarding, photographed and measured.
 *
 * The harness serves each step from its URL, so every screen a new person sees can be captured
 * without a live Google client — including the one that says Gmail is not configured. Nothing here
 * shows a connected mailbox, because nothing here connects one: a screenshot of a fake success is
 * worse than no screenshot.
 *
 *   pnpm --filter @asap/web build:harness   # or: vite build with the harness input
 *   node scripts/visual/capture-onboarding.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { VIEWPORTS } from "./capture.mjs";

function browserPath() {
  for (const p of [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
  ]) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

const HARNESS = process.env.HARNESS ?? "http://127.0.0.1:5199/parity/shell-harness/";

/** Every screen a new person can be shown, and the two honest answers about Gmail. */
const STATES = [
  { name: "step1-new-brokerage", url: `${HARNESS}?at=/onboarding&company=none` },
  { name: "step1-joined-existing", url: `${HARNESS}?at=/onboarding&joined=1` },
  { name: "step2-records", url: `${HARNESS}?at=/onboarding&step=2` },
  { name: "step2-records-already-some", url: `${HARNESS}?at=/onboarding&step=2&documents=2&clients=5` },
  { name: "step3-gmail-available", url: `${HARNESS}?at=/onboarding&step=3` },
  { name: "step3-gmail-not-configured", url: `${HARNESS}?at=/onboarding&step=3&gmail=off` },
  { name: "step3-mailbox-connected", url: `${HARNESS}?at=/onboarding&step=3&connected=1` },
  { name: "step4-finish", url: `${HARNESS}?at=/onboarding&step=4&records=skip&mailbox=skip` },
  { name: "already-done", url: `${HARNESS}?at=/onboarding&done=1&records=skip&mailbox=skip&documents=3&clients=7` },
];

const outDir = resolve(".local-visual/shots/onboarding");
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: browserPath() });
const report = { viewports: {} };
try {
  for (const vp of VIEWPORTS) {
    report.viewports[vp.name] = {};
    for (const state of STATES) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const consoleErrors = [];
      page.on("console", (m) => {
        // The blocked font CDN is an artefact of this sandbox, not of the page.
        if (m.type() === "error" && !/CERT|404|font/i.test(m.text())) consoleErrors.push(m.text().slice(0, 200));
      });
      page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
      await page.goto(state.url, { waitUntil: "load" });
      await page.waitForTimeout(2600);

      const measured = await page.evaluate(() => {
        const round = (n) => Math.round(n * 10) / 10;
        const el = document.querySelector(".sp-space");
        const title = document.querySelector(".sp-title");
        return {
          space: el
            ? { w: round(el.getBoundingClientRect().width), h: round(el.getBoundingClientRect().height) }
            : null,
          title: title?.textContent ?? null,
          blocks: document.querySelectorAll(".sp-block, .sp-note, .sp-form, .sp-rows, .sp-upload").length,
          /* A screen with nothing on it is a failure of this capture, not a state to photograph. */
          text: (document.body.textContent ?? "").trim().length,
          overflow: {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
          },
        };
      });

      report.viewports[vp.name][state.name] = { ...measured, consoleErrors };
      await page.screenshot({ path: `${outDir}/${state.name}--${vp.name}.png`, fullPage: false });
      await page.close();
    }
    console.log(`${vp.name}: ${STATES.length} state(s)`);
  }
} finally {
  await browser.close();
}
writeFileSync(`${outDir}/geometry.json`, JSON.stringify(report, null, 2));

/* The checks this capture exists to make, failing loudly rather than producing a pretty report. */
const problems = [];
for (const [vp, states] of Object.entries(report.viewports)) {
  for (const [name, r] of Object.entries(states)) {
    if (r.text < 200) problems.push(`${vp}/${name}: the screen is empty`);
    if (r.overflow.scrollWidth > r.overflow.clientWidth + 1) {
      problems.push(`${vp}/${name}: horizontal overflow (${r.overflow.scrollWidth} > ${r.overflow.clientWidth})`);
    }
    if (r.consoleErrors.length > 0) problems.push(`${vp}/${name}: ${r.consoleErrors[0]}`);
  }
}
console.log(`\ngeometry -> ${outDir}/geometry.json`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("no empty screens, no horizontal overflow, no console errors");
