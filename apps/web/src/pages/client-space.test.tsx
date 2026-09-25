import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClientSpace } from "./ClientSpace.js";
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
 * One client, as a Space (D-083).
 *
 * What these lock:
 *  - the Space is called by the client's own name, and never "Client Space";
 *  - a section with nothing in it is absent, not an empty heading — except a gap that affects
 *    the work, which is stated;
 *  - an action without a contract is disabled with its reason, never a button that looks like
 *    it worked;
 *  - two clients open at once are two Spaces with nothing shared between them.
 */

const ORG = "10000000-0000-4000-8000-00000000000a";
const ACME = "20000000-0000-4000-8000-00000000000a";
const SOLO = "20000000-0000-4000-8000-00000000000b";

const ME = {
  user: { id: "90000000-0000-4000-8000-000000000001", email: "a@b.test", display_name: "Amina", full_name: null },
  memberships: [],
  active_organization: { id: ORG, name: "Acme Brokers", country: "KE", currency: "KES", timezone: "UTC" },
  permissions: [],
};

const FULL_PERMS = { canEditContacts: true, canUploadDocuments: true, canStartWork: true };

function clientSpace(over: Record<string, unknown> = {}) {
  return {
    client: { id: ACME, name: "Acme Ltd", kind: "corporate", fileStatus: "in_review", createdAt: "2026-01-01T00:00:00.000Z" },
    contacts: [
      { id: "c1000000-0000-4000-8000-000000000001", fullName: "Wanjiku Kamau", roleLabel: "Finance manager", email: "w@acme.test", phone: null, isPrimary: true },
      { id: "c1000000-0000-4000-8000-000000000002", fullName: "Peter Mwangi", roleLabel: "Operations", email: null, phone: null, isPrimary: false },
    ],
    policies: [
      {
        id: "c2000000-0000-4000-8000-000000000001",
        policyNumber: "MOT-1188",
        classOfBusiness: "Motor",
        insurerName: "Jubilee",
        periods: [
          { id: "c3000000-0000-4000-8000-000000000001", periodStart: "2026-01-01", periodEnd: "2026-12-31", premiumAmount: "214500.00", premiumCurrency: "KES", premiumBasis: "gross", commissionAmount: "32175.00", premiumSource: "document", premiumVerifiedAt: "2026-02-01T00:00:00.000Z", premiumEvidenceDocumentId: "c6000000-0000-4000-8000-000000000001", current: true },
          { id: "c3000000-0000-4000-8000-000000000002", periodStart: "2025-01-01", periodEnd: "2025-12-31", premiumAmount: "198000.00", premiumCurrency: "KES", premiumBasis: "gross", commissionAmount: null, premiumSource: "import", premiumVerifiedAt: null, premiumEvidenceDocumentId: null, current: false },
        ],
      },
    ],
    work: [
      { id: "c4000000-0000-4000-8000-000000000001", kind: "renewal", title: "Motor renewal", taskStatus: "with_party", taskParty: "Jubilee", taskSince: "2026-08-12T00:00:00.000Z", ownerName: "Amina", completedAt: null },
    ],
    claims: [
      { id: "c5000000-0000-4000-8000-000000000001", workItemId: "c4000000-0000-4000-8000-000000000002", status: "registered", incidentOn: "2026-08-01", incidentSummary: "Windscreen broken", insurerReference: "JUB-99", policyId: "c2000000-0000-4000-8000-000000000001" },
    ],
    endorsements: [],
    documents: [{ id: "c6000000-0000-4000-8000-000000000001", filename: "schedule.pdf", kind: "policy_schedule", extractionState: "extracted", createdAt: "2026-02-01T00:00:00.000Z" }],
    threads: [{ id: "c7000000-0000-4000-8000-000000000001", subject: "Renewal terms", lastMessageAt: "2026-08-12T00:00:00.000Z", messageCount: 3 }],
    fileMissing: ["KRA PIN certificate"],
    mailboxConnected: true,
    permissions: FULL_PERMS,
    gaps: [
      { id: "quotation", label: "Start quotation work", reason: "Quotations are not built yet, so there is nothing to open.", gap: "4B-2" },
      { id: "money", label: "Premium and balance", reason: "Invoices and payments have no records yet, so ASAP cannot say what is outstanding.", gap: "4D" },
    ],
    ...over,
  };
}

