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
 *
 * A second exception, added with the prototype shell: the Ask panel's resize grip is a
 * `role="slider"`, and a slider is required to carry `aria-valuenow` and friends. It is a width in
 * pixels a person chose, not a measurement of anything — the opposite of the invented number this
 * test exists to stop. It is named here rather than pattern-matched so a bar cannot arrive by
 * declaring itself a slider, and the test below checks it really is one.
 */
const PROGRESS_IS_DERIVED = "./pages/Jobs.tsx";
const RESIZE_IS_A_SLIDER = "./shell/AskPanel.tsx";
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
      /*
       * Tests are not screens. One that asserts a marker is absent has to name it, and one that
       * asserts the slider exception is a slider has to quote it — flagging those would make the
       * guard impossible to test.
       */
      if (/\.test\.(ts|tsx)$/.test(path)) continue;
      if (path === PROGRESS_IS_DERIVED || path === RESIZE_IS_A_SLIDER) continue;
      for (const marker of ['role="progressbar"', "aria-valuenow", "aria-valuemax"]) {
        if (source.includes(marker)) offenders.push(`${path}: ${marker}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the one exception that is not a progress bar is a slider, and measures nothing", () => {
    const panel = SOURCES[RESIZE_IS_A_SLIDER] ?? "";
    // The attributes belong to a slider the person drags, not to a bar reporting a value.
    expect(panel).toContain('role="slider"');
    expect(panel).not.toContain('role="progressbar"');
    expect(panel).not.toMatch(/confidence|percent|%/i);
    // And what it reports is the width, which is the thing the person set.
    expect(panel).toContain("aria-valuenow={width}");
  });

  it("the one job progress bar reads a derived value, never an authored one", () => {
    const jobs = SOURCES[PROGRESS_IS_DERIVED] ?? "";
    // The value shown is the card's own `progress`, which the API derived from the work's steps.
    expect(jobs).toContain("aria-valuenow={card.progress}");
    // And no percentage is ever printed as a confidence.
    expect(jobs).not.toMatch(/confidence/i);
  });
});
