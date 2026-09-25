import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpportunitySpace, QuoteSpace } from "./OpportunitySpace.js";
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
 * Quotation work, and one insurer's terms (D-084).
 *
 * What these lock:
 *  - the title is the work's own name, never "Opportunity Space" or "Quote Space";
 *  - a prepared request is not approved and an approved one is not sent, and the screen says so;
 *  - an insurer who has not answered is never shown as having quoted;
 *  - a corrected term shows what was read as well as what it was corrected to;
 *  - what is missing is stated when it blocks approaching the market.
 */

const ORG = "10000000-0000-4000-8000-00000000000a";
const OPP = "30000000-0000-4000-8000-00000000000a";
const OPP2 = "30000000-0000-4000-8000-00000000000b";
const CLIENT = "20000000-0000-4000-8000-00000000000a";
const WORK = "26000000-0000-4000-8000-00000000000a";
const A = "31000000-0000-4000-8000-00000000000a";
const B = "31000000-0000-4000-8000-00000000000b";
const C = "31000000-0000-4000-8000-00000000000c";
const RESP = "34000000-0000-4000-8000-00000000000a";

const ME = {
  user: { id: "90000000-0000-4000-8000-000000000001", email: "a@b.test", display_name: "Amina", full_name: null },
  memberships: [],
  active_organization: { id: ORG, name: "Acme Brokers", country: "KE", currency: "KES", timezone: "UTC" },
  permissions: [],
};

const PERMS = { canEdit: true, canApprove: true, canRecordResponse: true };
const SENDING = {
  available: false,
  reason: "Sending from ASAP is not connected yet. An approved request can be copied into the mailbox it should go from.",
};

function opportunity(over: Record<string, unknown> = {}) {
  return {
    opportunity: {
      id: OPP,
      title: "Acme motor fleet quotation — 2027",
      classOfBusiness: "Commercial motor",
      riskSummary: "Five commercial vehicles",
      coverStart: "2027-01-01",
      coverEnd: "2027-12-31",
      ownerName: "Amina",
      createdAt: "2026-09-01T00:00:00.000Z",
      closedAt: null,
      closedOutcome: null,
      closedReason: null,
      source: null,
    },
    client: { id: CLIENT, name: "Acme Ltd" },
    workItem: { id: WORK, taskStatus: "with_party", taskParty: "Insurer A", taskSince: "2026-08-12T00:00:00.000Z" },
    requirements: [
      { id: "33000000-0000-4000-8000-00000000000a", label: "Vehicle schedule with declared values", required: true, suppliedAt: null, suppliedByName: null, evidence: null },
      { id: "33000000-0000-4000-8000-00000000000b", label: "Previous year claims history", required: true, suppliedAt: "2026-09-02T00:00:00.000Z", suppliedByName: "Amina", evidence: { kind: "note", id: null, label: "Handed over at the meeting.", path: null } },
    ],
    insurers: [
      {
        id: A,
        insurerId: "21000000-0000-4000-8000-00000000000a",
        insurerName: "Insurer A",
        addedAt: "2026-09-01T00:00:00.000Z",
        removedAt: null,
        removedReason: null,
        request: {
          id: "35000000-0000-4000-8000-00000000000a",
          subject: "Quotation request — Acme Ltd",
          body: "We invite terms.",
          preparedAt: "2026-09-02T00:00:00.000Z",
          preparedByName: "Amina",
          approvedAt: "2026-09-03T00:00:00.000Z",
          approvedByName: "Amina",
          sentAt: null,
          sentEmailMessageId: null,
        },
        response: {
          id: RESP,
          outcome: "quoted",
          receivedAt: "2026-09-05T00:00:00.000Z",
          premiumAmount: "5310000.00",
          premiumCurrency: "KES",
          validUntil: "2026-10-05",
          declineReason: null,
          recordedByName: "Amina",
          source: { kind: "note", id: null, label: "Terms read out by the underwriter.", path: null },
          terms: [
            { id: "36000000-0000-4000-8000-00000000000a", termType: "excess", label: "Own damage excess", extractedValue: "2.5% min 30,000", correctedValue: "2.5% min 35,000", correctedByName: "Amina", correctedAt: "2026-09-06T00:00:00.000Z", amount: null, currency: null, unclear: false, evidence: null },
            { id: "36000000-0000-4000-8000-00000000000b", termType: "excess", label: "Theft excess", extractedValue: null, correctedValue: null, correctedByName: null, correctedAt: null, amount: null, currency: null, unclear: true, evidence: null },
          ],
        },
      },
      {
        id: B,
        insurerId: "21000000-0000-4000-8000-00000000000b",
        insurerName: "Insurer B",
        addedAt: "2026-09-01T00:00:00.000Z",
        removedAt: null,
        removedReason: null,
        request: null,
        response: null,
      },
      {
        id: C,
        insurerId: "21000000-0000-4000-8000-00000000000c",
        insurerName: "Insurer C",
        addedAt: "2026-09-01T00:00:00.000Z",
        removedAt: null,
        removedReason: null,
        request: null,
        response: { id: "34000000-0000-4000-8000-00000000000c", outcome: "declined", receivedAt: "2026-09-04T00:00:00.000Z", premiumAmount: null, premiumCurrency: null, validUntil: null, declineReason: "Outside their appetite for fleets.", recordedByName: "Amina", source: { kind: "note", id: null, label: "By telephone.", path: null }, terms: [] },
      },
    ],
    availableInsurers: [
      { id: "21000000-0000-4000-8000-00000000000a", name: "Insurer A" },
      { id: "21000000-0000-4000-8000-00000000000b", name: "Insurer B" },
      { id: "21000000-0000-4000-8000-00000000000c", name: "Insurer C" },
      { id: "21000000-0000-4000-8000-00000000000d", name: "Insurer D" },
    ],
    documents: [],
    permissions: PERMS,
    sending: SENDING,
    ...over,
  };
}