/** A client with nothing but a name. */
function bareClient(id: string, name: string) {
  return {
    client: { id, name, kind: "individual", fileStatus: "not_started", createdAt: "2026-01-01T00:00:00.000Z" },
    contacts: [],
    policies: [],
    work: [],
    claims: [],
    endorsements: [],
    documents: [],
    threads: [],
    fileMissing: [],
    mailboxConnected: false,
    permissions: FULL_PERMS,
    gaps: [],
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
      if (u.includes(`/clients/${id}/space`)) return json(body);
    }
    if (u.endsWith("/work-items")) return json({ outcome: "opened", item: { id: "c8000000-0000-4000-8000-000000000001" }, reopened: false });
    return json({});
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  resetWorkspaceTabs();
});

describe("a company with cover", () => {
  it("is titled by the client's own name, never 'Client Space'", async () => {
    stubApi({ [ACME]: clientSpace() });
    await renderInRouter(<ClientSpace />, `/clients/${ACME}`);

    await waitFor(() => expect(screen.getAllByText("Acme Ltd").length).toBeGreaterThan(0));
    expect(screen.queryByText(/Client Space/i)).toBeNull();
  });

  it("shows the facts that matter, and the sections that have something in them", async () => {
    stubApi({ [ACME]: clientSpace() });
    await renderInRouter(<ClientSpace />, `/clients/${ACME}`);

    await waitFor(() => expect(screen.getByText("CONTACTS")).toBeInTheDocument());
    expect(screen.getByText("COVER — HISTORY IS NEVER OVERWRITTEN")).toBeInTheDocument();
    expect(screen.getByText("OUTSTANDING WORK")).toBeInTheDocument();
    expect(screen.getByText("CLAIMS")).toBeInTheDocument();
    expect(screen.getByText("DOCUMENTS")).toBeInTheDocument();
    expect(screen.getByText("EMAIL")).toBeInTheDocument();
    // Nothing is recorded against endorsements, so there is no heading for them.
    expect(screen.queryByText("SERVICING AND ENDORSEMENTS")).toBeNull();
  });

  it("names the outside party and the date rather than saying 'Waiting'", async () => {
    stubApi({ [ACME]: clientSpace() });
    await renderInRouter(<ClientSpace />, `/clients/${ACME}`);

    await waitFor(() => expect(screen.getByText(/With Jubilee since/)).toBeInTheDocument());
    expect(screen.queryByText(/^Waiting$/)).toBeNull();
  });

  it("says where a premium came from and whether a document backs it", async () => {
    stubApi({ [ACME]: clientSpace() });
    await renderInRouter(<ClientSpace />, `/clients/${ACME}`);

    await waitFor(() => expect(screen.getByText(/KES 214,500/)).toBeInTheDocument());
    /* Reveal every explanation, then look for the one the verified premium carries. */
    for (const why of screen.getAllByRole("button", { name: "Why is this here?" })) {
      await userEvent.click(why);
    }
    expect(screen.getByText(/Checked against a document/)).toBeInTheDocument();
    expect(screen.getByText(/Recorded from an import, and not yet checked/)).toBeInTheDocument();
  });

  it("states the gaps that affect the work", async () => {
    stubApi({ [ACME]: clientSpace() });
    await renderInRouter(<ClientSpace />, `/clients/${ACME}`);

    await waitFor(() => expect(screen.getByText(/still waiting for KRA PIN certificate/)).toBeInTheDocument());
    expect(screen.getByText(/recorded but not checked against a document/)).toBeInTheDocument();
  });
});

describe("a client with nothing", () => {
  it("shows no empty headings, and says why there is no email", async () => {
    stubApi({ [SOLO]: bareClient(SOLO, "Grace Otieno") });
    await renderInRouter(<ClientSpace />, `/clients/${SOLO}`);

    await waitFor(() => expect(screen.getAllByText("Grace Otieno").length).toBeGreaterThan(0));
    expect(screen.queryByText("CONTACTS")).toBeNull();
    expect(screen.queryByText("COVER — HISTORY IS NEVER OVERWRITTEN")).toBeNull();
    expect(screen.queryByText("CLAIMS")).toBeNull();
    // No mailbox is a different fact to no correspondence, and it is the one said.
    expect(screen.getByText("No mailbox is connected")).toBeInTheDocument();
  });

  it("says nobody is recorded to write to", async () => {
    stubApi({ [SOLO]: bareClient(SOLO, "Grace Otieno") });
    await renderInRouter(<ClientSpace />, `/clients/${SOLO}`);
    await waitFor(() => expect(screen.getByText(/Nobody is recorded as the contact/)).toBeInTheDocument());
  });
});

