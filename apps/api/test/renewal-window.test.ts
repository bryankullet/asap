import { describe, expect, it } from "vitest";
import { RENEWAL_DEFAULTS, RENEWAL_DEFAULT_BASIS, renewalWindow } from "../src/workflows/renewal.js";

// A stand-in for company_rules reads: returns the given row for renewal.window, or none.
const db = (row: unknown) => ({ from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }) }) }) as never;

describe("the renewal window (D-130)", () => {
  it("defaults to 60 days ahead, a chase every 5 days and escalation 14 days before expiry", async () => {
    expect(RENEWAL_DEFAULTS).toEqual({ leadDays: 60, followUpDays: 5, escalateDaysBeforeExpiry: 14 });
    const w = await renewalWindow(db(null), "org");
    expect(w).toMatchObject({ leadDays: 60, followUpDays: 5, escalateDaysBeforeExpiry: 14, configured: false, basis: RENEWAL_DEFAULT_BASIS });
  });
  it("a brokerage rule wins, with its source; a malformed rule falls back to the defaults", async () => {
    const w = await renewalWindow(db({ value: { leadDays: 45, followUpDays: 3, escalateDaysBeforeExpiry: 21 }, source: "Partners, 1 Oct", verified_at: "2026-10-01" }), "org");
    expect(w).toMatchObject({ leadDays: 45, followUpDays: 3, escalateDaysBeforeExpiry: 21, configured: true });
    expect((await renewalWindow(db({ value: { leadDays: 0 }, source: "x", verified_at: "2026-10-01" }), "org")).escalateDaysBeforeExpiry).toBe(14);
  });
});
