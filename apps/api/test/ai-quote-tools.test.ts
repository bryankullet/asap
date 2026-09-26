/**
 * The two quotation tools a model may reach (4B-3).
 *
 * The danger these guard against is the model filling a gap with a kind word. An insurer who has
 * not answered must not come back as anything a sentence could round to "quoted", and a
 * comparison whose quotes have moved must not come back as a set of figures.
 */
import { describe, expect, it } from "vitest";
import { toolByName } from "../src/ai/tools/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const OPP = "30000000-0000-4000-8000-00000000000a";
const INS_A = "21000000-0000-4000-8000-00000000000a";
const INS_B = "21000000-0000-4000-8000-00000000000b";
const APPROACH_A = "31000000-0000-4000-8000-00000000000a";
const APPROACH_B = "31000000-0000-4000-8000-00000000000b";
const RESP_A = "34000000-0000-4000-8000-00000000000a";
const iso = "2026-09-05T09:00:00.000Z";

function context(tables: FakeDb["tables"]) {
  const db: FakeDb = { users: {}, inserts: [], rpc: {}, tables };
  return { db: fakeFactory(db).service(), organizationId: ORG };
}

const DOC = "3a000000-0000-4000-8000-00000000000a";

const baseTables = () => ({
  insurers: [
    { id: INS_A, organization_id: ORG, name: "Jubilee" },
    { id: INS_B, organization_id: ORG, name: "CIC" },
  ],
  opportunity_insurers: [
    { id: APPROACH_A, organization_id: ORG, opportunity_id: OPP, insurer_id: INS_A, added_at: iso, removed_at: null },
    { id: APPROACH_B, organization_id: ORG, opportunity_id: OPP, insurer_id: INS_B, added_at: iso, removed_at: null },
  ],
  insurer_responses: [
    {
      id: RESP_A, organization_id: ORG, opportunity_insurer_id: APPROACH_A, outcome: "quoted",
      received_at: iso, premium_amount: "5310000.00", premium_currency: "KES",
      valid_until: "2027-12-31", decline_reason: null,
    },
  ],
  quote_terms: [
    {
      id: "35000000-0000-4000-8000-00000000000a", organization_id: ORG, insurer_response_id: RESP_A,
      term_type: "excess", label: "Own damage", extracted_value: "5% min KES 30,000",
      corrected_value: null, amount: null, currency: null, unclear: false,
    },
  ],
  quote_comparisons: [],
  company_rules: [],
  documents: [
    {
      id: DOC, organization_id: ORG, client_id: "20000000-0000-4000-8000-00000000000a",
      filename: "jubilee-quotation.pdf", extraction_state: "extracted",
      extraction_error: null as string | null,
      deleted_at: null,
    },
  ],
  document_term_proposals: [
    {
      id: "3c000000-0000-4000-8000-00000000000a", organization_id: ORG, document_id: DOC, ordinal: 0,
      term_type: "excess", label: "Own damage excess", proposed_value: "5% min KES 30,000",
      corrected_value: null, amount: "30000.00", currency: "KES", page_number: 2,
      region_x: "50", region_y: "120", region_width: "300", region_height: "12",
      condition: "known", state: "proposed",
    },
    {
      id: "3c000000-0000-4000-8000-00000000000b", organization_id: ORG, document_id: DOC, ordinal: 1,
      term_type: "excess", label: "Theft excess", proposed_value: "10% of claim",
      corrected_value: "12% of claim", amount: null, currency: null, page_number: 2,
      region_x: "50", region_y: "140", region_width: "300", region_height: "12",
      condition: "known", state: "corrected",
    },
  ],
});

describe("get_quotes", () => {
  it("says an insurer has not answered rather than leaving it out", async () => {
    const rows = (await toolByName("get_quotes")!.run({ opportunityId: OPP }, context(baseTables()))) as {
      insurerName: string;
      outcome: string;
      premiumAmount: string | null;
    }[];

    expect(rows).toHaveLength(2);
    const cic = rows.find((r) => r.insurerName === "CIC")!;
    expect(cic.outcome).toBe("not_recorded");
    expect(cic.premiumAmount).toBeNull();
  });

  it("returns the outcome as it is stored, and the terms with it", async () => {
    const rows = (await toolByName("get_quotes")!.run({ opportunityId: OPP }, context(baseTables()))) as {
      insurerName: string;
      outcome: string;
      premiumAmount: string | null;
      terms: { label: string; value: string; corrected: boolean }[];
    }[];

    const jubilee = rows.find((r) => r.insurerName === "Jubilee")!;
    expect(jubilee.outcome).toBe("quoted");
    expect(jubilee.premiumAmount).toBe("5310000.00");
    expect(jubilee.terms[0]).toMatchObject({ label: "Own damage", value: "5% min KES 30,000", corrected: false });
  });
});

