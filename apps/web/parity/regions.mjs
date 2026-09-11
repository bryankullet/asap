#!/usr/bin/env node
/** Where a diff's remaining pixels are, by band, so a residual can be explained not hand-waved. */
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
const img = PNG.sync.read(readFileSync(process.argv[2]));
const BANDS = [
  ["presenter bar", 0, 44],
  ["topbar", 44, 102],
  ["page body", 102, img.height],
];
const COLS = [
  ["sidebar", 0, 228],
  ["content", 228, img.width],
];
for (const [bn, y0, y1] of BANDS) {
  for (const [cn, x0, x1] of COLS) {
    let n = 0;
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        const i = (img.width * y + x) << 2;
        // pixelmatch paints differences magenta.
        if (img.data[i] > 200 && img.data[i + 1] < 80 && img.data[i + 2] > 90) n++;
      }
    if (n > 0) console.log(`  ${bn} / ${cn}: ${n} px`);
  }
}
