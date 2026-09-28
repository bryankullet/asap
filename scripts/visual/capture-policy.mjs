/**
 * The Policy Space (4C-1) — photographed and measured at 1360, 1440 and 390.
 *
 * Every state a policy can be read in: active on evidence, confirmed but future, expired, cancelled
 * on an explicit record, legacy and unverified, several historical periods, overlapping periods,
 * a missing policy number, a missing term, a corrected value, a placement-versus-issued difference,
 * open Work with a named party, permission refusal, not found, and the evidence highlight on a
 * phone. Then three behaviours: two Policy Spaces open at once keep their own identity, a refresh
 * reads the same period, and Ask names the policy on screen.
 *
 * "Not found" and "permission refused" are the API's real answers, a 404 and a 403, which the
 * harness serves from its in-page stub — so no network response fails and nothing is logged. Every
 * console error, failed request and 4xx fails the run. There is no filter of any kind.
 *
 *   node scripts/visual/capture-policy.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { VIEWPORTS } from "./capture.mjs";

function browserPath() {
  for (const p of ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"]) if (existsSync(p)) return p;
  return undefined;
}

const HARNESS = process.env.HARNESS ?? "http://127.0.0.1:5199/parity/shell-harness/";
const POLICY = "4a000000-0000-4000-8000-0000000000c1";
const SECOND = "4a000000-0000-4000-8000-0000000000c2";
const url = (stage, id = POLICY, extra = "") => `${HARNESS}?at=/policies/${id}${extra}&stage=${stage}`;

const STATES = [
  { name: "policy-active-verified", url: url("active") },
  { name: "policy-confirmed-future", url: url("future") },
  { name: "policy-expired", url: url("expired") },
  { name: "policy-cancelled", url: url("cancelled") },
  { name: "policy-legacy-unverified", url: url("legacy") },
  { name: "policy-several-periods", url: url("history") },
  { name: "policy-overlapping-periods", url: url("conflict") },
  { name: "policy-missing-number", url: url("missing-number") },
  { name: "policy-missing-term", url: url("missing-term") },
  { name: "policy-corrected-value", url: url("corrected") },
  { name: "policy-placement-vs-issued", url: url("difference") },
  { name: "policy-open-work-named-party", url: url("work") },
  { name: "policy-ask-prepared-renewal", url: url("prepared") },
  { name: "policy-actions-not-permitted", url: url("no-permission-actions") },
  { name: "policy-permission-refused", url: url("refused") },
  { name: "policy-not-found", url: url("not-found") },
  {
    name: "policy-evidence-highlight", url: url("corrected"),
    act: async (page) => {
      const row = page.locator(".sp-row", { hasText: "Policy number:" }).first();
      await row.getByRole("button", { name: "Show where" }).click();
      await page.waitForTimeout(300);
      await row.evaluate((el) => el.scrollIntoView({ block: "start" }));
    },
  },
];

const outDir = resolve(".local-visual/shots/policy");
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: browserPath() });
const report = { viewports: {}, behaviours: {} };

function watch(page, expected) {
  const errors = [];
  const allowed = (u, s) => expected && s === expected.status && u.includes(expected.path);
  let allowedSeen = 0;
  page.on("response", (r) => { if (r.status() >= 400) { if (allowed(r.url(), r.status())) allowedSeen += 1; else errors.push(`${r.status()}: ${r.url().slice(0, 200)}`); } });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    /* The browser's own line for the one declared response, and nothing else. */
    if (expected && text.includes(`status of ${expected.status}`) && (m.location().url ?? "").includes(expected.path)) return;
    errors.push(`${text.slice(0, 160)} @ ${m.location().url ?? ""}`.slice(0, 240));
  });
  page.on("requestfailed", (r) => errors.push(`request failed: ${r.url().slice(0, 200)}`));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  return { errors, seen: () => allowedSeen };
}

const measure = (page) => page.evaluate(() => ({
  title: document.querySelector(".sp-title")?.textContent ?? null,
  blockLabels: [...document.querySelectorAll(".sp-block-label")].map((n) => n.textContent),
  text: (document.body.textContent ?? "").trim().length,
  body: document.body.innerText,
  tabs: [...document.querySelectorAll(".shell-tab")].map((t) => t.textContent),
  fonts: [...document.fonts].filter((f) => f.status === "loaded").map((f) => f.family),
  overflow: { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth },
}));

