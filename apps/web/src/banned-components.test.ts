import * as ui from "@asap/ui";
import { describe, expect, it } from "vitest";

/**
 * Two things from the v4 prototype were deliberately not ported (D-056):
 *
 *   `.progress`   — a progress bar. Screen Map v1 Part 1 bans a progress bar across policy years:
 *                   a client-policy-year is not a task that is 60% finished, and drawing it as one
 *                   invents a number nobody measured.
 *   `.confidence` — a confidence percentage on an extracted fact. Also banned in Part 1: a model's
 *                   self-reported certainty is not evidence. Where ASAP is unsure it abstains and
 *                   says so, and every figure it does show is tappable to its source.
 *
 * This test is the guard. It fails if either arrives as a primitive, or if any file in the app
 * grows the ARIA roles such a bar needs to be a bar at all.
 *
 * One exception, added with D-064: a **job** may show progress. A job is a task with declared
 * steps, and §45 rule 10 requires its progress to be *derived from those steps* — which is exactly
 * what makes it honest, and what a policy year can never have. The approved demo draws it. The
 * exception is this one file, so a bar cannot quietly reappear on a record, a renewal or a claim.
 *
 * `.confidence` in the ported stylesheet is not a meter: it is the colour of the word in the
 * evidence table's State column — Known, Missing, Waiting — never a percentage.
 */
const PROGRESS_IS_DERIVED = "./pages/Jobs.tsx";
const SOURCES = import.meta.glob("./**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("components that were deliberately not ported", () => {
  it("the library exports no progress bar and no confidence meter", () => {
    expect(Object.keys(ui).filter((n) => /progress|confidence/i.test(n))).toEqual([]);
  });

  it("no screen renders a progress or confidence bar", () => {
    const offenders: string[] = [];
    for (const [path, source] of Object.entries(SOURCES)) {
      if (path.endsWith("/banned-components.test.ts")) continue;
      if (path === PROGRESS_IS_DERIVED) continue;
      for (const marker of ['role="progressbar"', "aria-valuenow", "aria-valuemax"]) {
        if (source.includes(marker)) offenders.push(`${path}: ${marker}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the one job progress bar reads a derived value, never an authored one", () => {
    const jobs = SOURCES[PROGRESS_IS_DERIVED] ?? "";
    // The value shown is the job's own `progress`, computed from its steps by the runner.
    expect(jobs).toContain("aria-valuenow={job.progress}");
    // And no percentage is ever printed as a confidence.
    expect(jobs).not.toMatch(/confidence/i);
  });
});
