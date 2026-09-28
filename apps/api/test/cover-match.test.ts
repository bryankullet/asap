/**
 * `placement.verify_cover_match` (4B-4A).
 *
 * The comparator is pure, so each classification is held here directly, against the two
 * immutable inputs it is given in production: an accepted basis version and a confirmation.
 */
import { describe, expect, it } from "vitest";
import { endOfPeriod, summarise, verifyCoverMatch, type BasisSide, type ConfirmationSide } from "../src/placement/cover-match.js";

const basis = (over: Partial<BasisSide> = {}): BasisSide => ({
  insurerName: "Jubilee",
  classOfBusiness: "Commercial motor",
  subject: "Fleet of five vehicles",
  effectiveAt: "2026-10-01T00:00:00.000Z",
  expiryAt: "2027-09-30T23:59:59.000Z",
  premiumAmount: "5310000.00",
  premiumCurrency: "KES",
  premiumBasis: null,
  clientConditions: null,
  outstandingRequirements: null,
  periodMonths: null,
  periodDays: null,
  terms: [
    { termType: "excess", label: "Own damage", value: "5% min KES 30,000", amount: null, currency: null, unclear: false },
    { termType: "limit", label: "Third party property", value: "KES 20,000,000", amount: null, currency: null, unclear: false },
    { termType: "condition", label: "Tracking devices", value: "Within 30 days", amount: null, currency: null, unclear: false },
  ],
  ...over,
});

const confirmation = (over: Partial<ConfirmationSide> = {}): ConfirmationSide => ({
  insurerName: "Jubilee",
  classOfBusiness: "Commercial motor",
  subject: "Fleet of five vehicles",
  effectiveAt: "2026-10-01T00:00:00.000Z",
  expiryAt: "2027-09-30T23:59:59.000Z",
  premiumAmount: "5310000.00",
  premiumCurrency: "KES",
  premiumBasis: null,
  terms: basis().terms.map((t) => ({ ...t })),
  ...over,
});

const find = (items: ReturnType<typeof verifyCoverMatch>, label: string) => items.find((i) => i.label === label)!;