try {
  for (const vp of VIEWPORTS) {
    report.viewports[vp.name] = {};
    for (const state of STATES) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const w = watch(page, state.expect);
      await page.goto(state.url, { waitUntil: "load" });
      await page.waitForTimeout(2200);
      let actError = null;
      if (state.act) await state.act(page).catch((e) => { actError = String(e.message ?? e).slice(0, 200); });
      const { body, ...kept } = await measure(page);
      report.viewports[vp.name][state.name] = { ...kept, consoleErrors: w.errors, expectedSeen: state.expect ? w.seen() : null, actError, vocabulary: vocabularyProblems(body, state.name) };
      await page.screenshot({ path: `${outDir}/${state.name}--${vp.name}.png`, fullPage: true });
      await page.close();
    }
    console.log(`${vp.name}: ${STATES.length} state(s)`);
  }

  /* Two Policy Spaces open at once: two tabs, each with its own title; Ask names the one on screen. */
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const w = watch(page, null);
    await page.goto(url("active"), { waitUntil: "load" });
    await page.waitForTimeout(1800);
    /* Open the second policy in the same browser; the tab strip is the one the person keeps. */
    await page.goto(url("active", SECOND), { waitUntil: "load" });
    await page.waitForTimeout(1800);
    const second = await measure(page);
    const askLabel = await page.locator("text=/POLICY · /").first().textContent().catch(() => null);
    report.behaviours.twoSpaces = { title: second.title, tabs: second.tabs, askLabel, consoleErrors: w.errors };
    await page.screenshot({ path: `${outDir}/policy-two-spaces--1440x900.png`, fullPage: false });
    await page.close();
  }

  /* A refresh reads the same period: the period is in the address, and the server reads it again. */
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const w = watch(page, null);
    await page.goto(url("history", POLICY, "?period=4b000000-0000-4000-8000-0000000000c1"), { waitUntil: "load" });
    await page.waitForTimeout(1800);
    const before = await measure(page);
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1800);
    const after = await measure(page);
    report.behaviours.refresh = { same: before.body === after.body && before.title === after.title, consoleErrors: w.errors };
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(`${outDir}/geometry.json`, JSON.stringify(report, null, 2));

function vocabularyProblems(text, name) {
  const out = [];
  if (/\bNeeds you\b/.test(text)) out.push('"Needs you" on screen');
  if (/(^|\n)\s*Waiting\s*(\n|$)/.test(text)) out.push('a bare "Waiting"');
  if (/\bPolicy Space\b|\bSpace:/.test(text)) out.push('"Space" on screen');
  if (/\b(Unpaid|Part paid|Reconciled)\b|\bPaid\b(?! )/.test(text)) out.push("a payment word with no payment record");
  if (["policy-legacy-unverified", "policy-missing-number", "policy-overlapping-periods", "policy-confirmed-future"].includes(name) && /(?<!not )\bActive cover\b/.test(text)) out.push('"Active cover" without evidence');
  return out;
}

const problems = [];
for (const [vp, states] of Object.entries(report.viewports)) {
  for (const [name, r] of Object.entries(states)) {
    if (r.text < 200) problems.push(`${vp}/${name}: the screen is empty`);
    if (r.overflow.scrollWidth > r.overflow.clientWidth + 1) problems.push(`${vp}/${name}: horizontal overflow (${r.overflow.scrollWidth} > ${r.overflow.clientWidth})`);
    if (r.consoleErrors.length > 0) problems.push(`${vp}/${name}: ${r.consoleErrors[0]}`);
    if (r.expectedSeen === 0) problems.push(`${vp}/${name}: the declared response never came`);
    if (r.actError) problems.push(`${vp}/${name}: could not reach the state — ${r.actError}`);
    for (const v of r.vocabulary) problems.push(`${vp}/${name}: ${v}`);
    if (!r.fonts.some((f) => /DM Sans|Manrope/.test(f))) problems.push(`${vp}/${name}: the self-hosted fonts did not load`);
  }
}
const two = report.behaviours.twoSpaces;
if (!two || two.tabs.length < 2 || new Set(two.tabs).size < 2) problems.push(`two spaces: expected two distinct policy tabs, got ${JSON.stringify(two?.tabs)}`);
if (two && !/Second Placeholder Company/.test(two.title ?? "")) problems.push(`two spaces: the second Space shows "${two.title}"`);
if (two && !/Second Placeholder Company/.test(two.askLabel ?? "")) problems.push(`two spaces: Ask names "${two.askLabel}"`);
if (two && two.consoleErrors.length) problems.push(`two spaces: ${two.consoleErrors[0]}`);
if (!report.behaviours.refresh?.same) problems.push("refresh: the Space read differently after a refresh");
if (report.behaviours.refresh?.consoleErrors.length) problems.push(`refresh: ${report.behaviours.refresh.consoleErrors[0]}`);

console.log(`\ngeometry -> ${outDir}/geometry.json`);
if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log("no empty screens, no overflow, no undeclared console errors, local fonts, distinct tabs, refresh preserved, Ask on the right policy");
