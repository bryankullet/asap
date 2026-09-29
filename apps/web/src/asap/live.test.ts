import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Live mode over a brokerage's records, with the API answered in the shapes its Zod contracts
 * define. What is asserted is what a person would see: real rows, cover only when the server
 * verified it, and honest refusals where the API does not reach yet.
 */
const ORG = "10000000-0000-4000-8000-00000000000a";
const ME = "20000000-0000-4000-8000-000000000001";
const CLIENT = "30000000-0000-4000-8000-000000000001";
const POL_OK = "40000000-0000-4000-8000-000000000001";
const POL_UNVERIFIED = "40000000-0000-4000-8000-000000000002";
const PER_OK = "50000000-0000-4000-8000-000000000001";
const PER_UNVERIFIED = "50000000-0000-4000-8000-000000000002";
const WORK = "60000000-0000-4000-8000-000000000001";
const AUTO = "70000000-0000-4000-8000-000000000001";

const setAutomationEnabled = vi.fn(async () => ({}));
const createClient = vi.fn(async (input: { name: string; confirmNew?: boolean }) =>
  input.confirmNew || input.name !== "Tausi Haulier"
    ? { outcome: "created", file: { client: { id: "30000000-0000-4000-8000-0000000000ff" } } }
    : { outcome: "possible_duplicates", name: input.name, candidates: [{ id: CLIENT, name: "Tausi Hauliers Ltd", kind: "corporate" }] },
);
const previewImport = vi.fn(async (input: { premiumBasis: string | null }) => ({
  batch: { id: "80000000-0000-4000-8000-000000000001", filename: "book.csv", rowCount: 2, premiumBasis: input.premiumBasis },
  source: "csv",
  sheetName: null,
  rows: [{ id: "r1", lineNumber: 2, outcome: "create", problem: null, clientName: "Simba Traders", contactName: null, contactEmail: null, policyNumber: "ST-1", insurerName: "First Insurer", classOfBusiness: "Motor", periodStart: "2026-01-01", periodEnd: "2026-12-31" }],
  summary: { rows: 1, clientsToCreate: 1, contactsToCreate: 0, policiesToCreate: 1, needsReview: 0, invalid: 0 },
  columns: [{ header: "Premium", meaning: "premium" }],
  blocking: input.premiumBasis ? [] : ["Say whether the premiums are gross or total payable."],
  mappedByModel: [],
}));
const commitImport = vi.fn(async () => ({ batch: { filename: "book.csv", clientsCreated: 1, contactsCreated: 0, policiesCreated: 1, periodsCreated: 1 }, failures: [] }));
const createOpportunity = vi.fn(async () => ({ opportunityId: "90000000-0000-4000-8000-000000000001", workItemId: WORK }));
const createWorkItem = vi.fn(async () => ({ outcome: "opened", reopened: false, item: { id: WORK } }));
const createAutomation = vi.fn(async () => ({}));
const askQuestion = vi.fn(async () => ({ state: "not_configured", conversationId: null, message: null, suggestions: [] }));
const saveTurns = vi.fn(async () => ({ conversationId: "a0000000-0000-4000-8000-000000000001" }));

