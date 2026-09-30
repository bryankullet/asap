import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Live mode over a brokerage's records, with the API answered in the shapes its Zod contracts
 * define. What is asserted is what a person would see: real rows, cover only when the server
 * verified it, and honest refusals where the API does not reach yet.
 */
const ORG = "10000000-0000-4000-8000-00000000000a";
const ME = "20000000-0000-4000-8000-000000000001";
const BARAKA = "20000000-0000-4000-8000-000000000002";
const CLIENT = "30000000-0000-4000-8000-000000000001";
const POL_OK = "40000000-0000-4000-8000-000000000001";
const POL_UNVERIFIED = "40000000-0000-4000-8000-000000000002";
const PER_OK = "50000000-0000-4000-8000-000000000001";
const PER_UNVERIFIED = "50000000-0000-4000-8000-000000000002";
const WORK = "60000000-0000-4000-8000-000000000001";
const AUTO = "70000000-0000-4000-8000-000000000001";
const DOC = "b0000000-0000-4000-8000-000000000001";
const FIELD = "b1000000-0000-4000-8000-000000000001";

// The document's one read value; the review mock flips it to accepted, as the server would.
let fieldState = "proposed";
const docDetail = () => ({
  document: { id: DOC, kind: "policy_schedule", filename: "schedule.pdf", mimeType: "application/pdf", byteSize: 1000, pageCount: 1, extractionState: "extracted", extractionError: null, clientId: CLIENT, workItemId: null, createdAt: "2026-09-02" },
  pages: [{ pageNumber: 1, width: 600, height: 800, text: "MOTOR SCHEDULE\nPolicy number: TH-MTR-001\nInsured: Tausi Hauliers Ltd" }],
  fields: [{ id: FIELD, fieldKey: "policy_number", proposedValue: "TH-MTR-001", correctedValue: null, state: fieldState, condition: "inferred", page: 1, region: { x: 60, y: 80, width: 200, height: 20 }, reviewedBy: null, reviewedAt: null }],
  fileUrl: "https://storage.example.test/signed/schedule.pdf?token=t",
  fileUrlExpiresAt: "2026-09-29T12:00:00Z",
});
const reviewDocumentField = vi.fn(async () => {
  fieldState = "accepted";
  return {};
});
const applyTargets = vi.fn(async () => ({ suggestions: [{ targetType: "policy", targetId: POL_OK, label: "TH-MTR-001 · Motor", reason: "Filed under this client and the number matches", condition: "known" }], whyNoTarget: null, applicableFields: { policy: ["policy_number"], policy_period: [], client: [] } }));
const applyPreview = vi.fn(async () => ({
  target: { targetType: "policy", targetId: POL_OK, label: "TH-MTR-001 · Motor", reason: "r", condition: "known" },
  fields: [{ documentFieldId: FIELD, fieldKey: "policy_number", currentValue: null, proposedValue: "TH-MTR-001", page: 1, region: null, condition: "inferred", state: "accepted", unchanged: false, blockedBecause: null }],
  missing: [],
}));
const applyToRecord = vi.fn(async () => ({ applicationId: "b2000000-0000-4000-8000-000000000001" }));