describe("what a person can do", () => {
  it("starts a renewal through the real contract, with the client's id", async () => {
    stubApi({ [ACME]: clientSpace() });
    await renderInRouter(<ClientSpace />, `/clients/${ACME}`);

    await waitFor(() => expect(screen.getByRole("button", { name: "Start a renewal" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Start a renewal" }));

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ method: "POST", body: { kind: "renewal", clientId: ACME } });
  });

  it("offers what is not built as unavailable, with its reason and the increment", async () => {
    stubApi({ [ACME]: clientSpace() });
    await renderInRouter(<ClientSpace />, `/clients/${ACME}`);

    await waitFor(() => expect(screen.getByText("Not built (4B-2)")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Start quotation work" })).toBeDisabled();
    expect(screen.getAllByText(/Quotations are not built yet/).length).toBeGreaterThan(0);
    // Pressing it writes nothing, because it cannot be pressed.
    expect(sent).toHaveLength(0);
  });

  it("disables an action the session may not perform, and says so rather than hiding it", async () => {
    stubApi({
      [ACME]: clientSpace({ permissions: { canEditContacts: false, canUploadDocuments: false, canStartWork: false } }),
    });
    await renderInRouter(<ClientSpace />, `/clients/${ACME}`);

    await waitFor(() => expect(screen.getByRole("button", { name: "Start a renewal" })).toBeDisabled());
    expect(screen.getAllByText("You may not start work in this brokerage.").length).toBeGreaterThan(0);
  });
});

describe("two clients at once", () => {
  it("keeps their records, titles and tabs apart", async () => {
    stubApi({ [ACME]: clientSpace(), [SOLO]: bareClient(SOLO, "Grace Otieno") });

    const first = await renderInRouter(<ClientSpace />, `/clients/${ACME}`);
    await waitFor(() => expect(screen.getAllByText("Acme Ltd").length).toBeGreaterThan(0));
    expect(screen.getAllByText("MOT-1188 · Jubilee").length).toBeGreaterThan(0);
    first.unmount();

    await renderInRouter(<ClientSpace />, `/clients/${SOLO}`);
    await waitFor(() => expect(screen.getAllByText("Grace Otieno").length).toBeGreaterThan(0));
    // Nothing of Acme's survived into the second client.
    expect(screen.queryByText("MOT-1188 · Jubilee")).toBeNull();
    expect(screen.queryByText("Acme Ltd")).toBeNull();
    expect(screen.queryByText(/Windscreen broken/)).toBeNull();
  });
});

describe("a client that is not there", () => {
  it("says so rather than showing an error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      const json = (v: unknown, status = 200) =>
        new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json" } });
      if (u.endsWith("/me")) return json(ME);
      return json({ error: "not_found", message: "No client with that id" }, 404);
    });
    await renderInRouter(<ClientSpace />, `/clients/${ACME}`);
    await waitFor(() => expect(screen.getByText("This client is not here.")).toBeInTheDocument());
  });
});

describe("Ask, on a client", () => {
  it("scopes the question to the client a person is looking at", async () => {
    const asked: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      const method = (init as RequestInit | undefined)?.method ?? "GET";
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
      if (u.endsWith("/me")) return json(ME);
      if (u.endsWith("/ask") && method === "POST") {
        asked.push(JSON.parse(String((init as RequestInit).body ?? "{}")));
        return json({
          conversationId: "c9000000-0000-4000-8000-000000000001",
          state: "abstained",
          answer: "Nothing to say in this test.",
          plan: null,
          suggestions: [],
          citations: [],
        });
      }
      if (u.includes(`/clients/${ACME}/space`)) return json(clientSpace());
      return json({});
    });

    const { AskComposer } = await import("../shell/AskComposer.js");
    await renderInRouter(
      <>
        <ClientSpace />
        <AskComposer />
      </>,
      `/clients/${ACME}`,
    );

    await waitFor(() => expect(screen.getAllByText("Acme Ltd").length).toBeGreaterThan(0));
    const box = screen.getByRole("textbox");
    await userEvent.type(box, "what is their latest claim?");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(asked).toHaveLength(1));
    // "Their" means this client, not the brokerage at large.
    expect(asked[0]).toMatchObject({ scope: { kind: "client", id: ACME } });
  });
});