vi.mock("../lib/supabase.js", () => ({ supabase: { auth: { signOut: async () => ({}) } } }));
vi.mock("../lib/api.js", () => ({
  describeApiError: (e: unknown) => (e instanceof Error ? e.message : "failed"),
  api: {
    members: async () => ({
      members: [{ membership_id: ME, user: { id: ME, email: "wanjiru@example.test", full_name: "Wanjiru Kamau", display_name: null, last_seen_at: null }, role: { id: ME, key: "owner", name: "Owner" }, is_owner: true, status: "active", joined_at: "2026-09-01" }],
    }),
    mailboxes: async () => ({ mailboxes: [], providers: [] }),
    automations: async () => ({
      automations: [{ id: AUTO, organization_id: ORG, name: "Renewal preparation", description: "Prepare the renewal pack", trigger_event: "renewal.approaching", conditions: [], skill: "renewal.prepare", prepared_verb: "prepare", approval: "always", sends_externally: false, enabled: false, created_by: ME, created_at: "2026-09-01", updated_at: "2026-09-01" }],
    }),
    audit: async () => ({ recordId: null, entries: [{ id: "a1", actorType: "user", actorName: "Wanjiru Kamau", action: "client.created", objectType: "client", objectId: CLIENT, result: "success", failureReason: null, changed: [], evidence: [], occurredAt: "2026-09-02T09:00:00Z" }], visible: 1, returned: 1 }),
    opportunities: async () => ({ opportunities: [] }),
    workList: async (view: string) => ({
      items:
        view === "needs"
          ? [{ rank: 1, reason: "Renewal is 30 days away and no terms are in.", priority: "high", item: { id: WORK, organization_id: ORG, title: "Renew Tausi Hauliers motor fleet", kind: "renewal", client_id: CLIENT, policy_period_id: PER_OK, insurer_id: null, class_of_business: "Motor", owner_id: ME, task_status: "needs_you", task_party: null, task_since: "2026-09-20", task_next_check: null, cover_status: null, cover_inception_at: null, money_status: null, reason: null, steps: [], exception: null, version: 1 } }]
          : [],
    }),
    clientFiles: async (view: string) => ({
      view,
      counts: {},
      items: view === "cleared" ? [{ client: { id: CLIENT, organization_id: ORG, name: "Tausi Hauliers Ltd", kind: "corporate", source: "manual", file_status: "cleared", file_owner_id: null, file_decided_by: null, file_decided_at: null, file_decision_reason: null, refresh_interval_days: null, refresh_due_at: null, created_at: "2026-09-01", updated_at: "2026-09-01", deleted_at: null }, effective_status: "cleared", blocking: [], in_state_since: "2026-09-01", documents_held: 0 }] : [],
    }),
    clientSpace: async () => ({
      client: { id: CLIENT, name: "Tausi Hauliers Ltd", kind: "corporate", fileStatus: "cleared", createdAt: "2026-09-01" },
      contacts: [{ id: "c1", fullName: "Otieno Were", roleLabel: "Finance", email: "otieno@example.test", phone: null, isPrimary: true }],
      policies: [
        { id: POL_OK, policyNumber: "TH-MTR-001", classOfBusiness: "Motor", insurerName: "First Insurer", periods: [{ id: PER_OK, periodStart: "2026-01-01", periodEnd: "2026-12-31", premiumAmount: "1200000.00", premiumCurrency: "KES", premiumBasis: "gross", commissionAmount: null, premiumSource: "document", premiumVerifiedAt: "2026-01-02", premiumEvidenceDocumentId: null, current: true }] },
        { id: POL_UNVERIFIED, policyNumber: null, classOfBusiness: "Fire", insurerName: null, periods: [{ id: PER_UNVERIFIED, periodStart: "2026-02-01", periodEnd: "2027-01-31", premiumAmount: null, premiumCurrency: null, premiumBasis: null, commissionAmount: null, premiumSource: "manual", premiumVerifiedAt: null, premiumEvidenceDocumentId: null, current: true }] },
      ],
      work: [], claims: [], endorsements: [], documents: [], threads: [], fileMissing: [], mailboxConnected: false,
      permissions: { canEditContacts: true, canUploadDocuments: true, canStartWork: true },
    }),
    policySpace: async (id: string) => ({
      selectedPeriodId: id === POL_OK ? PER_OK : PER_UNVERIFIED,
      cover:
        id === POL_OK
          ? { state: "active", label: "Active cover", reason: "Insurer confirmation on file.", verified: true, evidence: [{ label: "Insurer confirmation, 20 Dec 2025", documentId: null, recordedAt: "2025-12-20" }], asOf: "2026-09-29" }
          : { state: null, label: "Cover not verified", reason: "No insurer confirmation is on file.", verified: false, evidence: [], asOf: "2026-09-29" },
    }),
    setAutomationEnabled, createClient, previewImport, commitImport, createOpportunity, createWorkItem, createAutomation, askQuestion,
    opportunity: async () => null,
    askStatus: async () => ({ modelConfigured: false }),
    conversations: async () => ({ conversations: [] }),
    conversationMessages: async () => ({ messages: [] }),
    saveTurns,
    document: async () => null,
  },
}));