const setAutomationEnabled = vi.fn(async () => ({}));
// Clients created during a test, so the read-back after a create finds them as the server would.
const created: { id: string; name: string }[] = [];
const createClient = vi.fn(async (input: { name: string; kind?: string; confirmNew?: boolean; preview?: boolean }) => {
  if (input.preview)
    return {
      outcome: "preview", name: input.name, kind: input.kind ?? "corporate",
      candidates: /tausi/i.test(input.name) ? [{ id: CLIENT, name: "Tausi Hauliers Ltd", kind: "corporate" }] : [],
      exact: null, missing: ["Primary contact", "Phone", "Email"],
      writes: ["One client record: " + input.name + ", a company", "Its client file, started as not yet begun", "An audit entry against your name"],
      externalEffect: "No message is sent to anyone.",
    };
  if (input.confirmNew || input.name !== "Tausi Haulier") {
    const id = "30000000-0000-4000-8000-0000000000ff";
    if (!created.some((c) => c.id === id)) created.push({ id, name: input.name });
    return { outcome: "created", file: { client: { id } } };
  }
  return { outcome: "possible_duplicates", name: input.name, candidates: [{ id: CLIENT, name: "Tausi Hauliers Ltd", kind: "corporate" }] };
});
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
// A claim created in a test is read back through the client's record, as the server would return it.
const CLAIM = "95000000-0000-4000-8000-000000000001";
const CLAIM_WORK = "96000000-0000-4000-8000-000000000001";
let claimMade: { policyId: string | null; incidentOn: string; incidentSummary: string } | null = null;
const createWorkItem = vi.fn(async (input: { kind: string; policyId?: string; policyUnknown?: boolean; incidentOn?: string; incidentSummary?: string }) => {
  if (input.kind === "claim") {
    const reopened = claimMade !== null;
    claimMade = { policyId: input.policyId ?? null, incidentOn: input.incidentOn ?? "", incidentSummary: input.incidentSummary ?? "" };
    return { outcome: "opened", reopened, item: { id: CLAIM_WORK } };
  }
  return { outcome: "opened", reopened: false, item: { id: WORK } };
});
const createAutomation = vi.fn(async () => ({}));
// A second client whose name shares a word with the first, for switching and ambiguity (D-121).
let twoClients = false;
const CLIENT_B = "30000000-0000-4000-8000-0000000000b2";
const POL_B = "40000000-0000-4000-8000-0000000000b2";
const PER_B = "50000000-0000-4000-8000-0000000000b2";
const clientB = () => ({ client: { id: CLIENT_B, organization_id: ORG, name: "Tausi Farms Ltd", kind: "corporate", source: "manual", file_status: "cleared", file_owner_id: null, file_decided_by: null, file_decided_at: null, file_decision_reason: null, refresh_interval_days: null, refresh_due_at: null, created_at: "2026-09-01", updated_at: "2026-09-01", deleted_at: null }, effective_status: "cleared", blocking: [], in_state_since: "2026-09-01", documents_held: 0 });
const OPP = "90000000-0000-4000-8000-000000000001";
const APPROACH = "91000000-0000-4000-8000-000000000001";
const INS_CIC = "92000000-0000-4000-8000-000000000001";
// The quotation's server view, with its derived stage and next action; tests set the stage.
let oppStage: "not_asked" | "request_prepared" | "approved_to_deliver" | "with_insurer" = "not_asked";
const oppDetail = () => ({
  opportunity: { id: OPP, title: "Motor fleet", classOfBusiness: "Commercial motor", riskSummary: "Two delivery vans", coverStart: null, coverEnd: null, ownerName: "Wanjiru Kamau", createdAt: "2026-09-30", closedAt: null, closedOutcome: null, closedReason: null, source: null },
  client: { id: CLIENT, name: "Tausi Hauliers Ltd" },
  workItem: { id: WORK, taskStatus: "needs_you", taskParty: null, taskSince: null },
  requirements: [{ id: "93000000-0000-4000-8000-000000000001", label: "Logbooks", required: true, suppliedAt: "2026-09-30", suppliedByName: "Wanjiru Kamau", evidence: null }],
  insurers: [{
    id: APPROACH, insurerId: INS_CIC, insurerName: "CIC General", addedAt: "2026-09-30", removedAt: null, removedReason: null,
    request: oppStage === "not_asked" ? null : { id: "94000000-0000-4000-8000-000000000001", subject: "Quotation request", body: "Please quote.", preparedAt: "2026-09-30", preparedByName: null, approvedAt: oppStage === "request_prepared" ? null : "2026-09-30", approvedByName: null, sentAt: null, sentEmailMessageId: null, delivery: oppStage === "with_insurer" ? { method: "own_email", reference: "Emailed 10:02", deliveredAt: "2026-09-30T07:02:00Z", recordedByName: null, evidenceDocumentId: null } : null },
    stage: oppStage, stageLabel: { not_asked: "Not asked yet", request_prepared: "Request prepared — awaiting approval", approved_to_deliver: "Approved — not yet delivered", with_insurer: "With CIC General since 30 Sept" }[oppStage],
    response: null,
  }],
  availableInsurers: [{ id: INS_CIC, name: "CIC General" }, { id: "92000000-0000-4000-8000-000000000002", name: "Jubilee Insurance" }],
  documents: [],
  permissions: { canEdit: true, canApprove: true, canRecordResponse: true },
  sending: { available: false, reason: "Sending from ASAP is not connected yet." },
  next: { what: { not_asked: "Prepare the request to CIC General", request_prepared: "Review and approve the request to CIC General", approved_to_deliver: "Deliver the approved request to CIC General and record how", with_insurer: "Chase CIC General for terms" }[oppStage], holder: oppStage === "with_insurer" ? "outside_party" : "brokerage", party: oppStage === "with_insurer" ? "CIC General" : null, since: null, missing: [], checkAt: null, why: "Because.", record: { type: "opportunity", id: OPP, label: "Tausi — Motor fleet" }, action: null, stage: oppStage },
});
const opportunityAction = vi.fn(async () => ({ outcome: "done", reason: null, opportunity: oppDetail() }));
// Owner and due date, answered as the server's /manage contract would; a preview changes nothing.
let workOwner = ME;
let workDue: string | null = null;
const manageWork = vi.fn(async (_id: string, input: { version: number; ownerId?: string; dueOn?: string; preview?: boolean }) => {
  const item = { id: WORK, organization_id: ORG, title: "Renew Tausi Hauliers motor fleet", kind: "renewal", client_id: CLIENT, policy_period_id: PER_OK, insurer_id: null, class_of_business: "Motor", owner_id: workOwner, task_status: "needs_you", task_party: null, task_since: "2026-09-20", task_next_check: null, due_on: workDue, cover_status: null, cover_inception_at: null, money_status: null, reason: null, steps: [], exception: null, version: 1 };
  const name = (id: string) => (id === BARAKA ? "Baraka Otieno" : "Wanjiru Kamau");
  const changes = [
    ...(input.ownerId && input.ownerId !== workOwner ? [{ field: "owner", label: "Owner", from: name(workOwner), to: name(input.ownerId) }] : []),
    ...(input.dueOn && input.dueOn !== workDue ? [{ field: "due", label: "Due", from: workDue ?? "No date", to: input.dueOn }] : []),
  ];
  if (!changes.length) return { outcome: "already_done", item, changes: [] };
  if (input.preview) return { outcome: "preview", item, changes, externalEffect: "No message is sent to anyone. The new owner sees it in their Work." };
  if (input.ownerId) workOwner = input.ownerId;
  if (input.dueOn) workDue = input.dueOn;
  return { outcome: "applied", item: { ...item, owner_id: workOwner, due_on: workDue }, changes, auditAction: changes.length === 1 && changes[0]!.field === "owner" ? "work_item.assigned" : "work_item.due_changed" };
});
const askQuestion = vi.fn(async () => ({ state: "not_configured", conversationId: null, message: null, suggestions: [] }));
const saveTurns = vi.fn(async () => ({ conversationId: "a0000000-0000-4000-8000-000000000001" }));

