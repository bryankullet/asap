import { describe, expect, it } from "vitest";
import { draftProblems } from "./live.js";

describe("an unsafe draft is never sendable", () => {
  const ok = { to: "claims@cic.co.ke", subject: "Claim notice", body: "Dear CIC, we notify a motor claim.", insured: "Tausi Hauliers Ltd", insurer: "CIC", policy: "TH-MTR-001" };
  it("a complete draft has no problems", () => expect(draftProblems(ok)).toEqual([]));
  it.each([
    [{ ...ok, body: "Vehicle undefined was damaged" }, /blank value/],
    [{ ...ok, subject: "Claim for null" }, /blank value/],
    [{ ...ok, to: "claims@cic.insurer.demo" }, /not a real address/],
    [{ ...ok, to: "x@example.com" }, /not a real address/],
    [{ ...ok, insured: "" }, /insured is missing/],
    [{ ...ok, insurer: null }, /insurer is not resolved/],
    [{ ...ok, policy: null }, /no policy/],
  ])("blocks %o", (d, why) => expect(draftProblems(d).join("; ")).toMatch(why));
  it("a policy explicitly recorded as not known is allowed", () => expect(draftProblems({ ...ok, policy: null, policyUnknown: true })).toEqual([]));
});