describe("verify_cover_match", () => {
  it("finds no material difference when the confirmation says what was accepted", () => {
    const items = verifyCoverMatch(basis(), confirmation());
    expect(summarise(items)).toEqual({ material: 0, unclear: 0 });
    expect(find(items, "Own damage").classification).toBe("match");
  });

  it("treats spacing, case and thousands separators as presentation, not a change", () => {
    const c = confirmation();
    c.terms[0] = { ...c.terms[0]!, value: "5%  MIN KES 30000" };
    expect(find(verifyCoverMatch(basis(), c), "Own damage").classification).toBe("match");
  });

  it("marks a changed premium as a material change, old and new", () => {
    const item = find(verifyCoverMatch(basis(), confirmation({ premiumAmount: "5410000.00" })), "Premium");
    expect(item).toMatchObject({ classification: "changed", material: true, acceptedValue: "KES 5,310,000", confirmedValue: "KES 5,410,000" });
  });

  it("marks a changed excess", () => {
    const c = confirmation();
    c.terms[0] = { ...c.terms[0]!, value: "7.5% min KES 45,000" };
    expect(find(verifyCoverMatch(basis(), c), "Own damage")).toMatchObject({ classification: "changed", material: true });
  });

  it("marks a changed limit", () => {
    const c = confirmation();
    c.terms[1] = { ...c.terms[1]!, value: "KES 10,000,000" };
    expect(find(verifyCoverMatch(basis(), c), "Third party property")).toMatchObject({ classification: "changed", material: true });
  });

  it("marks a new exclusion as added by the insurer", () => {
    const c = confirmation();
    c.terms.push({ termType: "exclusion", label: "Political violence", value: "Excluded", amount: null, currency: null, unclear: false });
    expect(find(verifyCoverMatch(basis(), c), "Political violence")).toMatchObject({ classification: "added_by_insurer", material: true, acceptedValue: null });
  });

  it("marks a condition the confirmation left out as missing", () => {
    const c = confirmation({ terms: basis().terms.filter((t) => t.termType !== "condition") });
    expect(find(verifyCoverMatch(basis(), c), "Tracking devices")).toMatchObject({ classification: "missing_from_confirmation", material: true, confirmedValue: null });
  });

  it("marks a condition only the insurer added", () => {
    const c = confirmation();
    c.terms.push({ termType: "condition", label: "Garaged overnight", value: "Required", amount: null, currency: null, unclear: false });
    expect(find(verifyCoverMatch(basis(), c), "Garaged overnight").classification).toBe("added_by_insurer");
  });

  it("marks a changed effective date", () => {
    const item = find(verifyCoverMatch(basis(), confirmation({ effectiveAt: "2026-10-15T00:00:00.000Z" })), "Cover begins");
    expect(item).toMatchObject({ classification: "changed", material: true });
  });

  it("treats the same moment written differently as the same date", () => {
    const item = find(verifyCoverMatch(basis(), confirmation({ effectiveAt: "2026-10-01T03:00:00+03:00" })), "Cover begins");
    expect(item.classification).toBe("match");
  });

  it("marks a value that cannot be compared as unclear, and material", () => {
    const c = confirmation();
    c.terms[0] = { ...c.terms[0]!, value: "As per policy wording", unclear: true };
    const item = find(verifyCoverMatch(basis(), c), "Own damage");
    expect(item).toMatchObject({ classification: "unclear", material: true });
  });

  it("counts every difference when there are several", () => {
    const c = confirmation({ premiumAmount: "5410000.00" });
    c.terms[0] = { ...c.terms[0]!, value: "7.5%" };
    c.terms.push({ termType: "exclusion", label: "Riots", value: "Excluded", amount: null, currency: null, unclear: false });
    expect(summarise(verifyCoverMatch(basis(), c)).material).toBe(3);
  });

  it("does not let silence on a field pass as agreement", () => {
    const item = find(verifyCoverMatch(basis(), confirmation({ expiryAt: null })), "Cover ends");
    expect(item.classification).toBe("missing_from_confirmation");
  });

  it("never matches the client's own conditions: they are resolved separately, one by one", () => {
    const items = verifyCoverMatch(basis({ clientConditions: "Subject to inspection" }), confirmation());
    expect(items.find((i) => i.label === "Client conditions")).toBeUndefined();
    expect(items.every((i) => i.acceptedValue !== "Subject to inspection")).toBe(true);
  });

  it("reports a field neither side states as not applicable, never as a blank", () => {
    expect(find(verifyCoverMatch(basis(), confirmation()), "Premium basis").classification).toBe("not_applicable");
  });
});

describe("the end of cover (4B-4B)", () => {
  const noEnd = (over: Partial<BasisSide> = {}) => basis({ expiryAt: null, ...over });

  it("an end date the client never accepted is a material term the insurer added", () => {
    const item = find(verifyCoverMatch(noEnd(), confirmation({ expiryAt: "2027-09-30T23:59:59.000Z" })), "Cover ends");
    expect(item).toMatchObject({ classification: "added_by_insurer", material: true, calculation: null });
  });

  it("assumes no annual term: without an accepted end or period, twelve months is not a match either", () => {
    const item = find(verifyCoverMatch(noEnd(), confirmation({ expiryAt: "2027-10-01T00:00:00.000Z" })), "Cover ends");
    expect(item.classification).toBe("added_by_insurer");
  });

  it("an explicit accepted period and the exact derived end is a match, with its calculation", () => {
    const item = find(verifyCoverMatch(noEnd({ periodMonths: 12, periodDays: 0 }), confirmation({ expiryAt: "2027-10-01T00:00:00.000Z" })), "Cover ends");
    expect(item).toMatchObject({ classification: "match", material: false, acceptedValue: "2027-10-01T00:00:00.000Z" });
    expect(item.calculation).toBe("Cover begins 1 Oct 2026 + 12 months = 1 Oct 2027, from the cover period in the client's accepted instruction.");
  });

  it("an explicit period and a different end is a changed term", () => {
    const item = find(verifyCoverMatch(noEnd({ periodMonths: 12, periodDays: 0 }), confirmation({ expiryAt: "2027-09-30T23:59:59.000Z" })), "Cover ends");
    expect(item).toMatchObject({ classification: "changed", material: true });
    expect(item.calculation).toMatch(/\+ 12 months = 1 Oct 2027/);
  });

  it("derives months then days, and a missing month end falls to that month's last day", () => {
    expect(endOfPeriod("2026-10-01T00:00:00.000Z", 6, 0)).toBe("2027-04-01T00:00:00.000Z");
    expect(endOfPeriod("2026-10-01T00:00:00.000Z", 0, 90)).toBe("2026-12-30T00:00:00.000Z");
    expect(endOfPeriod("2027-01-31T00:00:00.000Z", 1, 0)).toBe("2027-02-28T00:00:00.000Z");
  });

  it("an accepted end date is compared as a date, and a period does not override it", () => {
    const item = find(verifyCoverMatch(basis({ periodMonths: 12 }), confirmation()), "Cover ends");
    expect(item).toMatchObject({ classification: "match", calculation: null });
  });
});

