/**
 * The pixel difference between the prototype and the application, over the Space pane.
 *
 * Read this number for what it is. The prototype's screens are full of fabricated clients,
 * policies and claims and the application's carry the brokerage's own rows, so a whole-page diff
 * is mostly a diff of *text*, and a low figure would mean the fixtures happened to be a similar
 * length rather than that the layout matches. Geometry is what parity is measured by
 * (`capture-boards.mjs`); this is the second opinion, and the region is cropped to the pane so the
 * sidebar and the header — which *are* comparable, and were measured identical in Increment 2 —
 * are not padding the figure with agreement.
 *
 *   node scripts/visual/pixel-diff.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { VIEWPORTS } from "./capture.mjs";

/** The pane's own box at each viewport, from the measured geometry. */
const PANE = {
  "1360x900": { x: 228, y: 61, w: 732, h: 839 },
  "1440x900": { x: 228, y: 61, w: 812, h: 839 },
  "390x844": { x: 0, y: 61, w: 390, h: 499 },
};

function crop(png, box) {
  const out = new PNG({ width: box.w, height: box.h });
  PNG.bitblt(png, out, box.x, box.y, box.w, box.h, 0, 0);
  return out;
}

const rows = [];
for (const vp of VIEWPORTS) {
  const box = PANE[vp.name];
  if (!box) continue;
  const proto = crop(PNG.sync.read(readFileSync(`.local-visual/shots/boards-prototype/prototype-pane--${vp.name}.png`)), box);
  const app = crop(PNG.sync.read(readFileSync(`.local-visual/shots/boards-app/today-priorities--${vp.name}.png`)), box);
  const diff = new PNG({ width: box.w, height: box.h });
  const changed = pixelmatch(proto.data, app.data, diff.data, box.w, box.h, { threshold: 0.1 });
  const total = box.w * box.h;
  writeFileSync(`.local-visual/shots/diff-${vp.name}.png`, PNG.sync.write(diff));
  rows.push({ viewport: vp.name, changed, total, percent: +((changed / total) * 100).toFixed(2) });
}

for (const r of rows) {
  console.log(`${r.viewport}: ${r.percent}% of the pane differs (${r.changed} of ${r.total} pixels)`);
}
