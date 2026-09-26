import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComparisonSpace } from "./ComparisonSpace.js";
import { renderInRouter } from "../test-utils.js";
import { resetWorkspaceTabs } from "../shell/workspace-tabs.js";

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

/**
 * The quotes, beside each other (4B-3).
 *
 * What these lock:
 *  - the title is the work's own name, never "Quote Comparison Space";
 *  - an insurer silent on a term reads as silent, in words, not as an empty cell or a colour;
 *  - a comparison that no longer describes the quotes says so and names what moved;
 *  - the cheapest quote is not called best, and the recommendation's caveats are on screen;
 *  - a stale comparison offers no way to put it to the client.
 */

const ORG = "10000000-0000-4000-8000-00000000000a";
const OPP = "30000000-0000-4000-8000-00000000000a";
const CLIENT = "20000000-0000-4000-8000-00000000000a";
const INS_A = "21000000-0000-4000-8000-00000000000a";
const INS_B = "21000000-0000-4000-8000-00000000000b";
const RESP_A = "34000000-0000-4000-8000-00000000000a";
const RESP_B = "34000000-0000-4000-8000-00000000000b";
const CMP = "36000000-0000-4000-8000-00000000000a";

const ME = {
  user: { id: "90000000-0000-4000-8000-000000000001", email: "a@b.test", display_name: "Amina", full_name: null },
  memberships: [],
  active_organization: { id: ORG, name: "Acme Brokers", country: "KE", currency: "KES", timezone: "UTC" },
  permissions: [],
};

function column(insurerId: string, insurerName: string, responseId: string, premium: string | null) {
  return {
    insurerId,
    insurerName,
    responseId,
    receivedAt: "2026-09-05T09:00:00.000Z",
    premiumAmount: premium,
    premiumCurrency: premium === null ? null : "KES",
    validUntil: "2027-12-31",
    validity: {
      state: "valid",
      validUntil: "2027-12-31",
      note: "These terms hold until 2027-12-31.",
      thresholdDays: 14,
      thresholdSource: "ASAP's default of 14 days, because no rule has been set for this brokerage.",
    },
    source: null,
  };
}

function cell(insurerId: string, over: Record<string, unknown> = {}) {
  return {
    insurerId,
    value: "5% of claim, minimum KES 30,000",
    amount: null,
    currency: null,
    missing: false,
    unclear: false,
    corrected: false,
    evidence: null,
    ...over,
  };
}

function body(over: Record<string, unknown> = {}) {
  return {
    opportunity: {
      id: OPP,
      title: "Acme motor fleet quotation — 2027",
      classOfBusiness: "Commercial motor",
      coverStart: "2027-01-01",
      coverEnd: "2027-12-31",
      closedAt: null,
    },
    client: { id: CLIENT, name: "Acme Ltd" },
    readiness: {
      ready: true,
      blockers: [],
      approached: 2,
      quoted: 2,
      declined: 0,
      awaiting: [],
      missingInformation: [],
    },
    viewingHistory: false,
    comparison: {
      id: CMP,
      version: 1,
      generatedAt: "2026-09-06T09:00:00.000Z",
      generatedByName: "Amina",
      presentedAt: null,
      presentedByName: null,
      stale: false,
      staleReason: null,
      changes: [],
      changedValues: [],
      presentable: { can: true, reason: null },
      columns: [column(INS_B, "CIC", RESP_B, "5620000.00"), column(INS_A, "Jubilee", RESP_A, "5310000.00")],
      rows: [
        {
          termType: "excess",
          label: "Own damage",
          cells: [cell(INS_B), cell(INS_A)],
          incomplete: false,
        },
      ],
      recommendation: {
        insurerId: null,
        insurerName: null,
        headline: "ASAP is not recommending one of these.",
        facts: ["Jubilee is KES 310,000 cheaper than CIC — 5.5%."],
        reasoning: [
          "No rule has been set for when ASAP may name a recommended quote, so it does not.",
          "The differences are set out above; which cover suits this client is a judgement for the broker.",
        ],
        caveats: [],
        rule: null,
      },
    },
    history: [],
    permissions: { canGenerate: true, canPresent: true },
    ...over,
  };
}

let sent: { url: string; method: string; body: unknown }[] = [];

