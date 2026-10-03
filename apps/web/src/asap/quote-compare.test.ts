/**
 * Quotations compared as read (staging finding, D-135): three documents, one read only in part;
 * every value tied to its document and page; missing never shown as zero or included; no pick.
 */
import { describe, expect, it } from "vitest";
import { compareQuotations } from "./quote-compare.js";

type Reading = Parameters<typeof compareQuotations>[0][number];

const field = (
  fieldKey: string,
  proposedValue: string | null,
  extra: Record<string, unknown> = {},
) => ({
  fieldKey,
  proposedValue,
  correctedValue: null,
  page: proposedValue ? 1 : null,
  condition: proposedValue ? "known" : "missing",
  state: "proposed",
  ...extra,
});
const term = (
  termType: string,
  label: string,
  proposedValue: string | null,
  extra: Record<string, unknown> = {},
) => ({
  id: label,
  ordinal: 0,
  termType,
  label,
  proposedValue,
  amount: null,
  currency: null,
  page: 1,
  region: null,
  condition: proposedValue ? "known" : "unclear",
  method: "text",
  state: "proposed",
  correctedValue: null,
  reviewedByName: null,
  reviewedAt: null,
  quoteTermId: null,
  ...extra,
});
const reading = (
  id: string,
  filename: string,
  fields: unknown[],
  proposals: unknown[],
  extra: Record<string, unknown> = {},
): Reading =>
  ({
    document: { id, filename, pageCount: 1, extractionState: "extracted" },
    needsManualReview: null,
    linkedTo: null,
    fields,
    proposals,
    permissions: { canReview: true },
    ...extra,
  }) as unknown as Reading;

const APA = reading(
  "d1",
  "02_UX_TEST_Quotation_APA.pdf",
  [
    field("insurer_name", "UX TEST APA"),
    field("premium", "245,000"),
    field("currency", "KES"),
    field("quote_valid_until", "2026-10-31"),
  ],
  [
    term("excess", "Own damage", "2.5% min KES 20,000"),
    term("limit", "Third party property", "KES 3,000,000"),
    term("exclusion", "Unlicensed drivers", "Excluded"),
  ],
);
const CIC = reading(
  "d2",
  "03_UX_TEST_Quotation_CIC.pdf",
  [
    field("insurer_name", "UX TEST CIC"),
    field("premium", "231,500"),
    field("currency", "KES"),
    field("quote_valid_until", "2026-10-05"),
  ],
  [term("excess", "Own damage", null)],
);
const JUB = reading(
  "d3",
  "04_UX_TEST_Quotation_Jubilee.pdf",
  [
    field("insurer_name", "UX TEST Jubilee"),
    field("premium", null),
    field("quote_valid_until", null),
  ],
  [],
);
const TODAY = Date.UTC(2026, 9, 3);

