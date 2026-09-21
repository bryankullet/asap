/**
 * Makes the prototype renderable locally, without changing its interface.
 *
 * See README.md for why this is necessary. The short version: it pulls React, ReactDOM and Babel
 * from `unpkg.com` at runtime, which a restricted-egress sandbox cannot reach, and it fails
 * *silently* — the stylesheet still applies, so the page looks styled and is empty.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const LIBS = [
  { pkg: "react@18.3.1", from: "umd/react.production.min.js", to: "react.js", url: "https://unpkg.com/react@18.3.1/umd/react.production.min.js" },
  { pkg: "react-dom@18.3.1", from: "umd/react-dom.production.min.js", to: "react-dom.js", url: "https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js" },
  { pkg: "@babel/standalone@7.29.0", from: "babel.min.js", to: "babel.js", url: "https://unpkg.com/@babel/standalone@7.29.0/babel.min.js" },
];

const source = process.argv[2];
if (!source || !existsSync(source)) {
  console.error("usage: node scripts/visual/vendor-prototype.mjs <path to ASAP.dc.html>");
  console.error("the prototype is deliberately not in this repository; pass its path");
  process.exit(2);
}

const out = resolve(".local-visual/prototype");
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "vendor"), { recursive: true });

// The prototype needs its siblings: support.js and the store/intent modules it imports.
cpSync(dirname(resolve(source)), out, { recursive: true });

const tmp = resolve(".local-visual/.packs");
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
for (const lib of LIBS) {
  // Each tarball extracts to ./package, so each needs its own directory.
  const dir = join(tmp, lib.to);
  mkdirSync(dir, { recursive: true });
  execFileSync("npm", ["pack", lib.pkg, "--pack-destination", dir], { stdio: "pipe" });
  const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tgz) throw new Error(`npm pack produced no tarball for ${lib.pkg}`);
  execFileSync("tar", ["xzf", join(dir, tgz), "-C", dir]);
  cpSync(join(dir, "package", lib.from), join(out, "vendor", lib.to));
  console.log(`vendored ${lib.pkg} -> vendor/${lib.to}`);
}

const supportPath = join(out, "support.js");
let support = readFileSync(supportPath, "utf8");
for (const lib of LIBS) {
  if (!support.includes(`"${lib.url}"`)) {
    throw new Error(`support.js does not reference ${lib.url}; the prototype's loader has changed`);
  }
  support = support.replaceAll(`"${lib.url}"`, `"./vendor/${lib.to}"`);
}
// An SRI hash pins the CDN's bytes; a same-origin copy cannot satisfy it. The exact versions in
// LIBS are what pins these instead.
support = support.replace(/var (REACT|REACT_DOM|BABEL)_SRI = "[^"]*"/g, 'var $1_SRI = ""');
writeFileSync(supportPath, support);

writeFileSync(join(out, ".vendored.json"), JSON.stringify({ source: resolve(source), libs: LIBS.map((l) => l.pkg) }, null, 2));
console.log(`\nprototype ready: ${out}`);
console.log("serve it over HTTP, not file:// — its store loads through dynamic import()");
