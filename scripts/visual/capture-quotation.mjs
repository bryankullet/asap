/**
 * The Client Space, photographed and measured.
 *
 * Every shape a real book contains: a company with several policies, a person with one, a client
 * with nothing on file, and somebody whose role carries no permissions. The harness serves each
 * from its URL, so a measuring run needs no database and invents no brokerage — every name in the
 * captures is an obvious placeholder.
 *
 *   node scripts/visual/capture-quotation.mjs
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
const OPP = "/opportunities/30000000-0000-4000-8000-00000000000a";
const TERMS = `${OPP}/insurers/31000000-0000-4000-8000-00000000000a`;

const STATES = [
  { name: "opportunity-new", url: `${HARNESS}?at=${OPP}&stage=new` },
  { name: "opportunity-insurers-not-asked", url: `${HARNESS}?at=${OPP}&stage=asked` },
  { name: "opportunity-request-prepared", url: `${HARNESS}?at=${OPP}&stage=prepared` },
  { name: "opportunity-quoted-and-declined", url: `${HARNESS}?at=${OPP}&stage=full` },
  { name: "opportunity-no-permissions", url: `${HARNESS}?at=${OPP}&stage=full&perms=none` },
  { name: "terms-quoted", url: `${HARNESS}?at=${TERMS}&stage=full` },
  { name: "terms-not-asked", url: `${HARNESS}?at=${TERMS}&stage=asked` },
];

const outDir = resolve(".local-visual/shots/quotation");
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
          space: el ? { w: round(el.getBoundingClientRect().width) } : null,
          title: title?.textContent ?? null,
          blockLabels: [...document.querySelectorAll(".sp-block-label")].map((n) => n.textContent),
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

const problems = [];
for (const [vp, states] of Object.entries(report.viewports)) {
  for (const [name, r] of Object.entries(states)) {
    if (r.text < 200) problems.push(`${vp}/${name}: the screen is empty`);
    if (r.overflow.scrollWidth > r.overflow.clientWidth + 1) {
      problems.push(`${vp}/${name}: horizontal overflow (${r.overflow.scrollWidth} > ${r.overflow.clientWidth})`);
    }
    if (r.consoleErrors.length > 0) problems.push(`${vp}/${name}: ${r.consoleErrors[0]}`);
    /* The title is the work's own name. Either of these on screen is a failure of this capture. */
    if (/opportunity space|quote space/i.test(r.title ?? "")) {
      problems.push(`${vp}/${name}: the title says "${r.title}"`);
    }
  }
}
console.log(`\ngeometry -> ${outDir}/geometry.json`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("no empty screens, no horizontal overflow, no console errors, no 'Opportunity Space' title");