describe("compareQuotations", () => {
  const c = compareQuotations(
    [APA, CIC, JUB],
    (doc, key) => (key === "premium" ? doc + ":premium" : null),
    TODAY,
  );
  const row = (label: string) => c.rows.find((r) => r.label === label)!.cells.map((x) => x.v);

  it("one column per quotation, named by the insurer the document gives", () => {
    expect(c.cols).toEqual(["UX TEST APA", "UX TEST CIC", "UX TEST Jubilee"]);
  });

  it("values are marked as readings until confirmed; absence is 'not found', never zero or included", () => {
    expect(row("Premium")).toEqual([
      "KES 245,000 (read, not confirmed)",
      "KES 231,500 (read, not confirmed)",
      "Not found in the document",
    ]);
    expect(row("Excess")[2]).toBe("Not found in the document");
    expect(row("Limits")).toEqual([
      "Third party property: KES 3,000,000 (read, not confirmed)",
      "Not found in the document",
      "Not found in the document",
    ]);
    expect(row("Geographic scope")).toEqual(Array(3).fill("Not read by ASAP — check the document"));
    expect(row("Payment terms")[0]).toBe("Not read by ASAP — check the document");
    expect(
      c.rows.flatMap((r) => r.cells.map((x) => x.v)).some((v) => /^0$|included/i.test(v)),
    ).toBe(false);
  });

  it("every value shown has its document and page, opening at the field where there is one", () => {
    const premium = c.evidence.find((e) => e.insurer === "UX TEST APA" && e.label === "Premium")!;
    expect(premium).toMatchObject({
      documentId: "d1",
      fieldId: "d1:premium",
      page: 1,
      confirmed: false,
    });
    expect(c.evidence.every((e) => e.documentId && (e.page === null || e.page >= 1))).toBe(true);
  });

  it("never recommends, and says which material terms are missing from which quotation", () => {
    expect(c.recommendation).toBeNull();
    expect(c.missingMaterial).toEqual([
      { insurer: "UX TEST CIC", labels: ["Limits"] },
      { insurer: "UX TEST Jubilee", labels: ["Premium", "Excess", "Limits", "Valid until"] },
    ]);
    expect(c.whyNoRecommendation).toMatch(
      /^No quotation can be recommended: material terms are missing — UX TEST CIC \(Limits\); UX TEST Jubilee/,
    );
  });

  it("lists what could hurt the client, each with where it was read", () => {
    const texts = c.risks.map((r) => r.insurer + ": " + r.text);
    expect(texts).toContain("UX TEST APA: Excludes: Unlicensed drivers — Excluded");
    expect(texts).toContain("UX TEST CIC: These terms lapse on 2026-10-05 — within a week.");
    expect(
      texts.some((t) =>
        /UX TEST CIC: Excess “Own damage” is stated in words that cannot be compared/.test(t),
      ),
    ).toBe(true);
    expect(texts).toContain(
      "UX TEST Jubilee: No excess was found in this quotation — the client could not tell what they would pay on a claim.",
    );
  });

  it("a document that could not be read is said to be unreadable, not empty", () => {
    const scan = reading("d4", "scan.pdf", [], [], {
      needsManualReview: "This file is an image with no text layer.",
    });
    const r = compareQuotations([APA, scan], () => null, TODAY);
    expect(r.rows.find((x) => x.label === "Premium")!.cells[1]!.v).toBe("Could not be read");
  });

  it("confirmed values lose the caveat; ASAP still picks no insurer", () => {
    const confirmed = reading(
      "d5",
      "x.pdf",
      [
        field("insurer_name", "UX TEST APA"),
        field("premium", "245,000", { state: "accepted" }),
        field("quote_valid_until", "2026-12-31", { state: "accepted" }),
      ],
      [
        term("excess", "Own damage", "KES 20,000", { state: "accepted" }),
        term("limit", "TPPD", "KES 3m", { state: "accepted" }),
      ],
    );
    const r = compareQuotations([confirmed, confirmed], () => null, TODAY);
    expect(r.rows.find((x) => x.label === "Premium")!.cells[0]!.v).toBe("245,000");
    expect(r.recommendation).toBeNull();
    expect(r.whyNoRecommendation).toBe(
      "ASAP does not recommend an insurer. The client chooses from the confirmed terms.",
    );
  });

  it("a term labelled only with its kind is not said twice", () => {
    const r = compareQuotations(
      [
        reading(
          "d6",
          "a.pdf",
          [field("insurer_name", "UX TEST APA")],
          [
            term("exclusion", "Exclusions", "Unlicensed drivers"),
            term("excess", "Excess", "KES 20,000"),
          ],
        ),
        reading("d7", "b.pdf", [field("insurer_name", "UX TEST CIC")], []),
      ],
      () => null,
      TODAY,
    );
    expect(r.risks.map((x) => x.text)).toContain("Excludes: Unlicensed drivers");
    expect(r.evidence.map((e) => e.label)).toEqual(
      expect.arrayContaining(["Exclusions", "Excess"]),
    );
    expect(r.rows.find((x) => x.label === "Excess")!.cells[0]!.v).toBe(
      "KES 20,000 (read, not confirmed)",
    );
  });
});