const me = {
  user: { id: ME, email: "wanjiru@example.test", full_name: "Wanjiru Kamau", display_name: null },
  memberships: [],
  active_organization: { id: ORG, name: "Tausi Brokers", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
  permissions: ["placement:approve", "organization:edit"],
};

async function live() {
  const { loadLiveAdapters } = await import("./live.js");
  return (await loadLiveAdapters({ me, switchToDemo: () => {} })) as {
    records: { actor(): { name: string }; act(t: string, p: unknown, id?: string): unknown; demo: boolean; sel: { clients(): { name: string }[] } };
    ai: { workspace(ref: unknown): { title: string; statusLabel: string; blocks: unknown[]; filters?: { label: string }[] }; route(t: string, c: unknown): Promise<{ lead?: string; ref?: { ws: string }; plan?: { action: string } | null }> };
    documents: { read(f: File): Promise<unknown> };
    greetingChips: string[];
  };
}

const text = (v: unknown) => JSON.stringify(v);

describe("live mode", () => {
  beforeEach(() => setAutomationEnabled.mockClear());

  it("reads the brokerage's own people, clients and work — and no demo records", async () => {
    const A = await live();
    expect(A.records.demo).toBe(false);
    expect(A.records.actor().name).toBe("Wanjiru Kamau");
    expect(A.records.sel.clients().map((c) => c.name)).toEqual(["Tausi Hauliers Ltd"]);
    const today = A.ai.workspace({ ws: "today" });
    expect(text(today)).toContain("Renew Tausi Hauliers motor fleet");
    expect(text(today) + text(A.greetingChips)).not.toMatch(/Acme|KDN|Karibu|Bluewave|GreenCare|Mara Foods/);
  });

  it("says Active cover only where the server verified it", async () => {
    const A = await live();
    const client = text(A.ai.workspace({ ws: "client", clientId: CLIENT }));
    expect(client).toContain("TH-MTR-001");
    const ok = A.ai.workspace({ ws: "policy", clientId: CLIENT, policyYearId: PER_OK });
    expect(ok.statusLabel).toBe("Active cover");
    const unverified = A.ai.workspace({ ws: "policy", clientId: CLIENT, policyYearId: PER_UNVERIFIED });
    expect(unverified.statusLabel).toBe("Cover not verified");
    expect(text(unverified)).not.toContain("KES 0");
  });

  it("shows what is not connected instead of example content", async () => {
    const A = await live();
    for (const ws of ["compare", "money", "reconciliation", "commission", "renewal"]) {
      const w = A.ai.workspace({ ws, clientId: CLIENT });
      expect(w.statusLabel).toBe("Not connected");
      expect(text(w)).not.toMatch(/APA|CIC|Jubilee/);
    }
  });

  it("starts from nothing: a client, a book import, quotation work, a claim and an automation", async () => {
    const A = await live();
    // A client, with the duplicate check.
    const dup = (await A.records.act("client.create", { name: "Tausi Haulier", kind: "Company" })) as { ok: boolean; error: string };
    expect(dup.ok).toBe(false);
    expect(text(A.ai.workspace({ ws: "newclient" }))).toContain("Tausi Hauliers Ltd");
    const made = (await A.records.act("client.create", { name: "Tausi Haulier", kind: "Company", confirmNew: "yes" })) as { ok: boolean };
    expect(made.ok).toBe(true);
    expect(createClient).toHaveBeenLastCalledWith({ name: "Tausi Haulier", kind: "corporate", confirmNew: true });

    // A book: read on the server, the premium basis asked, then committed.
    await A.documents.read(new File(["client,premium"], "book.csv", { type: "text/csv" }));
    const read = (await A.records.act("import.preview", { name: "book.csv" })) as { ok: boolean };
    expect(read.ok).toBe(true);
    expect(text(A.ai.workspace({ ws: "import" }))).toMatch(/gross/);
    await A.records.act("import.basis", { basis: "gross" });
    expect(previewImport).toHaveBeenLastCalledWith(expect.objectContaining({ premiumBasis: "gross" }));
    await A.records.act("import.commit", {});
    // The imported policy is not readable back in this test's fixtures, so success is not claimed.
    expect(commitImport).toHaveBeenCalledWith("80000000-0000-4000-8000-000000000001", { resolutions: [] });
    expect(text(A.ai.workspace({ ws: "import" }))).toMatch(/cannot be read back|Imported book\.csv/);

    // Quotation work and a claim, through the API.
    expect(A.ai.workspace({ ws: "quote", clientId: CLIENT }).title).toMatch(/quotation/);
    await A.records.act("opportunity.create", { clientId: CLIENT, title: "Motor fleet", cls: "Motor", coverStart: "", coverEnd: "" });
    expect(createOpportunity).toHaveBeenCalledWith(expect.not.objectContaining({ coverStart: "" }));
    const noPolicy = (await A.records.act("claim.open", { clientId: CLIENT, incidentOn: "2026-09-20", incidentSummary: "Rear-ended at Westlands", policyId: "" })) as { ok: boolean };
    expect(noPolicy.ok).toBe(false);
    await A.records.act("claim.open", { clientId: CLIENT, incidentOn: "2026-09-20", incidentSummary: "Rear-ended at Westlands", policyId: POL_OK });
    expect(createWorkItem).toHaveBeenCalledWith(expect.objectContaining({ kind: "claim", incidentOn: "2026-09-20", policyId: POL_OK }));
    await A.records.act("claim.open", { clientId: CLIENT, incidentOn: "2026-09-21", incidentSummary: "Windscreen cracked", policyId: "unknown" });
    expect(createWorkItem).toHaveBeenLastCalledWith(expect.objectContaining({ policyUnknown: true }));

    // An automation: a recognised trigger saves switched off; an unrecognised one saves nothing.
    const saved = (await A.records.act("automation.save", { name: "Renewal prep", trigger: "A policy is 30 days from expiry", conditions: "", actions: "Prepare renewal work", approval: "" })) as { ok: boolean };
    expect(saved.ok).toBe(true);
    expect(createAutomation).toHaveBeenCalledWith(expect.objectContaining({ triggerEvent: "renewal.approaching", enabled: false, approval: "always" }));
    const vague = (await A.records.act("automation.save", { name: "Something", trigger: "whenever", conditions: "", actions: "", approval: "" })) as { ok: boolean };
    expect(vague.ok).toBe(false);
    // Conditions ASAP cannot apply are refused rather than stored and ignored.
    const conditional = (await A.records.act("automation.save", { name: "Renewal prep", trigger: "A renewal is near", conditions: "Only motor", actions: "Prepare", approval: "" })) as { ok: boolean };
    expect(conditional.ok).toBe(false);
  });

  it("refuses what is not a real value instead of replacing it", async () => {
    const A = await live();
    const banana = (await A.records.act("client.create", { name: "Simba Traders", kind: "banana" })) as { ok: boolean; error: string };
    expect(banana.ok).toBe(false);
    expect(banana.error).toMatch(/company or a person/);
    const short = (await A.records.act("opportunity.create", { clientId: CLIENT, title: "x", cls: "Motor" })) as { ok: boolean };
    expect(short.ok).toBe(false);
    const unproven = (await A.records.act("opp.action", { id: "o", action: "supply_requirement", requirementId: "r", note: "ok" })) as { ok: boolean };
    expect(unproven.ok).toBe(false);
  });

  it("answers typed-in-a-hurry record questions, saves the transcript on the server, and never claims a workspace opened", async () => {
    const A = await live();
    const typo = await A.ai.route("wht clints do i hav?", {});
    expect(typo.lead).toBe("You have 1 client.");
    const server = (await A.ai.route("Summarise the market mood", { ref: { ws: "today" } })) as { ref: unknown; keepWorkspace?: boolean };
    expect(server.ref).toBeNull();
    expect(server.keepWorkspace).toBe(true);
    await A.records.act("conversation.save", { id: "cnv_main", messages: [{ role: "user", text: "wht clints do i hav?" }, { role: "ai", lead: "You have 1 client.", text: "" }] });
    expect(saveTurns).toHaveBeenCalledWith({ conversationId: null, turns: [{ role: "person", body: "wht clints do i hav?" }, { role: "asap", body: "You have 1 client." }] });
  });

  it("answers the client list from the records and sends what it cannot match to the server", async () => {
    const A = await live();
    const list = await A.ai.route("What clients do I have?", {});
    expect(list.lead).toBe("You have 1 client.");
    expect(list.ref?.ws).toBe("clients");
    const other = await A.ai.route("Summarise the market mood", {});
    expect(askQuestion).toHaveBeenCalled();
    expect(other.lead).toMatch(/No model is configured/);
    const add = await A.ai.route("add Simba Traders as a client", {});
    expect(add.plan?.action).toBe("client.create");
  });

  it("uses the accepted Work views and shows no simulated connection controls", async () => {
    const A = await live();
    const work = A.ai.workspace({ ws: "work" });
    expect(work.filters?.map((f) => f.label)).toEqual(["Your work", "With others", "In progress", "Done", "Recent"]);
    expect(text(work)).not.toMatch(/"Waiting"|Needs you/);
    const cons = text(A.ai.workspace({ ws: "connections" }));
    expect(cons).not.toMatch(/Simulate|connection\.set/);
    expect(text(A.ai.workspace({ ws: "settings" }))).toContain("Wanjiru Kamau");
  });

  it("writes through the API, and refuses what it cannot do without changing anything", async () => {
    const A = await live();
    const toggled = (await A.records.act("automation.toggle", { id: AUTO }, "t1")) as { ok: boolean };
    expect(toggled.ok).toBe(true);
    expect(setAutomationEnabled).toHaveBeenCalledWith(AUTO, true);
    const refused = (await A.records.act("payment.match", { invoiceId: "x" }, "t2")) as { ok: boolean; error: string };
    expect(refused.ok).toBe(false);
    expect(refused.error).toMatch(/not connected/);
  });
});
