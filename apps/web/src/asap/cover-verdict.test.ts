/**
 * The cover check's verdict (staging finding, D-135). UX TEST KDN 482Q rightly read "Not on cover /
 * Cover not confirmed". Only an insurer confirmation linked to the period the vehicle is scheduled on
 * turns it green; a logbook, request or email never sets that link.
 */
import { describe, expect, it } from "vitest";
// The engine is plain JavaScript compiled from the approved build; only this one function is typed here.
type Verdict = { state: string; label: string; covered: boolean; why: string | null };
const { coverVerdict } = (await import("./engine/intent.js" as string)) as {
  coverVerdict: (input: { reg: string; item: unknown; year: unknown }) => Verdict;
};

const year = (confirmationEvidenceId: string | null) => ({
  id: "y1",
  policyId: "p1",
  confirmationEvidenceId,
});
const item = { reg: "KDN 482Q", policyYearId: "y1" };

describe("coverVerdict", () => {
  it('no policy on file: cover not verified, never "not on cover"', () => {
    expect(coverVerdict({ reg: "KDN 482Q", item: null, year: null })).toMatchObject({
      state: "no_policy",
      label: "Cover not verified",
      covered: false,
    });
  });
  it("a policy, but the vehicle is not on its schedule: not on cover — a logbook or request does not change it", () => {
    const v = coverVerdict({ reg: "KDN 482Q", item: null, year: year("ev1") });
    expect(v).toMatchObject({
      state: "not_scheduled",
      label: "Cover not verified",
      covered: false,
    });
    expect(v.why).toMatch(/A request from the client, a logbook or an email doesn’t prove cover/);
  });
  it("on the schedule with no insurer confirmation linked: unconfirmed", () => {
    expect(coverVerdict({ reg: "KDN 482Q", item, year: year(null) })).toMatchObject({
      state: "unconfirmed",
      label: "Unconfirmed",
      covered: false,
    });
  });
  it("on the schedule with the insurer's confirmation linked: on cover", () => {
    expect(coverVerdict({ reg: "KDN 482Q", item, year: year("ev1") })).toMatchObject({
      state: "covered",
      label: "On cover",
      covered: true,
    });
  });
});

describe("absence of records is never a negative cover claim (D-137)", () => {
  it("no verdict built from missing records says the vehicle is uninsured", () => {
    for (const v of [
      coverVerdict({ reg: "KDN 482Q", item: null, year: null }),
      coverVerdict({ reg: "KDN 482Q", item: null, year: year("ev1") }),
    ]) {
      expect(v.label).toBe("Cover not verified");
      expect(`${v.label} ${v.why}`).not.toMatch(/not on cover|nothing covers|is not covered/i);
    }
  });
});
