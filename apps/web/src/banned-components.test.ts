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
 */
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
      for (const marker of ['role="progressbar"', "aria-valuenow", "aria-valuemax"]) {
        if (source.includes(marker)) offenders.push(`${path}: ${marker}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