describe("the calendar-month rule, at its boundaries (D-101, confirmed)", () => {
  const cases: [string, number, number, string, string][] = [
    ["2027-01-31T00:00:00.000Z", 1, 0, "2027-02-28T00:00:00.000Z", "31 Jan + 1 month, common year → 28 Feb"],
    ["2028-01-31T00:00:00.000Z", 1, 0, "2028-02-29T00:00:00.000Z", "31 Jan + 1 month, leap year → 29 Feb"],
    ["2026-11-30T00:00:00.000Z", 3, 0, "2027-02-28T00:00:00.000Z", "30 Nov + 3 months → 28 Feb"],
    ["2027-11-30T00:00:00.000Z", 3, 0, "2028-02-29T00:00:00.000Z", "30 Nov + 3 months into a leap year → 29 Feb"],
    ["2026-08-31T00:00:00.000Z", 6, 0, "2027-02-28T00:00:00.000Z", "31 Aug + 6 months → 28 Feb"],
    ["2026-03-31T00:00:00.000Z", 1, 0, "2026-04-30T00:00:00.000Z", "31 Mar + 1 month → 30 Apr"],
    ["2027-12-31T00:00:00.000Z", 2, 0, "2028-02-29T00:00:00.000Z", "31 Dec + 2 months across a year end → 29 Feb"],
    ["2028-02-29T00:00:00.000Z", 12, 0, "2029-02-28T00:00:00.000Z", "29 Feb + 12 months → 28 Feb"],
    ["2028-02-29T00:00:00.000Z", 48, 0, "2032-02-29T00:00:00.000Z", "29 Feb + 48 months → 29 Feb"],
    ["2026-01-31T00:00:00.000Z", 13, 0, "2027-02-28T00:00:00.000Z", "31 Jan + 13 months → 28 Feb"],
    ["2027-01-31T00:00:00.000Z", 1, 1, "2027-03-01T00:00:00.000Z", "months first, then days: 31 Jan + 1 month + 1 day → 1 Mar"],
    ["2026-10-01T09:30:00.000Z", 12, 0, "2027-10-01T09:30:00.000Z", "to the same instant"],
  ];
  for (const [start, months, days, end, why] of cases) {
    it(why, () => {
      expect(endOfPeriod(start, months, days)).toBe(end);
    });
  }

  it("an explicit end date always wins: no derivation beside it", async () => {
    const { derivedEnd } = await import("../src/placement/cover-match.js");
    expect(derivedEnd("2027-01-31T00:00:00.000Z", "2027-06-30T00:00:00.000Z", 12, 0)).toEqual({ derivedExpiryAt: null, derivation: null });
    expect(derivedEnd("2027-01-31T00:00:00.000Z", null, null, null)).toEqual({ derivedExpiryAt: null, derivation: null });
    expect(derivedEnd("2027-01-31T00:00:00.000Z", null, 1, 0)).toEqual({
      derivedExpiryAt: "2027-02-28T00:00:00.000Z",
      derivation: "Cover begins 31 Jan 2027 + 1 month = 28 Feb 2027, from the cover period in the client's accepted instruction.",
    });
  });
});
