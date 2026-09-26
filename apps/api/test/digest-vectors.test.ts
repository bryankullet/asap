/**
 * The TypeScript side of the digest agreement.
 *
 * The database computes these same three digests (0049, 0050) and pins the same vectors in
 * `supabase/tests/0324_digest_vectors.sql`. If the two implementations drift, an approval fails
 * its check constraint and every comparison is born stale — and neither failure names its cause.
 * These vectors are the wire format; changing one invalidates every stored digest.
 */
import { describe, expect, it } from "vitest";
import { responseDigest, termDigest } from "../src/routes/comparisons.js";
import { quoteRequestDigest } from "../src/routes/opportunities.js";

describe("digests agree with the database", () => {
  it("digests a quotation request the same way", () => {
    expect(quoteRequestDigest("Quotation request", "Body one")).toBe(
      "9921624dbd579974c0904a36767a2a94d4233c5d8c01b1acb8b900d31ec40d76",
    );
  });

  /* `premium_amount` is numeric(14,2); the string supabase-js hands back carries that scale. */
  it("digests an insurer response the same way", () => {
    expect(
      responseDigest({
        outcome: "quoted",
        premiumAmount: "5310000.00",
        premiumCurrency: "KES",
        validUntil: "2027-01-31",
      }),
    ).toBe("0871f7dca71ecf2d67cd2d198dd745116f80db6abf0429051323441784f8dc3b");
  });

  it("digests a quote term the same way", () => {
    expect(
      termDigest({
        id: "00000000-0000-4000-8000-000000000000",
        termType: "excess",
        label: "Own damage",
        extractedValue: "5% min 30,000",
        correctedValue: null,
        correctedByName: null,
        correctedAt: null,
        amount: null,
        currency: null,
        unclear: false,
        evidence: null,
      }),
    ).toBe("5122fa7c612d5acb582db6e3daf80c83129e1a56cabbeb5f6d96d4bc2d9141b0");
  });
});