describe("get_quote_comparison", () => {
  it("says plainly that none has been made", async () => {
    const out = (await toolByName("get_quote_comparison")!.run({ opportunityId: OPP }, context(baseTables()))) as {
      comparison: unknown;
      note: string;
    };
    expect(out.comparison).toBeNull();
    expect(out.note).toMatch(/No comparison has been made/);
  });

  it("refuses to hand back a superseded comparison as the current one", async () => {
    const tables = baseTables();
    tables.quote_comparisons = [
      {
        id: "36000000-0000-4000-8000-00000000000a", organization_id: ORG, opportunity_id: OPP,
        generated_at: iso, presented_at: null, superseded_at: iso,
        superseded_reason: "Jubilee changed its quote after this comparison was made.",
      },
    ] as never;

    const out = (await toolByName("get_quote_comparison")!.run({ opportunityId: OPP }, context(tables))) as {
      comparison: unknown;
      note: string;
      earlier: number;
    };
    expect(out.comparison).toBeNull();
    expect(out.note).toMatch(/out of date. Make it again before quoting figures/);
    expect(out.earlier).toBe(1);
  });

  it("hands back the current one when nothing has moved", async () => {
    const tables = baseTables();
    tables.quote_comparisons = [
      {
        id: "36000000-0000-4000-8000-00000000000a", organization_id: ORG, opportunity_id: OPP,
        generated_at: iso, presented_at: null, superseded_at: null, superseded_reason: null,
      },
    ] as never;

    const out = (await toolByName("get_quote_comparison")!.run({ opportunityId: OPP }, context(tables))) as {
      comparison: { stale: boolean; id: string };
    };
    expect(out.comparison.stale).toBe(false);
    expect(out.comparison.id).toBe("36000000-0000-4000-8000-00000000000a");
  });
});


describe("get_quotation_reading", () => {
  it("returns every reading with the page and rectangle it came from", async () => {
    const out = (await toolByName("get_quotation_reading")!.run({ documentId: DOC }, context(baseTables()))) as {
      terms: { label: string; page: number; region: { y: number }; reviewState: string }[];
    };
    expect(out.terms).toHaveLength(2);
    expect(out.terms[0]).toMatchObject({ label: "Own damage excess", page: 2, reviewState: "proposed" });
    expect(out.terms[0]!.region.y).toBe(120);
  });

  it("marks an unreviewed reading as a proposal, not as the insurer's terms", async () => {
    const out = (await toolByName("get_quotation_reading")!.run({ documentId: DOC }, context(baseTables()))) as {
      terms: { reviewState: string }[];
    };
    expect(out.terms.map((t) => t.reviewState)).toEqual(["proposed", "corrected"]);
  });

  it("says when a document could not be read at all", async () => {
    const tables = baseTables();
    tables.documents[0]!.extraction_error =
      "This document has no readable text. It is most likely a scan.";
    const out = (await toolByName("get_quotation_reading")!.run({ documentId: DOC }, context(tables))) as {
      needsManualReview: string;
    };
    expect(out.needsManualReview).toMatch(/scan/);
  });
});

describe("get_company_rules", () => {
  it("says plainly that no rule permits a recommendation", async () => {
    const out = (await toolByName("get_company_rules")!.run({}, context(baseTables()))) as {
      rules: unknown[];
      note: string;
    };
    expect(out.rules).toHaveLength(0);
    expect(out.note).toMatch(/names none/);
  });

  it("returns the rule with its provenance when one exists", async () => {
    const tables = baseTables();
    tables.company_rules = [
      {
        key: "quote.recommendation",
        value: { mode: "cheapest_when_like_for_like", minimumGapPercent: 8 },
        source: "Partners meeting, 4 September 2026.",
        verified_at: "2026-09-04",
        organization_id: ORG,
      },
    ] as never;
    const out = (await toolByName("get_company_rules")!.run({}, context(tables))) as {
      rules: { source: string }[];
      note: string | null;
    };
    expect(out.rules[0]!.source).toBe("Partners meeting, 4 September 2026.");
    expect(out.note).toBeNull();
  });
});