/** A second, entirely different piece of quotation work. */
function otherOpportunity() {
  return {
    ...opportunity({
      opportunity: {
        id: OPP2,
        title: "Bluewave marine cargo — 2027",
        classOfBusiness: "Marine cargo",
        riskSummary: null,
        coverStart: null,
        coverEnd: null,
        ownerName: null,
        createdAt: "2026-09-01T00:00:00.000Z",
        closedAt: null,
        closedOutcome: null,
        closedReason: null,
        source: null,
      },
      client: { id: "20000000-0000-4000-8000-00000000000b", name: "Bluewave Ltd" },
      requirements: [],
      insurers: [],
      documents: [],
    }),
  };
}

let sent: { url: string; method: string; body: unknown }[] = [];

function stubApi(byId: Record<string, unknown>) {
  sent = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
    if (method !== "GET") sent.push({ url: u, method, body: JSON.parse(String((init as RequestInit).body ?? "{}")) });
    if (u.endsWith("/me")) return json(ME);
    for (const [id, body] of Object.entries(byId)) {
      if (u.includes(`/opportunities/${id}/actions`)) return json({ outcome: "done", reason: null, opportunity: body });
      if (u.endsWith(`/opportunities/${id}`)) return json(body);
    }
    return json({});
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  resetWorkspaceTabs();
});

