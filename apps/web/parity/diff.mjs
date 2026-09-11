#!/usr/bin/env node
/**
 * Pixel diff between the approved demo and the React port.
 *
 * Writes a diff image and a side-by-side strip for every pair, and prints the differing-pixel
 * percentage. This is the number that decides parity — a click-path test cannot see that a
 * sidebar is 4px too wide or that a heading is the wrong typeface.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const BASE = process.argv[2] ?? "docs/audit/demo-parity";
const pairs = process.argv.slice(3);

function load(p) {
  return PNG.sync.read(readFileSync(p));
}

/** Pad both images to a common canvas so a height difference is a visible diff, not a crash. */
function pad(img, w, h) {
  if (img.width === w && img.height === h) return img;
  const out = new PNG({ width: w, height: h });
  out.data.fill(255);
  PNG.bitblt(img, out, 0, 0, Math.min(img.width, w), Math.min(img.height, h), 0, 0);
  return out;
}

mkdirSync(`${BASE}/diff`, { recursive: true });
mkdirSync(`${BASE}/side-by-side`, { recursive: true });

let worst = 0;
const rows = [];
for (const name of pairs) {
  const a = `${BASE}/original/${name}.png`;
  const b = `${BASE}/react/${name}.png`;
  if (!existsSync(a) || !existsSync(b)) {
    rows.push([name, "missing", existsSync(a) ? "react" : "original"]);
    continue;
  }
  const oa = load(a);
  const ob = load(b);
  const w = Math.max(oa.width, ob.width);
  const h = Math.max(oa.height, ob.height);
  const A = pad(oa, w, h);
  const B = pad(ob, w, h);

  const diff = new PNG({ width: w, height: h });
  const changed = pixelmatch(A.data, B.data, diff.data, w, h, {
    threshold: 0.1,
    includeAA: false,
    alpha: 0.25,
    diffColor: [255, 0, 128],
  });
  writeFileSync(`${BASE}/diff/${name}.png`, PNG.sync.write(diff));

  // Side by side: original left, react right, a 2px rule between them.
  const sbs = new PNG({ width: w * 2 + 2, height: h });
  sbs.data.fill(120);
  PNG.bitblt(A, sbs, 0, 0, w, h, 0, 0);
  PNG.bitblt(B, sbs, 0, 0, w, h, w + 2, 0);
  writeFileSync(`${BASE}/side-by-side/${name}.png`, PNG.sync.write(sbs));

  const pct = (changed / (w * h)) * 100;
  worst = Math.max(worst, pct);
  rows.push([name, `${pct.toFixed(2)}%`, `${changed} px of ${w}×${h}`]);
}

const width = Math.max(...rows.map((r) => r[0].length));
for (const [name, pct, note] of rows) {
  console.log(`  ${name.padEnd(width)}  ${String(pct).padStart(7)}  ${note}`);
}
console.log(`\nworst: ${worst.toFixed(2)}%`);
