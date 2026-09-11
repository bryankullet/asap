#!/usr/bin/env node
/**
 * The demo-parity regression gate.
 *
 * Captures every parity screen from the approved demo and from a production build of the port,
 * diffs each pair, and fails if any screen has drifted past its recorded budget. The budgets are
 * the measured numbers from `docs/audit/demo-parity/README.md` with a small allowance, so a change
 * that moves a card four pixels fails here rather than in a review.
 *
 * This is the objective acceptance test the click-path suites cannot be: "every link works" says
 * nothing about whether the page looks like the approved design.
 *
 *   node apps/web/parity/check.mjs
 *
 * It needs both applications running — the approved demo at PARITY_ORIGINAL (default :4180) and a
 * production build of the port at PARITY_REACT (default :4177). See the README for how.
 */
import { capture, SIZES, SCREENS } from "./capture.mjs";
import { compare } from "./diff.mjs";

/**
 * The most a screen may differ, in percent of its pixels. These are not loose: the residual at
 * every desktop size is symbol-glyph rendering in this sandbox, and Jobs and Automations carry a
 * recorded content difference (the README says which). A budget that allowed a visibly different
 * page would defeat the point.
 */
const BUDGET = {
  Discover: { "1440x900": 0.2, "1360x900": 0.2, "1024x768": 0.3, "390x844": 0.6 },
  Ask: { "1440x900": 0.1, "1360x900": 0.1, "1024x768": 0.15, "390x844": 0.7 },
  Work: { "1440x900": 0.2, "1360x900": 0.2, "1024x768": 0.3, "390x844": 0.7 },
  Jobs: { "1440x900": 0.4, "1360x900": 0.45, "1024x768": 0.65, "390x844": 1.5 },
  Automations: { "1440x900": 0.75, "1360x900": 0.8, "1024x768": 0.8, "390x844": 0.5 },
};

await capture([]);

const failures = [];
for (const screen of SCREENS) {
  for (const [size] of SIZES) {
    const name = `${screen.label}-${size}`;
    const budget = BUDGET[screen.label]?.[size];
    if (budget === undefined) {
      failures.push(`${name}: no budget recorded — add one rather than skipping the screen`);
      continue;
    }
    const { percent, pixels } = compare("docs/audit/demo-parity", name);
    const verdict = percent <= budget ? "ok" : "DRIFTED";
    console.log(
      `  ${name.padEnd(24)} ${percent.toFixed(2)}%  (budget ${budget}%)  ${pixels} px  ${verdict}`,
    );
    if (percent > budget) {
      failures.push(`${name}: ${percent.toFixed(2)}% against a budget of ${budget}%`);
    }
  }
}

if (failures.length > 0) {
  console.error("\nThe port has drifted from the approved demo:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("\nThe diffs are in docs/audit/demo-parity/diff — look before changing a budget.");
  process.exit(1);
}
console.log("\nEvery screen is within its recorded budget.");
