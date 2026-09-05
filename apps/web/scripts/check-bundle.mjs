#!/usr/bin/env node
/**
 * Build-time check (work item 2): the web bundle may contain VITE_PUBLIC_* values only.
 *
 * Fails if any file under dist/ contains:
 *   1. a VITE_ variable name that is not VITE_PUBLIC_*,
 *   2. the name of any non-public variable listed in .env.example,
 *   3. the *value* of any non-public variable present in the build environment
 *      (length >= 8, so a leaked secret is caught even when its name is not).
 *
 * Vite's envPrefix is the first line of defence; this is the second, on the artefact itself.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const webRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(webRoot, "../..");
const distDir = join(webRoot, "dist");
const PUBLIC_PREFIX = "VITE_PUBLIC_";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(js|css|html|json|txt|map)$/.test(entry)) out.push(p);
  }
  return out;
}

const exampleVars = readFileSync(join(repoRoot, ".env.example"), "utf8")
  .split("\n")
  .map((l) => l.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
  .filter(Boolean);

const nonPublicNames = exampleVars.filter((n) => !n.startsWith(PUBLIC_PREFIX));
// Names that are also ordinary words in a browser bundle would false-positive.
const IGNORED_NAMES = new Set(["NODE_ENV"]);

const nonPublicValues = Object.entries(process.env)
  .filter(([k, v]) => !k.startsWith(PUBLIC_PREFIX) && typeof v === "string" && v.length >= 8)
  .filter(([k]) => nonPublicNames.includes(k))
  .filter(([, v]) => !/^(true|false|development|production|test|local|staging)$/.test(v))
  .filter(([, v]) => !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(v));

const problems = [];
for (const file of walk(distDir)) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/VITE_[A-Z0-9_]+/g)) {
    if (!m[0].startsWith(PUBLIC_PREFIX)) problems.push(`${file}: non-public variable name ${m[0]}`);
  }
  for (const name of nonPublicNames) {
    if (IGNORED_NAMES.has(name)) continue;
    if (new RegExp(`\\b${name}\\b`).test(text))
      problems.push(`${file}: server variable name ${name}`);
  }
  for (const [name, value] of nonPublicValues) {
    if (text.includes(value)) problems.push(`${file}: value of server variable ${name}`);
  }
}

if (problems.length > 0) {
  console.error("check-bundle: the web bundle contains non-public configuration:");
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`check-bundle: ok — only ${PUBLIC_PREFIX}* reaches the browser`);