vi.mock("../lib/supabase.js", () => ({ supabase: { auth: { signOut: async () => ({}) } } }));
vi.mock("../lib/api.js", () => ({
  ApiRequestError: class ApiRequestError extends Error {},
  describeApiError: (e: unknown) => (e instanceof Error ? e.message : "failed"),
  api: {
    members: async () => ({
      members: [
        { membership_id: ME, user: { id: ME, email: "wanjiru@example.test", full_name: "Wanjiru Kamau", display_name: null, last_seen_at: null }, role: { id: ME, key: "owner", name: "Owner" }, is_owner: true, status: "active", joined_at: "2026-09-01" },
        { membership_id: BARAKA, user: { id: BARAKA, email: "baraka@example.test", full_name: "Baraka Otieno", display_name: null, last_seen_at: null }, role: { id: BARAKA, key: "account_executive", name: "Account executive" }, is_owner: false, status: "active", joined_at: "2026-09-01" },
      ],
    }),
    mailboxes: async () => ({ mailboxes: [], providers: [] }),
    automations: async () => ({
      automations: [{ id: AUTO, organization_id: ORG, name: "Renewal preparation", description: "Prepare the renewal pack", trigger_event: "renewal.approaching", conditions: [], skill: "renewal.prepare", prepared_verb: "prepare", approval: "always", sends_externally: false, enabled: false, created_by: ME, created_at: "2026-09-01", updated_at: "2026-09-01" }],
    }),
    audit: async () => ({ recordId: null, entries: [{ id: "a1", actorType: "user", actorName: "Wanjiru Kamau", action: "client.created", objectType: "client", objectId: CLIENT, result: "success", failureReason: null, changed: [], evidence: [], occurredAt: "2026-09-02T09:00:00Z" }], visible: 1, returned: 1 }),
    opportunities: async () => ({ opportunities: [{ id: OPP, clientId: CLIENT, title: "Motor fleet", classOfBusiness: "Commercial motor", createdAt: "2026-09-30", closedAt: null }] }),
    workList: async (view: string) => ({
      items:
        view === "needs"
          ? [{ rank: 1, reason: "Renewal is 30 days away and no terms are in.", priority: "high", next: { what: "Request renewal terms from the insurer", holder: "brokerage", party: null, since: null, missing: ["Renewal terms"], checkAt: "2026-10-05T09:00:00Z", why: "Cover ends on its expiry date.", record: { type: "work_item", id: WORK, label: "Renew Tausi Hauliers motor fleet" }, action: null, stage: "first" }, item: { id: WORK, organization_id: ORG, title: "Renew Tausi Hauliers motor fleet", kind: "renewal", client_id: CLIENT, policy_period_id: PER_OK, insurer_id: null, class_of_business: "Motor", owner_id: workOwner, task_status: "needs_you", task_party: null, task_since: "2026-09-20", task_next_check: null, due_on: workDue, cover_status: null, cover_inception_at: null, money_status: null, reason: null, steps: [], exception: null, version: 1 } }]
          : view === "with" && claimMade
            ? [{ rank: 1, reason: "A new claim.", priority: "high", next: { what: "Collect the claim form and supporting documents", holder: "brokerage", party: null, since: null, missing: ["Claim form"], checkAt: "2026-10-02T09:00:00Z", why: "An insurer can refuse a late claim.", record: { type: "work_item", id: CLAIM_WORK, label: "Claim — Tausi Hauliers Ltd" }, action: null, stage: "derived" }, item: { id: CLAIM_WORK, organization_id: ORG, title: "Claim — Tausi Hauliers Ltd", kind: "claim", client_id: CLIENT, policy_period_id: null, insurer_id: null, class_of_business: null, owner_id: ME, task_status: "with_party", task_party: "Tausi Hauliers Ltd", task_since: "2026-09-30", task_next_check: "2026-10-02T09:00:00Z", due_on: null, cover_status: null, cover_inception_at: null, money_status: null, reason: null, steps: [], exception: null, version: 1 } }]
            : [],
    }),
    clientFiles: async (view: string) => ({
      view,
      counts: {},
      items: view === "blocking" && twoClients ? [clientB()] : view === "not_started" ? created.map((c) => ({ client: { id: c.id, organization_id: ORG, name: c.name, kind: "corporate", source: "manual", file_status: "not_started", file_owner_id: null, file_decided_by: null, file_decided_at: null, file_decision_reason: null, refresh_interval_days: null, refresh_due_at: null, created_at: "2026-09-30", updated_at: "2026-09-30", deleted_at: null }, effective_status: "not_started", blocking: [], in_state_since: "2026-09-30", documents_held: 0 })) : view === "cleared" ? [{ client: { id: CLIENT, organization_id: ORG, name: "Tausi Hauliers Ltd", kind: "corporate", source: "manual", file_status: "cleared", file_owner_id: null, file_decided_by: null, file_decided_at: null, file_decision_reason: null, refresh_interval_days: null, refresh_due_at: null, created_at: "2026-09-01", updated_at: "2026-09-01", deleted_at: null }, effective_status: "cleared", blocking: [], in_state_since: "2026-09-01", documents_held: 0 }] : [],
    }),
    clientSpace: async (id: string) => id === CLIENT_B ? ({
      client: { id: CLIENT_B, name: "Tausi Farms Ltd", kind: "corporate", fileStatus: "cleared", createdAt: "2026-09-01" },
      contacts: [],
      policies: [{ id: POL_B, policyNumber: "TF-FIRE-009", classOfBusiness: "Fire", insurerName: "Jubilee Insurance", periods: [{ id: PER_B, periodStart: "2026-03-01", periodEnd: "2027-02-28", premiumAmount: null, premiumCurrency: null, premiumBasis: null, commissionAmount: null, premiumSource: "manual", premiumVerifiedAt: null, premiumEvidenceDocumentId: null, current: true }] }],
      work: [], claims: [], endorsements: [], documents: [], threads: [], fileMissing: [], mailboxConnected: false,
      permissions: { canEdit: true, canUploadDocuments: true, canStartWork: true },
    }) : ({
      client: { id: CLIENT, name: "Tausi Hauliers Ltd", kind: "corporate", fileStatus: "cleared", createdAt: "2026-09-01" },
      contacts: [{ id: "c1", fullName: "Otieno Were", roleLabel: "Finance", email: "otieno@example.test", phone: null, isPrimary: true }],
      policies: [
        { id: POL_OK, policyNumber: "TH-MTR-001", classOfBusiness: "Motor", insurerName: "First Insurer", periods: [{ id: PER_OK, periodStart: "2026-01-01", periodEnd: "2026-12-31", premiumAmount: "1200000.00", premiumCurrency: "KES", premiumBasis: "gross", commissionAmount: null, premiumSource: "document", premiumVerifiedAt: "2026-01-02", premiumEvidenceDocumentId: null, current: true }] },
        { id: POL_UNVERIFIED, policyNumber: null, classOfBusiness: "Fire", insurerName: null, periods: [{ id: PER_UNVERIFIED, periodStart: "2026-02-01", periodEnd: "2027-01-31", premiumAmount: null, premiumCurrency: null, premiumBasis: null, commissionAmount: null, premiumSource: "manual", premiumVerifiedAt: null, premiumEvidenceDocumentId: null, current: true }] },
      ],
      work: [], claims: claimMade ? [{ id: CLAIM, workItemId: CLAIM_WORK, policyId: claimMade.policyId, insurerReference: null, incidentSummary: claimMade.incidentSummary, incidentOn: claimMade.incidentOn, status: "draft" }] : [], endorsements: [], documents: [{ id: DOC, filename: "schedule.pdf", kind: "policy_schedule", createdAt: "2026-09-02", extractionState: "extracted" }], threads: [], fileMissing: [], mailboxConnected: false,
      permissions: { canEditContacts: true, canUploadDocuments: true, canStartWork: true },
    }),
    policySpace: async (id: string) => ({
      selectedPeriodId: id === POL_OK ? PER_OK : PER_UNVERIFIED,
      cover:
        id === POL_OK
          ? { state: "active", label: "Active cover", reason: "Insurer confirmation on file.", verified: true, evidence: [{ label: "Insurer confirmation, 20 Dec 2025", documentId: null, recordedAt: "2025-12-20" }], asOf: "2026-09-29" }
          : { state: null, label: "Cover not verified", reason: "No insurer confirmation is on file.", verified: false, evidence: [], asOf: "2026-09-29" },
    }),
    manageWork,
    setAutomationEnabled, createClient, previewImport, commitImport, createOpportunity, createWorkItem, createAutomation, askQuestion,
    opportunity: async (id: string) => (id === OPP ? oppDetail() : null),
    opportunityAction,
    workItem: async (id: string) => (id === CLAIM_WORK && claimMade ? {
      item: { id: CLAIM_WORK, steps: [{ id: "docs", label: "Collect the claim form and supporting documents", actor: "client", state: "now", guards: [], evidence: [{ kind: "document", label: "Claim form" }], actions: [], party: null, reason: null, recorded: [], runId: null }] },
      claim: { claim: { id: CLAIM, organization_id: ORG, work_item_id: CLAIM_WORK, client_id: CLIENT, policy_id: claimMade.policyId, policy_period_id: null, status: "draft", source: "manual", incident_on: claimMade.incidentOn, incident_summary: claimMade.incidentSummary, reported_on: null, insurer_reference: null }, documents: [], notes: [], clock: null, candidatePeriods: [] },
    } : null),
    askStatus: async () => ({ modelConfigured: false }),
    conversations: async () => ({ conversations: [] }),
    conversationMessages: async () => ({ messages: [] }),
    saveTurns,
    document: async (id: string) => (id === DOC ? docDetail() : null),
    reviewDocumentField, applyTargets, applyPreview, applyToRecord,
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
    ai: { workspace(ref: unknown): { title: string; statusLabel: string; blocks: unknown[]; filters?: { label: string }[] }; route(t: string, c: unknown): Promise<{ lead?: string; ref?: { ws: string }; plan?: { action: string } | null }>; context(): { organizationId: string; previousSubject: unknown; pendingClarification: unknown; pendingAction: unknown; latestReceipt: unknown } };
    documents: { read(f: File): Promise<unknown> };
    greetingChips: string[];
  };
}

const text = (v: unknown) => JSON.stringify(v);

describe("live mode", () => {
  beforeEach(() => {
    setAutomationEnabled.mockClear();
    created.length = 0;
    claimMade = null;
    workOwner = ME;
    workDue = null;
    manageWork.mockClear();
    opportunityAction.mockClear();
    createOpportunity.mockClear();
    createClient.mockClear();
    createWorkItem.mockClear();
    oppStage = "not_asked";
  });

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
    expect(other.lead).toMatch(/assistant isn’t switched on/);
    // A write proposed in Ask waits for the person: a pending card, never a plan that runs itself.
    const add = (await A.ai.route("add Simba Traders as a client", {})) as { plan?: unknown; pending?: { action: string; title: string; external: string; sections: { label: string; items: string[] }[] } };
    expect(add.plan).toBeUndefined();
    expect(add.pending?.action).toBe("client.create");
    expect(add.pending?.title).toBe("Add Simba Traders");
    expect(add.pending?.external).toBe("No message is sent to anyone.");
    expect(add.pending?.sections.find((x) => x.label === "MISSING")?.items).toEqual(["Primary contact", "Phone", "Email"]);
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

  it("opens a policy found by Search on the policy itself", async () => {
    const a = await live();
    // @ts-expect-error -- the approved engine is untyped JavaScript
    const { sel } = (await import("./engine/store.js")) as { sel: { search(q: string): { kind: string; target: unknown }[] } };
    const hit = sel.search("TH-MTR-001").find((h: { kind: string }) => h.kind === "Policy") as { target: { ws: string } };
    expect(hit.target).toMatchObject({ ws: "policy", clientId: CLIENT, policyYearId: PER_OK });
    expect(a.ai.workspace(hit.target).title).toMatch(/TH-MTR-001/);
    // A reference by the policy's own id opens it too, never Today.
    expect(a.ai.workspace({ ws: "policy", policyId: POL_OK }).title).toMatch(/TH-MTR-001/);
  });

  it("shows where a value was read, links the source file, confirms at once, then previews and applies", async () => {
    fieldState = "proposed";
    const a = await live();
    const ws = a.ai.workspace({ ws: "document", documentId: DOC });
    expect(text(ws)).toContain('"a":"link","url":"https://storage.example.test/signed/schedule.pdf?token=t"');
    expect(text(ws)).toContain("show where");

    const where = a.ai.workspace({ ws: "document", documentId: DOC, fieldId: FIELD });
    expect(text(where)).toContain("|TH-MTR-001|");
    expect(text(where)).toContain("schedule.pdf?token=t#page=1");

    const reviewed = (await a.records.act("doc.review", { documentId: DOC, [FIELD]: "TH-MTR-001" })) as { ok: boolean; text: string };
    expect(reviewed).toMatchObject({ ok: true, text: "1 value confirmed" });
    const after = a.ai.workspace({ ws: "document", documentId: DOC });
    expect(text(after)).toContain("Accepted");
    expect(text(after)).toContain("Apply confirmed values to a record");

    await a.records.act("doc.applyPreview", { documentId: DOC, target: "policy:" + POL_OK });
    expect(text(a.ai.workspace({ ws: "document", documentId: DOC }))).toContain("nothing recorded → TH-MTR-001");
    const applied = (await a.records.act("doc.apply", { documentId: DOC })) as { ok: boolean };
    expect(applied.ok).toBe(true);
    expect(applyToRecord).toHaveBeenCalledWith(DOC, expect.objectContaining({ targetType: "policy", targetId: POL_OK, fields: [expect.objectContaining({ fieldKey: "policy_number", from: null, to: "TH-MTR-001" })] }));
  });

  it("answers only questions for the client list from the list, and sends the rest on", async () => {
    const a = await live();
    for (const q of ["What clients do I have?", "Show me all my clients", "How many clients do we have?", "list clients"]) {
      expect((await a.ai.route(q, {})).lead).toMatch(/^You have 1 client\./);
    }
    for (const q of ["Which policies does this client have?", "What claims do my clients have?", "Show documents for the client"]) {
      expect((await a.ai.route(q, {})).lead ?? "").not.toMatch(/^You have \d+ clients?\./);
    }
  });

  it("answers a policy cover question from that policy's server cover check, never the vehicle check", async () => {
    const a = await live();
    const inFront = await a.ai.route("Is cover active on this policy?", { clientId: CLIENT, policyYearId: PER_OK });
    expect(inFront.lead).toBe("TH-MTR-001 has active cover.");
    expect(inFront.ref).toEqual({ ws: "policy", clientId: CLIENT, policyYearId: PER_OK });

    const byNumber = await a.ai.route("Is cover active on TH-MTR-001?", {});
    expect(byNumber.lead).toBe("TH-MTR-001 has active cover.");
    expect(byNumber.ref).toMatchObject({ ws: "policy", policyYearId: PER_OK });

    const unverified = await a.ai.route("Is cover active on this policy?", { clientId: CLIENT, policyYearId: PER_UNVERIFIED });
    expect(unverified.lead).toMatch(/Cover not verified/);

    // Nothing open and nothing named: one question, no workspace, no guessed client.
    const bare = await a.ai.route("Is cover active on this policy?", {});
    expect(bare.lead).toBe("Which policy do you mean?");
    expect(bare.ref).toBeNull();
    const vague = await a.ai.route("Is it covered?", {});
    expect(text(vague)).not.toContain('"ws":"coverage"');
    expect(text(vague)).not.toContain("null is not");
  });

  it("never takes a one-letter client name as a match for ordinary words", async () => {
    await live();
    // @ts-expect-error -- the approved engine is untyped JavaScript
    const S = (await import("./engine/store.js")) as { getDb(): { clients: { id: string; name: string }[] }; sel: { clientByName(t: string): { name: string } | null } };
    S.getDb().clients.push({ id: "30000000-0000-4000-8000-0000000000aa", name: "A" });
    expect(S.sel.clientByName("Is cover active on this policy?")).toBeNull();
    expect(S.sel.clientByName("Open Tausi Hauliers")?.name).toBe("Tausi Hauliers Ltd");
  });

  it("adds a client from Ask: preview, confirm through the + New handler, read back, receipt, next steps", async () => {
    const A = await live();
    const r = (await A.ai.route("Add Kifaru Traders as a client.", {})) as { lead: string; pending: { action: string; payload: Record<string, unknown>; actionId: string; editRef: { ws: string; name: string } } };
    expect(r.lead).toBe("I can add Kifaru Traders as a company. I found no close matches.");
    // Nothing was written by asking.
    expect(createClient).toHaveBeenLastCalledWith({ name: "Kifaru Traders", kind: "corporate", preview: true });
    const first = (await A.records.act(r.pending.action, r.pending.payload, r.pending.actionId)) as { ok: boolean; text: string; nav: { ws: string; clientId: string }; next: { label: string }[] };
    expect(first.ok).toBe(true);
    expect(first.text).toBe("Kifaru Traders added as a client");
    expect(first.nav).toEqual({ ws: "client", clientId: "30000000-0000-4000-8000-0000000000ff" });
    expect(first.next.map((n) => n.label)).toEqual(["Add contact", "Record insurance need", "Start quotation", "Upload document"]);
    expect(createClient).toHaveBeenLastCalledWith({ name: "Kifaru Traders", kind: "corporate", confirmNew: true });
    // A second press of the same Confirm is recognised, not written again.
    const calls = createClient.mock.calls.length;
    const again = (await A.records.act(r.pending.action, r.pending.payload, r.pending.actionId)) as { ok: boolean; duplicate?: boolean };
    expect(again.duplicate).toBe(true);
    expect(createClient.mock.calls.length).toBe(calls);
    // Edit opens the form with the name, company chosen.
    expect(r.pending.editRef).toEqual({ ws: "newclient", name: "Kifaru Traders", kind: "corporate" });
  });

  it("asks company or person when the name does not say, and drops a duplicate result for a different name", async () => {
    const A = await live();
    const ask = (await A.ai.route("Add Wanjiru Kamau as a client", {})) as { lead: string; pending?: unknown; clarify?: { options: { text: string }[] } };
    expect(ask.lead).toBe("Is Wanjiru Kamau a company or a person?");
    expect(ask.pending).toBeUndefined();
    expect(ask.clarify?.options.map((o) => o.text)).toEqual(["Add Wanjiru Kamau as a company client", "Add Wanjiru Kamau as a person client"]);
    const person = (await A.ai.route("Add Wanjiru Kamau as a person client", {})) as { pending: { payload: { kind: string } } };
    expect(person.pending.payload.kind).toBe("individual");
    // A duplicate check for one name is not shown against another.
    await A.records.act("client.create", { name: "Tausi Haulier", kind: "Company" });
    expect(text(A.ai.workspace({ ws: "newclient", name: "Tausi Haulier" }))).toContain("Tausi Hauliers Ltd");
    expect(text(A.ai.workspace({ ws: "newclient", name: "Kifaru Traders" }))).not.toContain("Tausi Hauliers Ltd");
  });

  it("quotation: the Space shows each insurer's stage and the next action, and no reply form before delivery", async () => {
    oppStage = "approved_to_deliver";
    const A = await live();
    const ws = text(A.ai.workspace({ ws: "quote", opportunityId: OPP }));
    expect(ws).toContain("Next: Deliver the approved request to CIC General and record how");
    expect(ws).toContain("Approved — not yet delivered");
    expect(ws).toContain('"a":"copy"');
    expect(ws).toContain("Record how it reached CIC General");
    expect(ws).not.toContain("Record CIC General’s reply");
    // Only as an explicit manual record.
    expect(ws).toContain("Manual record: CIC General replied without a delivered request");
    oppStage = "not_asked";
  });

  it("quotation: Ask prepares and approves through the same opp.action contract, as pending cards", async () => {
    oppStage = "not_asked";
    const A = await live();
    const ctx = { ws: "quote", opportunityId: OPP, clientId: CLIENT };
    const prep = (await A.ai.route("Prepare the request to CIC", ctx)) as { pending: { action: string; payload: { action: string; opportunityInsurerId: string; body: string }; external: string } };
    expect(prep.pending.action).toBe("opp.action");
    expect(prep.pending.payload.action).toBe("prepare_request");
    expect(prep.pending.payload.opportunityInsurerId).toBe(APPROACH);
    expect(prep.pending.payload.body).toContain("Tausi Hauliers Ltd");
    expect(prep.pending.external).toMatch(/Nothing is sent/);
    expect(opportunityAction).not.toHaveBeenCalled();
    const done = (await A.records.act(prep.pending.action, prep.pending.payload, "t1")) as { ok: boolean; text: string };
    expect(done.text).toBe("Request prepared for approval — nothing was sent");
    expect(opportunityAction).toHaveBeenLastCalledWith(OPP, expect.objectContaining({ action: "prepare_request", opportunityInsurerId: APPROACH }));
    const next = (await A.ai.route("What's next on this quotation?", ctx)) as { lead: string };
    expect(next.lead).toBe("Next: Prepare the request to CIC General.");
  });

  it("shows the server's next action for a work item, the same on Today and in its Work Space", async () => {
    const A = await live();
    const today = text(A.ai.workspace({ ws: "today" }));
    expect(today).toContain("Next: Request renewal terms from the insurer · Missing: Renewal terms · Look again 5 Oct");
    const ws = text(A.ai.workspace({ ws: "workitem", workItemId: WORK }));
    expect(ws).toContain("Next: Request renewal terms from the insurer");
    expect(ws).toContain("Missing: Renewal terms.");
    expect(ws).not.toContain("Decide the first step");
  });

  describe("typed conversational context and resolution order (D-121)", () => {
    beforeEach(() => {
      twoClients = true;
    });
    afterEach(() => {
      twoClients = false;
    });
    type Answer = { lead: string; ref?: { ws: string; clientId?: string; policyYearId?: string } | null; clarify?: { options: { label: string }[] } };
    const policyA = { ws: "policy", clientId: CLIENT, policyYearId: PER_OK };
    const policyB = { ws: "policy", clientId: CLIENT_B, policyYearId: PER_B };
    const clientA = { ws: "client", clientId: CLIENT };
    const clientBref = { ws: "client", clientId: CLIENT_B };
    const route = async (A: Awaited<ReturnType<typeof live>>, q: string, ref: object, chip: object | null = null) =>
      (await A.ai.route(q, { ...ref, ref, chip })) as Answer;

    it("an explicit policy number wins over the Space in front, and never takes the vehicle path", async () => {
      const A = await live();
      const r = await route(A, "Is cover active on TH-MTR-001?", clientBref);
      expect(r.lead).toBe("TH-MTR-001 has active cover.");
      expect(r.ref).toMatchObject({ ws: "policy", policyYearId: PER_OK });
      expect(JSON.stringify(r)).not.toContain('"ws":"coverage"');
    });

    it("'this policy' and 'this client' mean the Space in front", async () => {
      const A = await live();
      expect((await route(A, "Is cover active on this policy?", policyB)).lead).toMatch(/^TF-FIRE-009/);
      expect((await route(A, "Which policies does this client have?", clientA)).lead).toBe("Tausi Hauliers Ltd has 2 policies.");
    });

    it("switching between two clients and two policies follows the Space, with no identity carried over", async () => {
      const A = await live();
      expect((await route(A, "When does this policy expire?", policyA)).lead).toMatch(/^TH-MTR-001 ends on /);
      // Now the other client's policy is in front: the previous subject belongs to another client and is dropped.
      expect((await route(A, "When does it expire?", policyB)).lead).toMatch(/^TF-FIRE-009 ends on /);
      expect((await route(A, "Which policies does this client have?", clientBref)).lead).toBe("Tausi Farms Ltd has 1 policy.");
      expect((await route(A, "Which policies does this client have?", clientA)).lead).toBe("Tausi Hauliers Ltd has 2 policies.");
    });

    it("a follow-up uses the subject just resolved; a corrected follow-up switches to what it names", async () => {
      const A = await live();
      await route(A, "Is cover active on TH-MTR-001?", clientA);
      expect(A.ai.context().previousSubject).toMatchObject({ type: "policy", label: "TH-MTR-001" });
      expect((await route(A, "When does it expire?", clientA)).lead).toMatch(/^TH-MTR-001 ends on /);
      const corrected = await route(A, "No — I meant TF-FIRE-009. When does it expire?", clientA);
      expect(corrected.lead).toMatch(/^TF-FIRE-009 ends on /);
    });

    it("an ambiguous client name asks which, and opens nothing", async () => {
      const A = await live();
      const r = await route(A, "Which policies does Tausi have?", {});
      expect(r.lead).toBe("Which client do you mean?");
      expect(r.ref).toBeNull();
      expect(r.clarify?.options.map((o) => o.label).sort()).toEqual(["Tausi Farms Ltd", "Tausi Hauliers Ltd"]);
      expect(A.ai.context().pendingClarification).not.toBeNull();
    });

    it("a missing vehicle identity is asked for, never answered about 'null'", async () => {
      const A = await live();
      const r = await route(A, "Is the vehicle covered?", clientA);
      expect(JSON.stringify(r)).not.toMatch(/null is not|"ws":"coverage"/);
    });

    it("a client with several policies is asked which, not given the first", async () => {
      const A = await live();
      const r = await route(A, "Is cover active?", {}, { clientId: CLIENT });
      expect(r.lead).toBe("Which policy?");
    });

    it("records the pending action and, once confirmed, the latest receipt", async () => {
      const A = await live();
      const add = (await A.ai.route("Add Kifaru Traders as a client", {})) as { pending: { action: string; payload: object; actionId: string } };
      expect(A.ai.context().pendingAction).toMatchObject({ action: "client.create" });
      await A.records.act(add.pending.action, add.pending.payload, add.pending.actionId);
      expect(A.ai.context().pendingAction).toBeNull();
      expect(A.ai.context().latestReceipt).toMatchObject({ text: "Kifaru Traders added as a client" });
      expect(A.ai.context().organizationId).toBe(ORG);
    });
  });

  describe("the claim vertical slice", () => {
    const yesterday = () => { const d = new Date(Date.now() - 864e5); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

    it("reports a claim from the policy in front: kept values, a draft, one create, read back, its Space", async () => {
      const A = await live();
      const ref = { ws: "policy", clientId: CLIENT, policyYearId: PER_OK };
      const r = (await A.ai.route("Report a claim for the accident yesterday", { ...ref, ref })) as { pending: { action: string; payload: Record<string, string>; actionId: string; external: string; sections: { label: string; items: string[] }[] } };
      expect(r.pending.action).toBe("claim.open");
      expect(r.pending.payload).toEqual({ clientId: CLIENT, policyId: POL_OK, incidentOn: yesterday(), incidentSummary: "The accident yesterday" });
      expect(r.pending.external).toMatch(/^No message is sent to the insurer/);
      expect(r.pending.sections[0]!.items[0]).toBe("A draft claim — not registered");
      expect(createWorkItem).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "claim" }));
      const done = (await A.records.act(r.pending.action, r.pending.payload, r.pending.actionId)) as { ok: boolean; text: string; nav: { ws: string; claimId: string } };
      expect(done.text).toBe("Claim reported as a draft — not registered");
      expect(done.nav).toEqual({ ws: "claim", clientId: CLIENT, claimId: CLAIM });
      const again = (await A.records.act(r.pending.action, r.pending.payload, r.pending.actionId)) as { duplicate?: boolean };
      expect(again.duplicate).toBe(true);
      expect(createWorkItem.mock.calls.filter((c) => (c[0] as { kind: string }).kind === "claim")).toHaveLength(1);
      const space = text(A.ai.workspace(done.nav));
      expect(space).toContain("Draft — not registered");
      expect(space).toContain("Claim form");
      expect(space).toContain("Nothing is sent from here");
      expect(space).not.toMatch(/@|undefined|\bnull\b|Review and send|"t":"email"/);
    });

    it("asks which policy only when the client has several, offering 'not known'; asks the date when it is missing", async () => {
      const A = await live();
      const which = (await A.ai.route("Report a claim for the accident yesterday", { chip: { clientId: CLIENT } })) as { lead: string; clarify: { options: { label: string }[] } };
      expect(which.lead).toBe("Which policy does this claim relate to?");
      expect(which.clarify.options.map((o) => o.label)).toContain("Policy not known yet");
      const when = (await A.ai.route("Report a claim on TH-MTR-001", {})) as { lead: string };
      expect(when.lead).toBe("When did it happen?");
    });
  });

  /*
   * Chat/Space parity (D-122). Each action is reached two ways — Ask's confirmed pending card and
   * the Space's own control — and both must arrive at the same live action and the same server
   * call. Ask's preview writes nothing; a repeat of a confirmed action is not sent twice.
   */
  describe("chat and Space reach the same contract", () => {
    type Pending = { action: string; payload: Record<string, unknown>; actionId: string; sections: { label: string; items: string[] }[] };
    type Routed = { pending?: Pending; lead?: string };
    const blocks = (ws: { blocks: unknown[] }) => ws.blocks as Record<string, unknown>[];
    const control = (ws: { blocks: unknown[] }, action: string, pick?: (o: Record<string, unknown>) => boolean) => {
      const found: Record<string, unknown>[] = [];
      const walk = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(walk);
        else if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          if (o["action"] === action && (!pick || pick(o))) found.push(o);
          Object.values(o).forEach(walk);
        }
      };
      walk(blocks(ws));
      return found[0] ?? null;
    };

    it("1 · add client", async () => {
      const A = await live();
      const r = (await A.ai.route("add Simba Traders as a company client", {})) as Routed;
      expect(r.pending!.action).toBe("client.create");
      expect(createClient.mock.calls.every((c) => c[0].preview === true)).toBe(true);
      await A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId);
      const fromAsk = createClient.mock.calls.at(-1)![0];
      createClient.mockClear();
      const form = control(A.ai.workspace({ ws: "newclient" }), "client.create")!;
      expect(form).not.toBeNull();
      await A.records.act("client.create", { ...(form["payload"] as object), name: "Simba Traders", kind: "Company", confirmNew: "yes" });
      const fromSpace = createClient.mock.calls.at(-1)![0];
      expect({ name: fromSpace.name, kind: fromSpace.kind }).toEqual({ name: fromAsk.name, kind: fromAsk.kind });
    });

    it("2 · start quotation", async () => {
      const A = await live();
      const r = (await A.ai.route("Start a quotation for Tausi Hauliers for a motor fleet of five vans", {})) as Routed;
      expect(r.pending!.action).toBe("opportunity.create");
      expect(createOpportunity).not.toHaveBeenCalled();
      await Promise.all([A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId), A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId)]);
      expect(createOpportunity).toHaveBeenCalledTimes(1);
      const fromAsk = (createOpportunity.mock.calls as unknown as Record<string, unknown>[][])[0]![0]!;
      const form = control(A.ai.workspace({ ws: "quote", clientId: CLIENT }), "opportunity.create")!;
      await A.records.act("opportunity.create", { ...(form["payload"] as object), title: r.pending!.payload["title"], cls: r.pending!.payload["cls"] });
      const fromSpace = (createOpportunity.mock.calls as unknown as Record<string, unknown>[][])[1]![0]!;
      for (const k of ["clientId", "title", "classOfBusiness"]) expect(fromSpace[k]).toEqual(fromAsk[k]);
    });

    const oppAsk = async (A: Awaited<ReturnType<typeof live>>, q: string) => (await A.ai.route(q, { ws: "quote", opportunityId: OPP, clientId: CLIENT, ref: { ws: "quote", opportunityId: OPP } })) as Routed;
    const lastOpp = () => opportunityAction.mock.calls.at(-1) as unknown as [string, Record<string, unknown>];

    it("3 · add insurer", async () => {
      const A = await live();
      const r = await oppAsk(A, "Add Jubilee as an insurer to this quotation");
      expect(r.pending!.action).toBe("opp.action");
      expect(opportunityAction).not.toHaveBeenCalled();
      await A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId);
      const fromAsk = lastOpp();
      const add = control(A.ai.workspace({ ws: "quote", opportunityId: OPP }), "opp.action", (o) => (o["payload"] as { action?: string })?.action === "add_insurer")!;
      await A.records.act("opp.action", add["payload"]);
      expect(lastOpp()).toEqual(fromAsk);
    });

    it("4 · add requirement", async () => {
      const A = await live();
      const r = await oppAsk(A, "Add a requirement: Driver licences");
      expect(r.pending!.payload).toMatchObject({ action: "add_requirement", label: "Driver licences" });
      expect(opportunityAction).not.toHaveBeenCalled();
      await A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId);
      const fromAsk = lastOpp();
      const form = control(A.ai.workspace({ ws: "quote", opportunityId: OPP }), "opp.action", (o) => (o["payload"] as { action?: string })?.action === "add_requirement")!;
      await A.records.act("opp.action", { ...(form["payload"] as object), label: "Driver licences" });
      expect(lastOpp()).toEqual(fromAsk);
    });

    it("5 · supply requirement", async () => {
      const A = await live();
      const d = oppDetail();
      d.requirements[0]!.suppliedAt = null as unknown as string;
      opportunityAction.mockClear();
      const detail = { ...d };
      const api = (await import("../lib/api.js")).api as unknown as { opportunity: (id: string) => Promise<unknown> };
      const spy = vi.spyOn(api, "opportunity").mockResolvedValue(detail);
      const B = await live();
      const r = (await B.ai.route("We received the logbooks from the client by email today", { ws: "quote", opportunityId: OPP, clientId: CLIENT, ref: { ws: "quote", opportunityId: OPP } })) as Routed;
      expect(r.pending!.payload).toMatchObject({ action: "supply_requirement", requirementId: d.requirements[0]!.id });
      expect(opportunityAction).not.toHaveBeenCalled();
      await B.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId);
      const fromAsk = lastOpp();
      const form = control(B.ai.workspace({ ws: "quote", opportunityId: OPP }), "opp.action", (o) => (o["payload"] as { action?: string })?.action === "supply_requirement")!;
      expect(form).not.toBeNull();
      // The Space's select supplies the requirement; its text box the note.
      const choice = ((form["fields"] as { key: string; options?: { value: string }[] }[]).find((f) => f.key === "requirementId")!.options!)[0]!.value;
      await B.records.act("opp.action", { ...(form["payload"] as object), requirementId: choice, note: r.pending!.payload["note"] });
      expect(lastOpp()[1]).toMatchObject({ action: "supply_requirement", requirementId: fromAsk[1]["requirementId"], note: fromAsk[1]["note"] });
      spy.mockRestore();
      void A;
    });

    it("6 · prepare request", async () => {
      const A = await live();
      const r = await oppAsk(A, "Prepare the request to CIC");
      expect(r.pending!.payload).toMatchObject({ action: "prepare_request", opportunityInsurerId: APPROACH });
      expect(opportunityAction).not.toHaveBeenCalled();
      await A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId);
      const fromAsk = lastOpp();
      const form = control(A.ai.workspace({ ws: "quote", opportunityId: OPP }), "opp.action", (o) => (o["payload"] as { action?: string })?.action === "prepare_request")!;
      await A.records.act("opp.action", { ...(form["payload"] as object), subject: fromAsk[1]["subject"], body: fromAsk[1]["body"] });
      expect(lastOpp()[1]).toEqual(fromAsk[1]);
      expect(JSON.stringify(fromAsk)).not.toMatch(/\bsent\b/i);
    });

    it("7 · report claim", async () => {
      const A = await live();
      const ref = { ws: "policy", clientId: CLIENT, policyYearId: PER_OK };
      const r = (await A.ai.route("Report a claim: van rear-ended on 28 Sep", { ...ref, ref })) as Routed;
      expect(r.pending!.action).toBe("claim.open");
      expect(createWorkItem).not.toHaveBeenCalled();
      await A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId);
      const fromAsk = createWorkItem.mock.calls.at(-1)![0];
      claimMade = null;
      const form = control(A.ai.workspace({ ws: "claim", clientId: CLIENT }), "claim.open")!;
      expect(form).not.toBeNull();
      await A.records.act("claim.open", { ...(form["payload"] as object), policyId: POL_OK, incidentOn: r.pending!.payload["incidentOn"], incidentSummary: r.pending!.payload["incidentSummary"] });
      const fromSpace = createWorkItem.mock.calls.at(-1)![0];
      expect(fromSpace).toEqual(fromAsk);
    });

    it("8 · assign Work: Ask previews from the server, both confirm through /manage", async () => {
      const A = await live();
      const ref = { ws: "workitem", workItemId: WORK };
      const r = (await A.ai.route("Assign this to Baraka", { ...ref, ref })) as Routed;
      expect(r.pending!.action).toBe("work.assign");
      expect(r.pending!.sections.find((x) => x.label === "CHANGE")!.items[0]).toBe("Owner: Wanjiru Kamau → Baraka Otieno");
      expect(manageWork.mock.calls.every((c) => c[1].preview === true)).toBe(true);
      const [a, b] = await Promise.all([A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId), A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId)]);
      expect(manageWork.mock.calls.filter((c) => !c[1].preview)).toHaveLength(1);
      expect((a as { receipt: { audit: string } }).receipt.audit).toBe("work_item.assigned");
      expect(a).toEqual(b);
      const fromAsk = manageWork.mock.calls.filter((c) => !c[1].preview).at(-1)!;
      workOwner = ME;
      manageWork.mockClear();
      const B = await live();
      await B.records.act("work.assign", { workItemId: WORK, userId: BARAKA, dueAt: null });
      expect(manageWork.mock.calls.at(-1)).toEqual(fromAsk);
      const again = (await B.records.act("work.assign", { workItemId: WORK, userId: BARAKA, dueAt: null }, "space-second-click")) as { already?: boolean };
      expect(again.already).toBe(true);
    });

    it("9 · change Work due date", async () => {
      const A = await live();
      const ref = { ws: "workitem", workItemId: WORK };
      const r = (await A.ai.route("Make this due 15 Oct 2026", { ...ref, ref })) as Routed;
      expect(r.pending!.sections.find((x) => x.label === "CHANGE")!.items[0]).toBe("Due: No date → 2026-10-15");
      expect(workDue).toBeNull();
      await A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId);
      const fromAsk = manageWork.mock.calls.filter((c) => !c[1].preview).at(-1)!;
      expect(fromAsk[1]).toMatchObject({ dueOn: "2026-10-15" });
      workDue = null;
      manageWork.mockClear();
      const B = await live();
      await B.records.act("work.assign", { workItemId: WORK, dueAt: "2026-10-15" });
      expect(manageWork.mock.calls.at(-1)).toEqual(fromAsk);
      // After a refresh, Work reads the saved date back from the server.
      const C = await live();
      expect(text(C.ai.workspace({ ws: "work" }))).toMatch(/15 Oct/);
    });

    it("a refusal from the server is a blocked receipt, not a success", async () => {
      manageWork.mockResolvedValueOnce({ outcome: "blocked", item: {} as never, guard: "permission", reason: "Your role can view Work but not change its owner or dates. Nothing was changed." } as never);
      const A = await live();
      const res = (await A.records.act("work.assign", { workItemId: WORK, userId: BARAKA })) as { ok: boolean; denied?: boolean; reason?: string };
      expect(res.ok).toBe(false);
      expect(res.denied).toBe(true);
    });
  });

  describe("the quotation lifecycle, without Gmail", () => {
    it("Space and Ask show the same stage at each step; a reply is recorded normally only once delivered", async () => {
      for (const stage of ["not_asked", "request_prepared", "approved_to_deliver", "with_insurer"] as const) {
        oppStage = stage;
        const A = await live();
        const ws = A.ai.workspace({ ws: "quote", opportunityId: OPP });
        const all = text(ws);
        const next = oppDetail().next.what;
        expect(all).toContain(next);
        const asked = await A.ai.route("What's next on this quotation?", { ws: "quote", opportunityId: OPP, ref: { ws: "quote", opportunityId: OPP } });
        expect(asked.lead).toBe("Next: " + next + ".");
        // Never "sent"; the ordinary reply form only once someone has delivered the request.
        expect(all).not.toMatch(/"(Request )?[Ss]ent\b/);
        expect(all.includes("Record CIC General’s reply")).toBe(stage === "with_insurer");
        if (stage !== "with_insurer") expect(all).toContain("Manual record: CIC General replied without a delivered request");
        const stages = (ws.blocks as { t: string; label?: string; rows?: { title: string; badge: string }[] }[]).find((b) => b.label === "Where this quotation stands")!;
        const done = stages.rows!.filter((r) => r.badge === "Done").map((r) => r.title);
        expect(done.includes("Delivered by a person, with evidence")).toBe(stage === "with_insurer");
        expect(done.includes("Reviewed and approved")).toBe(stage === "approved_to_deliver" || stage === "with_insurer");
        if (stage === "approved_to_deliver") {
          expect(all).toMatch(/"a":"copy"/);
          expect(all).toMatch(/"a":"download"/);
          expect(all).toContain("Record how it reached CIC General");
        }
        if (stage === "with_insurer") expect(stages.rows!.map((r) => r.title)).toContain("With CIC General");
      }
    });
  });

  describe("claim cases", () => {
    const ask = async (A: Awaited<ReturnType<typeof live>>, q: string, ref: object = {}) =>
      (await A.ai.route(q, { ...ref, ref })) as { lead?: string; clarify?: { options: { label: string; text: string }[] }; pending?: { action: string; payload: Record<string, string>; actionId: string; sections: { label: string; items: string[] }[] } };

    it("a client with one policy: the policy is taken, not asked; an explicit date and the words are kept", async () => {
      twoClients = true;
      const A = await live();
      const r = await ask(A, "Report a claim: fire in the store on 12 Sep", { ws: "client", clientId: CLIENT_B });
      expect(r.pending!.payload).toMatchObject({ clientId: CLIENT_B, policyId: POL_B, incidentSummary: "Fire in the store on 12 Sep" });
      expect(r.pending!.payload["incidentOn"]).toMatch(/-09-12$/);
      twoClients = false;
    });

    it("several policies: asked, with 'not known' — choosing it reports the claim with the policy unknown", async () => {
      const A = await live();
      const which = await ask(A, "Report a claim for the van hit yesterday", { ws: "client", clientId: CLIENT });
      const unknown = which.clarify!.options.find((o) => o.label === "Policy not known yet")!;
      const r = await ask(A, unknown.text, { ws: "client", clientId: CLIENT });
      expect(r.pending!.payload["policyId"]).toBe("unknown");
      expect(r.pending!.sections.find((x) => x.label === "MISSING")!.items).toContain("The policy the loss falls under");
      await A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId);
      expect(createWorkItem).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "claim", policyUnknown: true }));
      expect(createWorkItem.mock.lastCall![0]).not.toHaveProperty("policyId");
    });

    it("an unclear date is asked for, never guessed", async () => {
      const A = await live();
      const r = await ask(A, "Report a claim on TH-MTR-001 for damage recently");
      expect(r.lead).toBe("When did it happen?");
      expect(r.pending).toBeUndefined();
    });

    it("the Claim Space after refresh: draft, policy, owner, next action, documents, next check — no placeholder text", async () => {
      const A = await live();
      const r = await ask(A, "Report a claim for the accident yesterday", { ws: "policy", clientId: CLIENT, policyYearId: PER_OK });
      const done = (await A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId)) as { nav: object };
      const B = await live();
      const space = B.ai.workspace(done.nav) as { statusLabel: string; blocks: unknown[] };
      const all = text(space);
      expect(space.statusLabel).toBe("Draft — not registered");
      expect(all).toContain("TH-MTR-001");
      expect(all).toContain("Wanjiru Kamau");
      expect(all).toContain("Collect the claim form and supporting documents");
      expect(all).toContain("Claim form");
      expect(all).toMatch(/Next check","2 Oct/);
      expect(all).not.toMatch(/undefined|\bnull\b|NaN|\.demo|@example|Review and send/);
    });
  });
});
