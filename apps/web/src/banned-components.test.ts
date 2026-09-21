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
 * One exception, and it moved in Increment 4A. It used to be the Jobs board, which drew a bar for
 * a run's derived progress; the prototype's Activity has no bar, so Activity now states the same
 * derived number in words and the bar is gone from it. The only bar left in the product is the
 * `upload` block's, and what it reports is a file's own byte count — the least invented number
 * there is. The exception is that one file, so a bar cannot quietly reappear on a record, a
 * renewal or a claim.
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
const PROGRESS_IS_A_FILES_OWN_BYTES = "./space/blocks.tsx";
const RESIZE_IS_A_SLIDER = "./shell/AskPanel.tsx";
const SOURCES = import.meta.glob("./**/*.{ts,tsx,css}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Source with its comments removed, so a rule can be explained where it is enforced. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
}

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
      if (path === PROGRESS_IS_A_FILES_OWN_BYTES || path === RESIZE_IS_A_SLIDER) continue;
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

  it("the one remaining bar reports a file's own bytes, not a judgement", () => {
    const blocks = SOURCES[PROGRESS_IS_A_FILES_OWN_BYTES] ?? "";
    // The width is the file's own percent, carried on the upload block's own progress row.
    expect(blocks).toContain("width: `${p.percent}%`");
    /*
     * And no confidence is ever *rendered*. Matched against the code with its comments stripped,
     * because the comments are where the rule is explained — a guard that a file cannot mention
     * the thing it refuses to draw is a guard nobody can document.
     */
    expect(withoutComments(blocks)).not.toMatch(/confidence/i);
  });

  /*
   * Activity states a run's derived progress rather than drawing it. The number is still the
   * API's — done ÷ total over the work's steps — so nothing was lost but the bar.
   */
  it("Activity shows a run's derived progress in words, and draws no bar", () => {
    const activity = SOURCES["./live/connections-space.ts"] ?? "";
    expect(activity).toContain("% of its steps");
    expect(activity).not.toMatch(/role="progressbar"|aria-valuenow/);
    expect(SOURCES["./pages/Jobs.tsx"] ?? "").not.toMatch(/aria-valuenow|progressbar/);
  });
});