describe("quotation work", () => {
  it("is titled by the work's own name, never 'Opportunity Space'", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(<OpportunitySpace />, `/opportunities/${OPP}`);

    await waitFor(() =>
      expect(screen.getAllByText("Acme motor fleet quotation — 2027").length).toBeGreaterThan(0),
    );
    expect(screen.queryByText(/Opportunity Space|Quote Space/i)).toBeNull();
  });

  it("names the party holding the work and the date, never a bare 'Waiting'", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(<OpportunitySpace />, `/opportunities/${OPP}`);
    await waitFor(() => expect(screen.getByText(/With Insurer A since/)).toBeInTheDocument());
    expect(screen.queryByText(/^Waiting$/)).toBeNull();
  });

  it("states what is still needed before insurers are asked", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(<OpportunitySpace />, `/opportunities/${OPP}`);
    await waitFor(() => expect(screen.getByText("NEEDED BEFORE INSURERS ARE ASKED")).toBeInTheDocument());
    expect(screen.getAllByText("Vehicle schedule with declared values").length).toBeGreaterThan(0);
  });

  it("shows each insurer's standing in the market's own words", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(<OpportunitySpace />, `/opportunities/${OPP}`);

    await waitFor(() => expect(screen.getByText("Quoted")).toBeInTheDocument());
    expect(screen.getByText("Not asked yet")).toBeInTheDocument();
    expect(screen.getByText("Declined")).toBeInTheDocument();
  });

  it("never says a request was sent, and says why an approved one has not gone", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(<OpportunitySpace />, `/opportunities/${OPP}`);

    await waitFor(() => expect(screen.getByText("Quoted")).toBeInTheDocument());
    expect(screen.queryByText(/\bSent\b/)).toBeNull();
    const why = screen.getAllByRole("button", { name: "Why is this here?" });
    for (const b of why) await userEvent.click(b);
    expect(screen.getAllByText(/Sending from ASAP is not connected yet/).length).toBeGreaterThan(0);
  });

  it("adds an insurer through the real contract", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(<OpportunitySpace />, `/opportunities/${OPP}`);

    await waitFor(() => expect(screen.getByLabelText(/^Insurer/)).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText(/^Insurer/), "21000000-0000-4000-8000-00000000000d");
    await userEvent.click(screen.getByRole("button", { name: "Add this insurer" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      method: "POST",
      body: { action: "add_insurer", insurerId: "21000000-0000-4000-8000-00000000000d" },
    });
  });

  it("prepares a request without sending anything", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(<OpportunitySpace />, `/opportunities/${OPP}`);

    await waitFor(() => expect(screen.getByRole("button", { name: "Prepare the request" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Prepare the request" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toMatchObject({ action: "prepare_request", opportunityInsurerId: B });
    // Nothing anywhere asked to send.
    expect(JSON.stringify(sent)).not.toMatch(/"send/i);
  });

  it("says a single quote cannot be compared yet", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(<OpportunitySpace />, `/opportunities/${OPP}`);
    await waitFor(() => expect(screen.getByText("1 quote ready to compare")).toBeInTheDocument());
    expect(screen.getByText(/A comparison needs at least two/)).toBeInTheDocument();
  });

  it("keeps two opportunities apart", async () => {
    stubApi({ [OPP]: opportunity(), [OPP2]: otherOpportunity() });

    const first = await renderInRouter(<OpportunitySpace />, `/opportunities/${OPP}`);
    await waitFor(() => expect(screen.getAllByText("Acme motor fleet quotation — 2027").length).toBeGreaterThan(0));
    expect(screen.getAllByText("Insurer A").length).toBeGreaterThan(0);
    first.unmount();

    await renderInRouter(<OpportunitySpace />, `/opportunities/${OPP2}`);
    await waitFor(() => expect(screen.getAllByText("Bluewave marine cargo — 2027").length).toBeGreaterThan(0));
    /*
     * None of the first opportunity's records survived. The insurer catalogue is the brokerage's
     * and is shared by design, so this looks for the row and its standing, not for the name.
     */
    expect(screen.queryByText("Quoted")).toBeNull();
    expect(screen.queryByText("Declined")).toBeNull();
    expect(screen.queryByText("INSURERS")).toBeNull();
    expect(screen.queryByText("Acme motor fleet quotation — 2027")).toBeNull();
    expect(screen.queryByText("Acme Ltd")).toBeNull();
  });
});

describe("one insurer's terms", () => {
  it("shows the premium, the terms, and what a correction changed", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(
      <QuoteSpace />,
      `/opportunities/${OPP}/insurers/${A}`,
    );

    await waitFor(() => expect(screen.getAllByText(/Insurer A/).length).toBeGreaterThan(0));
    expect(screen.getByText(/KES 5,310,000/)).toBeInTheDocument();
    expect(screen.getByText("Own damage excess")).toBeInTheDocument();

    const why = screen.getAllByRole("button", { name: "Why is this here?" });
    for (const b of why) await userEvent.click(b);
    // Both values survive, which is the audit.
    expect(screen.getByText(/Read as “2.5% min 30,000”, corrected to “2.5% min 35,000”/)).toBeInTheDocument();
  });

  it("records an uncomparable wording as unclear, not as a figure", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(<QuoteSpace />, `/opportunities/${OPP}/insurers/${A}`);

    await waitFor(() => expect(screen.getByText("NOT YET COMPARABLE")).toBeInTheDocument());
    expect(screen.getByText(/Theft excess — the insurer gave wording, not a figure/)).toBeInTheDocument();
  });

  it("never shows an insurer who has not answered as having quoted", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(<QuoteSpace />, `/opportunities/${OPP}/insurers/${B}`);

    await waitFor(() => expect(screen.getByText("This insurer has not been asked yet")).toBeInTheDocument());
    expect(screen.queryByText(/Quoted/)).toBeNull();
    expect(screen.queryByText(/KES/)).toBeNull();
  });

  it("shows a decline as a decline, with its reason", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(<QuoteSpace />, `/opportunities/${OPP}/insurers/${C}`);

    await waitFor(() => expect(screen.getByText("They declined")).toBeInTheDocument());
    expect(screen.getByText("Outside their appetite for fleets.")).toBeInTheDocument();
  });

  it("says when an insurer is not part of that quotation work", async () => {
    stubApi({ [OPP]: opportunity() });
    await renderInRouter(
      <QuoteSpace />,
      `/opportunities/${OPP}/insurers/31000000-0000-4000-8000-0000000000ff`,
    );
    await waitFor(() =>
      expect(screen.getByText("This insurer is not part of that quotation work.")).toBeInTheDocument(),
    );
  });
});
