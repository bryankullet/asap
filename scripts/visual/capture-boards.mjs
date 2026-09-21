/**
 * Every board state the parity contract asks for, measured and photographed.
 *
 * Geometry is captured beside the pixels for the same reason as `capture.mjs`: a pixel diff says
 * *that* something moved, a measurement says *what to change*. The application side is the
 * shipping `Shell`, `Today` and `Work` over the harness's stubbed responses, because a measuring
 * script cannot sign in — see `apps/web/src/parity/shell-harness.tsx`.
 *
 *   node scripts/visual/capture-boards.mjs            # the application
 *   node scripts/visual/capture-boards.mjs prototype  # the prototype, same viewports
 */
import { execFileSync, spawn } from "node:child_process";
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

/** The ten states the contract names, each as a url the harness can produce. */
const STATES = [
  { name: "today-priorities", url: `${HARNESS}?at=/today&rows=4` },
  { name: "today-nothing", url: `${HARNESS}?at=/today&rows=0` },
  { name: "today-new-brokerage", url: `${HARNESS}?at=/today&rows=0&book=0` },
  { name: "work-yours", url: `${HARNESS}?at=/work` },
  { name: "work-with-others", url: `${HARNESS}?at=/work%3Fview=with` },
  { name: "work-in-progress", url: `${HARNESS}?at=/work%3Fview=progress` },
  { name: "work-done", url: `${HARNESS}?at=/work%3Fview=done` },
  { name: "work-recent", url: `${HARNESS}?at=/work%3Fview=recent` },
  { name: "work-record-beside-ask", url: `${HARNESS}?at=/work&rows=1` },
  { name: "ask-with-record-context", url: `${HARNESS}?at=/today&rows=2` },
];

/**
 * What is measured on a board. Roles rather than classes, so the prototype and the application can
 * be compared although their class names cannot be shared.
 */
const ROLES = {
  app: {
    pane: ".shell-pane",
    head: ".sp-head",
    space: ".sp-space",
    eyebrow: ".sp-eyebrow",
    title: ".sp-title",
    status: ".sp-status",
    filters: ".sp-filters",
    filter: ".sp-filter",
    blocks: ".sp-blocks",
    blockLabel: ".sp-block-label",
    rows: ".sp-rows",
    row: ".sp-row",
    rowTitle: ".sp-row-title",
    rowNote: ".sp-row-note",
    badge: ".sp-badge",
    primary: ".sp-btn-primary",
    quiet: ".sp-btn",
    note: ".sp-note",
    empty: ".sp-empty",
  },
  prototype: {
    pane: ".asap-pane",
    head: ".asap-pane > div:first-child",
    /* The prototype's Space content has no wrapper of its own: the pane *is* the frame. */
    space: ".asap-pane",
    eyebrow: ".asap-pane > div:first-child > div:first-child > div:first-child",
    title: ".asap-pane h1",
    status: ".asap-pane > div:first-child > span",
    filters: null,
    filter: null,
    blocks: ".asap-pane > div:nth-child(2)",
    blockLabel: null,
    rows: null,
    row: null,
    rowTitle: null,
    rowNote: null,
    badge: null,
    primary: null,
    quiet: null,
    note: null,
    empty: null,
  },
};

async function measure(page, selectors) {
  return page.evaluate((roles) => {
    const round = (n) => Math.round(n * 10) / 10;
    const out = { elements: {}, overflow: null };
    for (const [role, sel] of Object.entries(roles)) {
      if (sel === null) { out.elements[role] = null; continue; }
      const el = document.querySelector(sel);
      if (!el) { out.elements[role] = null; continue; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out.elements[role] = {
        w: round(r.width), h: round(r.height), x: round(r.x), y: round(r.y),
        font: cs.fontFamily.split(",")[0].replace(/"/g, ""),
        size: cs.fontSize, weight: cs.fontWeight, ls: cs.letterSpacing,
        color: cs.color, background: cs.backgroundColor,
        border: cs.borderTopWidth + " " + cs.borderTopColor,
        radius: cs.borderRadius, padding: cs.padding, gap: cs.rowGap,
        shadow: cs.boxShadow,
        count: document.querySelectorAll(sel).length,
      };
    }
    out.overflow = {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    };
    return out;
  }, selectors);
}

async function serve(dir, port) {
  const child = spawn("python3", ["-m", "http.server", String(port), "--directory", dir], {
    stdio: "ignore",
    detached: true,
  });
  for (let i = 0; i < 40; i++) {
    try {
      execFileSync("curl", ["-sf", "-o", "/dev/null", `http://127.0.0.1:${port}/`]);
      return child;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`static server for ${dir} did not come up on ${port}`);
}

const target = process.argv[2] === "prototype" ? "prototype" : "app";
const outDir = resolve(`.local-visual/shots/boards-${target}`);
mkdirSync(outDir, { recursive: true });

let server;
const states =
  target === "prototype"
    ? [{ name: "prototype-pane", url: "http://127.0.0.1:8899/ASAP.dc.html" }]
    : STATES;
if (target === "prototype") {
  const dir = resolve(".local-visual/prototype");
  if (!existsSync(dir)) {
    console.error("run vendor-prototype.mjs first");
    process.exit(2);
  }
  server = await serve(dir, 8899);
}

const browser = await chromium.launch({ executablePath: browserPath() });
const report = { target, viewports: {} };
try {
  for (const vp of VIEWPORTS) {
    report.viewports[vp.name] = {};
    for (const state of states) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const consoleErrors = [];
      page.on("console", (m) => {
        // The blocked font CDN is an artefact of this sandbox, not of the page.
        if (m.type() === "error" && !/CERT|404|font/i.test(m.text())) consoleErrors.push(m.text().slice(0, 200));
      });
      page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
      await page.goto(state.url, { waitUntil: "load" });
      await page.waitForTimeout(target === "prototype" ? 7000 : 2600);
      report.viewports[vp.name][state.name] = {
        ...(await measure(page, ROLES[target])),
        consoleErrors,
      };
      await page.screenshot({ path: `${outDir}/${state.name}--${vp.name}.png`, fullPage: false });
      await page.close();
    }
    console.log(`${target} ${vp.name}: ${states.length} state(s)`);
  }
} finally {
  await browser.close();
  if (server) {
    try {
      process.kill(-server.pid);
    } catch {
      /* already gone */
    }
  }
}
writeFileSync(`${outDir}/geometry.json`, JSON.stringify(report, null, 2));
console.log(`\ngeometry -> ${outDir}/geometry.json`);
