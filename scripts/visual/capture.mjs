/**
 * Captures screenshots and measured geometry, from the prototype or from the application.
 *
 * Geometry is captured alongside the pixels because a pixel diff tells you *that* something moved
 * and a measurement tells you *what to change*. "Sidebar is 224px, prototype is 228px" is a fix;
 * a red band down the left of a diff image is a puzzle.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

/** The prototype's own breakpoints (its two media queries are 980px and 720px). */
export const VIEWPORTS = [
  { name: "1360x900", width: 1360, height: 900 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "390x844", width: 390, height: 844 },
];

/**
 * Chromium is pre-installed in this sandbox at a version that need not match the repository's
 * Playwright, so it is launched by path rather than downloaded.
 */
function browserPath() {
  for (const p of [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome",
  ]) {
    if (existsSync(p)) return p;
  }
  return undefined; // let Playwright find its own
}

/** Every element whose geometry parity is asserted on. Text is deliberately not among them. */
const MEASURED = [
  ".asap-shell", ".asap-side", ".asap-pane", ".asap-ask", ".asap-tabs",
  ".asap-sheet", ".asap-mobilenav",
];

export async function measure(page) {
  return page.evaluate((selectors) => {
    const round = (n) => Math.round(n * 10) / 10;
    const out = { elements: {}, tokens: {}, overflow: null };
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) { out.elements[sel] = null; continue; }
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      out.elements[sel] = {
        w: round(r.width), h: round(r.height), x: round(r.x), y: round(r.y),
        background: cs.backgroundColor, borderRight: cs.borderRightWidth,
        borderTop: cs.borderTopWidth, padding: cs.padding, radius: cs.borderRadius,
        font: cs.fontFamily.split(",")[0].replace(/"/g, ""), size: cs.fontSize, weight: cs.fontWeight,
      };
    }
    const body = getComputedStyle(document.body);
    out.tokens = { background: body.backgroundColor, color: body.color, font: body.fontFamily.split(",")[0].replace(/"/g, "") };
    // Horizontal overflow is a parity failure in its own right at 390px.
    out.overflow = { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth };
    return out;
  }, MEASURED);
}

async function serve(dir, port) {
  const child = spawn("python3", ["-m", "http.server", String(port), "--directory", dir], { stdio: "ignore", detached: true });
  for (let i = 0; i < 40; i++) {
    try { execFileSync("curl", ["-sf", "-o", "/dev/null", `http://127.0.0.1:${port}/`]); return child; }
    catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  throw new Error(`static server for ${dir} did not come up on ${port}`);
}

const target = process.argv[2];
const base = process.argv[3];
if (target !== "prototype" && target !== "app") {
  console.error("usage: node scripts/visual/capture.mjs prototype | app <baseUrl>");
  process.exit(2);
}

const outDir = resolve(`.local-visual/shots/${target}`);
mkdirSync(outDir, { recursive: true });

let server;
let url = base;
if (target === "prototype") {
  const dir = resolve(".local-visual/prototype");
  if (!existsSync(dir)) {
    console.error("run vendor-prototype.mjs first");
    process.exit(2);
  }
  server = await serve(dir, 8899);
  url = "http://127.0.0.1:8899/ASAP.dc.html";
}
if (!url) { console.error("an app capture needs a base URL"); process.exit(2); }

const browser = await chromium.launch({ executablePath: browserPath() });
const report = { target, url, viewports: {} };
try {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    const consoleErrors = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message.slice(0, 200)}`));
    await page.goto(url, { waitUntil: "load" });
    // The prototype boots React, Babel and its store before it renders anything.
    await page.waitForTimeout(target === "prototype" ? 7000 : 2500);
    report.viewports[vp.name] = { ...(await measure(page)), consoleErrors };
    await page.screenshot({ path: `${outDir}/${vp.name}.png` });
    console.log(`${target} ${vp.name}: captured`);
    await page.close();
  }
} finally {
  await browser.close();
  if (server) { try { process.kill(-server.pid); } catch { /* already gone */ } }
}
writeFileSync(`${outDir}/geometry.json`, JSON.stringify(report, null, 2));
console.log(`\ngeometry -> ${outDir}/geometry.json`);
