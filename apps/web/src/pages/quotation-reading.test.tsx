import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuotationReading } from "./QuotationReading.js";
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
 * Reviewing what ASAP read from a quotation (4B-3A).
 *
 * What these lock: a reading is shown as a reading and never as the insurer's terms; the page it
 * came from is on screen; ASAP does not guess which insurer's answer the document is; and a
 * person without the permission is told why rather than shown a button that fails.
 */

const ORG = "10000000-0000-4000-8000-00000000000a";
const DOC = "3a000000-0000-4000-8000-00000000000a";
const OPP = "30000000-0000-4000-8000-00000000000a";
const RESP = "34000000-0000-4000-8000-00000000000a";

const ME = {
  user: { id: "90000000-0000-4000-8000-000000000001", email: "a@b.test", display_name: "Amina", full_name: null },
  memberships: [],
  active_organization: { id: ORG, name: "Acme Brokers", country: "KE", currency: "KES", timezone: "UTC" },
  permissions: [],
};

function proposal(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    ordinal: 0,
    termType: "excess",
    label: "Own damage excess",
    proposedValue: "5% of claim, minimum KES 30,000",
    amount: "30000.00",
    currency: "KES",
    page: 2,
    region: { x: 50, y: 120, width: 300, height: 12 },
    condition: "known",
    method: "labelled_line",
    state: "proposed",
    correctedValue: null,
    reviewedByName: null,
    reviewedAt: null,
    quoteTermId: null,
    ...over,
  };
}

function body(over: Record<string, unknown> = {}) {
  return {
    document: { id: DOC, filename: "jubilee-quotation.pdf", pageCount: 3, extractionState: "extracted" },
    needsManualReview: null,
    linkedTo: { insurerResponseId: RESP, insurerName: "Jubilee", opportunityId: OPP },
    fields: [
      { fieldKey: "premium", proposedValue: "KES 5,310,000", correctedValue: null, page: 1, condition: "known", state: "proposed" },
    ],
    proposals: [
      proposal("3c000000-0000-4000-8000-00000000000a"),
      proposal("3c000000-0000-4000-8000-00000000000b", {
        ordinal: 1,
        label: "Theft excess",
        proposedValue: "As per policy wording",
        condition: "unclear",
        amount: null,
        currency: null,
      }),
    ],
    permissions: { canReview: true },
    ...over,
  };
}

let sent: { url: string; method: string; body: unknown }[] = [];

function stubApi(reading: unknown, after?: unknown) {
  sent = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
    if (method !== "GET") sent.push({ url: u, method, body: JSON.parse(String((init as RequestInit).body ?? "{}")) });
    if (u.endsWith("/me")) return json(ME);
    if (u.includes("/quotation/actions")) return json({ outcome: "done", reason: null, reading: after ?? reading });
    if (u.endsWith("/quotation")) return json(reading);
    return json({});
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  resetWorkspaceTabs();
});

const open = () => renderInRouter(<QuotationReading />, `/documents/${DOC}/quotation`);

describe("what ASAP read", () => {
  it("shows each reading as a reading, never as the insurer's terms", async () => {
    stubApi(body());
    await open();

    await waitFor(() =>
      expect(screen.getAllByText(/NONE OF IT IS A TERM UNTIL YOU SAY SO/i).length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText("Excess — Own damage excess").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Not reviewed/).length).toBeGreaterThan(0);
  });

  it("says which page each reading came from", async () => {
    stubApi(body());
    await open();
    await waitFor(() => expect(screen.getAllByText(/Read from page 2 of jubilee-quotation.pdf/).length).toBeGreaterThan(0));
  });

  it("marks a reading that cannot be compared", async () => {
    stubApi(body());
    await open();
    await waitFor(() =>
      expect(screen.getAllByText(/As per policy wording — cannot be compared/).length).toBeGreaterThan(0),
    );
  });

  it("says a scanned document needs a person, rather than showing an empty quotation", async () => {
    stubApi(
      body({
        needsManualReview:
          "This document has no readable text. It is most likely a scan, and ASAP cannot read scanned documents yet — the terms have to be entered by hand.",
        proposals: [],
      }),
    );
    await open();

    await waitFor(() => expect(screen.getAllByText("ASAP could not read this document").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/cannot read scanned documents yet/).length).toBeGreaterThan(0);
  });

  it("says when nothing was recognised, without implying the quotation is empty", async () => {
    stubApi(body({ proposals: [] }));
    await open();
    await waitFor(() =>
      expect(screen.getAllByText("No terms were found in this document").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/may be the document, and it may be ASAP/).length).toBeGreaterThan(0);
  });
});

describe("whose answer it is", () => {
  it("does not guess, and says it will not", async () => {
    stubApi(body({ linkedTo: null }));
    await open();

    await waitFor(() =>
      expect(screen.getAllByText("Nobody has said which insurer's answer this is").length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText(/will not guess it from a name on the page/).length).toBeGreaterThan(0);
  });

  it("refuses to confirm a reading until somebody has said, with the reason on the control", async () => {
    stubApi(body({ linkedTo: null }));
    await open();

    const accept = await screen.findAllByRole("button", { name: /This is right/i });
    expect(accept[0]).toBeDisabled();
    expect(accept[0]!.getAttribute("title")).toMatch(/Choose which insurer's answer/);
  });
});

describe("deciding", () => {
  it("sends the decision to the server and shows what came back", async () => {
    stubApi(
      body(),
      body({
        proposals: [
          proposal("3c000000-0000-4000-8000-00000000000a", {
            state: "accepted",
            reviewedByName: "Amina",
            reviewedAt: "2026-09-07T09:00:00.000Z",
          }),
        ],
      }),
    );
    await open();

    await userEvent.click((await screen.findAllByRole("button", { name: /This is right/i }))[0]!);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toEqual({
      action: "accept_proposal",
      proposalId: "3c000000-0000-4000-8000-00000000000a",
    });
    await waitFor(() => expect(screen.getAllByText(/Accepted by Amina/).length).toBeGreaterThan(0));
  });

  it("offers no decision to somebody who may not review", async () => {
    stubApi(body({ permissions: { canReview: false } }));
    await open();

    const accept = await screen.findAllByRole("button", { name: /This is right/i });
    expect(accept[0]).toBeDisabled();
    expect(accept[0]!.getAttribute("title")).toMatch(/may not review/);
  });

  it("keeps nothing from the document in the browser", async () => {
    stubApi(body());
    await open();
    await waitFor(() => expect(screen.getAllByText("Excess — Own damage excess").length).toBeGreaterThan(0));
    expect(JSON.stringify(localStorage)).not.toMatch(/30,000|Jubilee|policy wording/);
  });
});
