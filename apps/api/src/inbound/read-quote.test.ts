import { describe, expect, it } from "vitest";
import { readInsurerReply } from "./read-quote.js";

const SENT = "2026-10-05T05:00:00.000Z";

describe("reading an insurer's reply from its own words (D-152)", () => {
  it("reads the premium from the sentence that says premium, and the validity", () => {
    const r = readInsurerReply("Dear broker, our quotation for the five trucks is attached. Premium KES 5,310,000 inclusive of levies. Excess KES 30,000. Valid for 30 days.", SENT, false);
    expect(r).toMatchObject({ outcome: "quoted", premiumAmount: "5310000.00", premiumCurrency: "KES", validUntil: "2026-11-04" });
    expect(r!.evidence.map((e) => e.field)).toEqual(["premium", "valid_until"]);
  });
  it("reads KSh and a stated validity date", () => {
    expect(readInsurerReply("Our terms: KSh 612,000 for three pickups. Offer valid until 30 November 2026.", SENT, false)).toMatchObject({ premiumAmount: "612000.00", premiumCurrency: "KES", validUntil: "2026-11-30" });
  });
  it("reads a decline and its reason", () => {
    expect(readInsurerReply("Regret we are unable to offer terms owing to the claims experience.", SENT, true)).toMatchObject({ outcome: "declined", declineReason: "Regret we are unable to offer terms owing to the claims experience." });
  });
  it("says nothing when the amount is not clear", () => {
    expect(readInsurerReply("Premium KES 5,310,000 for comprehensive or KES 3,900,000 third party.", SENT, false)).toBeNull();
    expect(readInsurerReply("Please find our quotation attached.", SENT, false)).toBeNull();
  });
});