function stubApi(reading: unknown, action?: unknown) {
  sent = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
    if (method !== "GET") sent.push({ url: u, method, body: JSON.parse(String((init as RequestInit).body ?? "{}")) });
    if (u.endsWith("/me")) return json(ME);
    if (u.includes("/comparison/actions")) {
      return json({ outcome: "done", reason: null, comparison: action ?? reading });
    }
    if (u.endsWith("/comparison")) return json(reading);
    return json({});
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  resetWorkspaceTabs();
});

const open = () => renderInRouter(<ComparisonSpace />, `/opportunities/${OPP}/comparison`);

describe("the comparison", () => {
  it("is titled by the work's own name, never 'Quote Comparison Space'", async () => {
    stubApi(body());
    await open();

    await waitFor(() =>
      expect(screen.getAllByText("Acme motor fleet quotation — 2027").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/Quote Comparison Space|Comparison Space/i)).toBeNull();
  });

  it("puts the insurers side by side with their premiums", async () => {
    stubApi(body());
    await open();

    await waitFor(() => expect(screen.getAllByText("KES 5,310,000").length).toBeGreaterThan(0));
    expect(screen.getAllByText("KES 5,620,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Jubilee").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CIC").length).toBeGreaterThan(0);
  });

  it("says in words that an insurer did not state a term, rather than leaving a blank", async () => {
    stubApi(
      body({
        comparison: {
          ...body().comparison,
          rows: [
            {
              termType: "excess",
              label: "Theft excess",
              cells: [cell(INS_B, { missing: true, value: null }), cell(INS_A)],
              incomplete: true,
            },
          ],
        },
      }),
    );
    await open();

    /* Not a colour, not an empty cell: the sentence itself. */
    await waitFor(() => expect(screen.getAllByText("Not stated").length).toBeGreaterThan(0));
  });

  it("marks a term that cannot be compared as such", async () => {
    stubApi(
      body({
        comparison: {
          ...body().comparison,
          rows: [
            {
              termType: "excess",
              label: "Own damage",
              cells: [cell(INS_B, { unclear: true, value: "As per policy wording" }), cell(INS_A)],
              incomplete: false,
            },
          ],
        },
      }),
    );
    await open();

    await waitFor(() =>
      expect(screen.getAllByText(/As per policy wording — cannot be compared/).length).toBeGreaterThan(0),
    );
  });
});

describe("when nothing can be compared yet", () => {
  it("names who has not answered rather than saying 'Waiting'", async () => {
    stubApi(
      body({
        readiness: {
          ready: false,
          blockers: ["No insurer has quoted yet, so there is nothing to compare.", "With CIC since 2026-09-01 — no answer yet."],
          approached: 2,
          quoted: 0,
          declined: 0,
          awaiting: [{ insurerName: "CIC", since: "2026-09-01" }],
          missingInformation: [],
        },
        comparison: null,
      }),
    );
    await open();

    await waitFor(() => expect(screen.getAllByText(/With CIC since/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/No comparison has been made yet/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Waiting$/)).toBeNull();
  });
});

describe("when the last comparison lapsed", () => {
  it("does not say one was never made", async () => {
    stubApi(
      body({
        comparison: null,
        history: [
          {
            id: CMP,
            version: 1,
            generatedAt: "2026-09-06T09:00:00.000Z",
            generatedByName: "Amina",
            presentedAt: null,
            supersededAt: "2026-09-08T09:00:00.000Z",
            supersededReason: "Jubilee changed its quote after this comparison was made.",
          },
        ],
      }),
    );
    await open();

    await waitFor(() =>
      expect(screen.getAllByText("The last comparison is out of date").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText("No comparison has been made yet")).toBeNull();
    expect(screen.getAllByRole("button", { name: /Compare them again/i }).length).toBeGreaterThan(0);
  });
});

describe("when the quotes have moved", () => {
  const stale = body({
    comparison: {
      ...body().comparison,
      stale: true,
      staleReason: 'Jubilee changed the term "Own damage" after this comparison was made.',
      presentable: {
        can: false,
        reason: 'Jubilee changed the term "Own damage" after this comparison was made.',
      },
      changes: [
        {
          insurerId: INS_A,
          insurerName: "Jubilee",
          termType: "excess",
          label: "Own damage",
          change: "This term changed.",
        },
      ],
    },
  });

  it("says so, and names the insurer and the term", async () => {
    stubApi(stale);
    await open();

    await waitFor(() =>
      expect(screen.getAllByText(/This comparison is out of date/).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/Jubilee — Own damage/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("This term changed.").length).toBeGreaterThan(0);
  });

  it("offers no way to put a stale one to the client", async () => {
    stubApi(stale);
    await open();

    await waitFor(() => expect(screen.getAllByText(/out of date/).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: /went to the client/i })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Compare them again/i }).length).toBeGreaterThan(0);
  });
});

describe("what it recommends", () => {
  it("states the differences and names nobody when no rule is configured", async () => {
    stubApi(body());
    await open();

    await waitFor(() =>
      expect(screen.getAllByText("ASAP is not recommending one of these.").length).toBeGreaterThan(0),
    );
    /* The fact is on screen; the judgement is not made. */
    expect(screen.getAllByText(/Jubilee is KES 310,000 cheaper than CIC/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/judgement for the broker/).length).toBeGreaterThan(0);
  });

  it("shows a recommendation as the brokerage's own rule, with its provenance", async () => {
    stubApi(
      body({
        comparison: {
          ...body().comparison,
          recommendation: {
            insurerId: INS_A,
            insurerName: "Jubilee",
            headline: "Jubilee, under this brokerage's own rule.",
            facts: ["Jubilee is KES 310,000 cheaper than CIC — 5.5%."],
            reasoning: ["It remains a recommendation. Whether the cover suits this client is the broker's judgement."],
            caveats: [],
            rule: {
              summary: "Name the cheaper quote when the same cover is priced twice and the gap is at least 5%.",
              source: "Partners meeting, 4 September 2026.",
              verifiedAt: "2026-09-04",
            },
          },
        },
      }),
    );
    await open();

    await waitFor(() =>
      expect(screen.getAllByText("Jubilee, under this brokerage's own rule.").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/Partners meeting, 4 September 2026/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/the broker's judgement/).length).toBeGreaterThan(0);
  });

  it("shows an abstention as an abstention, with what it could not weigh", async () => {
    stubApi(
      body({
        comparison: {
          ...body().comparison,
          recommendation: {
            insurerId: null,
            insurerName: null,
            headline: "These quotes are not yet like for like.",
            facts: ["CIC did not state Theft excess."],
            reasoning: ["This brokerage's rule applies only where the same cover is priced twice."],
            caveats: ["CIC: Theft excess was stated in terms that cannot be compared."],
            rule: {
              summary: "Name the cheaper quote when the gap is at least 5%.",
              source: "Partners meeting.",
              verifiedAt: "2026-09-04",
            },
          },
        },
      }),
    );
    await open();

    await waitFor(() =>
      expect(screen.getAllByText(/These quotes are not yet like for like/).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/CIC did not state Theft excess/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Bear in mind: CIC: Theft excess was stated in terms that cannot be compared/).length,
    ).toBeGreaterThan(0);
  });
});


describe("what the client was shown", () => {
  it("shows what a value said then and what it says now", async () => {
    stubApi(
      body({
        comparison: {
          ...body().comparison,
          stale: true,
          staleReason: "Jubilee changed its quote after this comparison was made.",
          presentable: { can: false, reason: "Jubilee changed its quote after this comparison was made." },
          changedValues: [
            {
              insurerId: INS_A,
              insurerName: "Jubilee",
              termType: null,
              label: "Premium",
              was: "KES 5,310,000",
              now: "KES 5,410,000",
            },
            {
              insurerId: INS_A,
              insurerName: "Jubilee",
              termType: "excess",
              label: "Own damage",
              was: "5% min KES 30,000",
              now: "5% min KES 50,000",
            },
          ],
        },
      }),
    );
    await open();

    await waitFor(() =>
      expect(screen.getAllByText(/Was KES 5,310,000 → now KES 5,410,000/).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/Was 5% min KES 30,000 → now 5% min KES 50,000/).length).toBeGreaterThan(0);
  });

  it("says plainly when an earlier version is being read", async () => {
    stubApi(
      body({
        viewingHistory: true,
        comparison: { ...body().comparison, version: 1 },
        history: [
          {
            id: "36000000-0000-4000-8000-00000000000b",
            version: 2,
            generatedAt: "2026-09-09T09:00:00.000Z",
            generatedByName: "Amina",
            presentedAt: null,
            supersededAt: null,
            supersededReason: null,
          },
        ],
      }),
    );
    await open();

    await waitFor(() =>
      expect(screen.getAllByText(/You are reading version 1, as it was made/).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/not what the quotes say now/).length).toBeGreaterThan(0);
    /* And the other versions are reachable, each at its own address. */
    const links = screen.getAllByRole("link", { name: /See what this one showed/i });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]!.getAttribute("href")).toContain("version=2");
  });

  it("survives a refresh: the reading comes from the server, not from the browser", async () => {
    stubApi(body());
    const first = await open();
    await waitFor(() => expect(screen.getAllByText("KES 5,310,000").length).toBeGreaterThan(0));
    first.unmount();

    await open();
    await waitFor(() => expect(screen.getAllByText("KES 5,310,000").length).toBeGreaterThan(0));
    /* Nothing about the brokerage's quotes may be kept in the browser. */
    expect(Object.keys(localStorage)).not.toContain("comparison");
    expect(JSON.stringify(localStorage)).not.toMatch(/5,310,000|Jubilee|CIC/);
  });
});

describe("how long a quote holds", () => {
  it("names each validity state in words, not by colour", async () => {
    stubApi(
      body({
        comparison: {
          ...body().comparison,
          presentable: {
            can: false,
            reason: "Jubilee has let these terms expire. An expired quotation is not an offer.",
          },
          columns: [
            {
              ...column(INS_B, "CIC", RESP_B, "5620000.00"),
              validity: {
                state: "not_stated",
                validUntil: null,
                note: "The insurer did not say how long these terms hold.",
                thresholdDays: 14,
                thresholdSource: "ASAP's default of 14 days, because no rule has been set for this brokerage.",
              },
            },
            {
              ...column(INS_A, "Jubilee", RESP_A, "5310000.00"),
              validity: {
                state: "expired",
                validUntil: "2026-01-01",
                note: "These terms have expired. Ask the insurer to confirm them again.",
                thresholdDays: 14,
                thresholdSource: "ASAP's default of 14 days, because no rule has been set for this brokerage.",
              },
            },
          ],
        },
      }),
    );
    await open();

    await waitFor(() => expect(screen.getAllByText(/Expired —/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Not stated — The insurer did not say how long/).length).toBeGreaterThan(0);
  });

  it("offers no way to put an expired comparison to the client, and says why", async () => {
    stubApi(
      body({
        comparison: {
          ...body().comparison,
          presentable: {
            can: false,
            reason: "Jubilee has let these terms expire. An expired quotation is not an offer.",
          },
        },
      }),
    );
    await open();

    await waitFor(() =>
      expect(screen.getAllByText("This cannot go to the client yet").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/An expired quotation is not an offer/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /went to the client/i })).toBeNull();
  });
});

describe("what a person can do", () => {
  it("records that a current comparison went to the client", async () => {
    stubApi(
      body(),
      body({
        comparison: {
          ...body().comparison,
          presentedAt: "2026-09-07T09:00:00.000Z",
          presentedByName: "Amina",
        },
      }),
    );
    await open();

    await waitFor(() =>
      expect(screen.getAllByText("ASAP is not recommending one of these.").length).toBeGreaterThan(0),
    );
    await userEvent.click(screen.getAllByRole("button", { name: /went to the client/i })[0]!);

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toEqual({ action: "present_comparison", comparisonId: CMP });
    await waitFor(() =>
      expect(screen.getAllByText(/This comparison went to the client/).length).toBeGreaterThan(0),
    );
  });

  it("offers nothing to press for somebody who may not change the work", async () => {
    stubApi(body({ permissions: { canGenerate: false, canPresent: false } }));
    await open();

    await waitFor(() =>
      expect(screen.getAllByText("ASAP is not recommending one of these.").length).toBeGreaterThan(0),
    );
    expect(screen.queryByRole("button", { name: /went to the client/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Compare/i })).toBeNull();
  });
});
