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
// An upload not attached to any client yet — no client page lists it (the hosted QA defect).
const UNDOC = "d2000000-0000-4000-8000-000000000001";
let undocState: "queued" | "extracted" = "extracted";
const undocDetail = () => ({
  document: { id: UNDOC, kind: "policy_schedule", filename: "ASAP_QA_TEST_20261002.pdf", mimeType: "application/pdf", byteSize: 2000, pageCount: 1, extractionState: undocState, extractionError: null, clientId: null, workItemId: null, createdAt: "2026-10-02" },
  pages: [], fileUrl: null, fileUrlExpiresAt: null,
  fields: undocState === "extracted" ? Array.from({ length: 12 }, (_, i) => ({ id: "f2000000-0000-4000-8000-0000000000" + String(i).padStart(2, "0"), fieldKey: "insured_name", label: "Insured " + i, proposedValue: "QA Fictional Ltd", correctedValue: null, state: "proposed", pageNumber: 1, region: null, confidence: 0.9, method: "text" })) : [],
});
// Chat attachments (D-132): a new file is stored; the same bytes again are recognised, not re-stored.
const uploadDocument = vi.fn(async (input: { filename: string; contentSha256: string }) => ({
  outcome: input.filename.startsWith("again") ? "already_on_file" : "ready",
  uploadUrl: "https://storage.test/put",
  document: { id: input.filename.startsWith("again") ? DOC : "d1000000-0000-4000-8000-0000000000" + String(input.filename.length).padStart(2, "0"), kind: "unknown", filename: input.filename, mimeType: "application/pdf", byteSize: 10, pageCount: null, extractionState: "queued", extractionError: null, clientId: null, workItemId: null, createdAt: "2026-10-02" },
}));
const documentFiled = vi.fn(async () => ({ outcome: "queued" }));
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
const createAutomation = vi.fn(async (input: { name: string }) => ({ automation: { id: "71000000-0000-4000-8000-000000000001", name: input.name } }));
const testAutomation = vi.fn(async () => ({ testedAt: "2026-09-30T10:00:00Z", checked: 3, wouldFire: [{ workItemId: WORK, title: "Renew Tausi Hauliers motor fleet" }], wouldNotFire: [], problems: [] }));
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
const createContact = vi.fn(async (input: { clientId: string; fullName: string; roleLabel: string | null; email: string | null; phone: string | null }) => ({ contact: { id: "c9000000-0000-4000-8000-000000000001", clientId: input.clientId, fullName: input.fullName, roleLabel: input.roleLabel, email: input.email, phone: input.phone, isPrimary: true, source: "manual", notes: null, createdAt: "2026-10-02" } }));
const updateContact = vi.fn(async (id: string, input: { fullName: string; roleLabel: string | null; email: string; phone: string | null }) => ({ contact: { id, clientId: CLIENT, fullName: input.fullName, roleLabel: input.roleLabel, email: input.email || null, phone: input.phone, isPrimary: true, source: "manual", notes: null, createdAt: "2026-09-01" } }));
// Owner and due date, answered as the server's /manage contract would; a preview changes nothing.
let workOwner = ME;
let workDue: string | null = null;
const manageWork = vi.fn(async (_id: string, input: { version: number; ownerId?: string; dueOn?: string; preview?: boolean }) => {
  const item = { id: WORK, organization_id: ORG, title: "Renew Tausi Hauliers motor fleet", kind: "renewal", client_id: CLIENT, policy_period_id: PER_OK, insurer_id: null, class_of_business: "Motor", owner_id: workOwner, task_status: "needs_you", task_party: null, task_since: "2026-09-20", task_next_check: null, due_on: workDue, cover_status: null, cover_inception_at: null, money_status: null, reason: null, steps: [], exception: null, version: 1 };
  const name = (id: string) => (id === BARAKA ? "Baraka Otieno" : "Wanjiru Kamau");
  const changes = [
    ...(input.ownerId && input.ownerId !== workOwner ? [{ field: "owner", label: "Owner", from: name(workOwner), to: name(input.ownerId) }] : []),
    ...(input.dueOn && input.dueOn !== workDue ? [{ field: "due", label: "Due", from: workDue ?? "No date", to: "15 Oct 2026" }] : []),
  ];
  if (!changes.length) return { outcome: "already_done", item, changes: [] };
  if (input.preview) return { outcome: "preview", item, changes, externalEffect: "No message is sent to anyone. The new owner sees it in their Work." };
  if (input.ownerId) workOwner = input.ownerId;
  if (input.dueOn) workDue = input.dueOn;
  return { outcome: "applied", item: { ...item, owner_id: workOwner, due_on: workDue }, changes, auditAction: changes.length === 1 && changes[0]!.field === "owner" ? "work_item.assigned" : "work_item.due_changed" };
});
// A renewal run as the server returns it, waiting for its one approval (D-129).
const RUN = "a7000000-0000-4000-8000-000000000001";
const APPROVAL = "a8000000-0000-4000-8000-000000000001";
let runState: "waiting_approval" | "waiting_party" | "exception" = "waiting_approval";
const renewalRun = () => ({
  id: RUN, workflow: "renewal", subjectId: PER_OK, workItemId: WORK, state: runState,
  stateLabel: { waiting_approval: "Waiting for your approval", waiting_party: "Waiting on an outside party", exception: "Stopped — needs a person" }[runState],
  currentStep: runState === "waiting_approval" ? "approval" : "await_terms",
  exception: runState === "exception" ? { code: "no_terms_near_expiry", message: "No renewal terms from First Insurer with 5 days to expiry.", needs: "Call the underwriter at First Insurer today.", stepLabel: "Insurer terms awaited and chased" } : null,
  nextRunAt: "2026-10-02T09:00:00Z", startedAt: "2026-10-01T09:00:00Z", finishedAt: null, title: "Tausi Hauliers Ltd — Motor renewal",
  client: { id: CLIENT, name: "Tausi Hauliers Ltd" }, periodEnd: "2026-12-31", progress: { done: runState === "waiting_approval" ? 6 : 8, steps: 11 },
  steps: [
    { key: "completeness", position: 2, label: "Client, policy and documents checked", state: "done", attempts: 0, nextAttemptAt: null, finishedAt: "2026-10-01", output: {}, evidence: [{ label: "5 items on file, 1 missing", kind: "record" }], error: null },
    { key: "approval", position: 7, label: "One approval for the pack and messages", state: runState === "waiting_approval" ? "waiting" : "done", attempts: 0, nextAttemptAt: null, finishedAt: null, output: {}, evidence: [], error: null },
  ],
  approval: { id: APPROVAL, title: "Approve Tausi Hauliers Ltd's renewal", state: runState === "waiting_approval" ? "pending" : "approved", bundleSha256: "c".repeat(64), decidedByName: runState === "waiting_approval" ? null : "Wanjiru Kamau", decidedAt: null, note: null,
    bundle: [
      { kind: "pack", label: "Renewal pack", pack: { client: "Tausi Hauliers Ltd", policyNumber: "TH-MTR-001", insurer: "First Insurer", expiringPeriod: { start: "2026-01-01", end: "2026-12-31" }, expiringPremium: { amount: "1200000.00", currency: "KES", basis: "gross" }, missing: ["The expiring policy schedule"], scheduleFindings: [] } },
      { kind: "communication", audience: "client", label: "Letter to Otieno Were", to: "otieno@tausi.co.ke", subject: "Renewal of your Motor policy TH-MTR-001", body: "Dear Otieno Were, your policy ends on 31 Dec 2026." },
      { kind: "communication", audience: "insurer", label: "Terms request to First Insurer", to: null, subject: "Renewal terms request — Tausi Hauliers Ltd, TH-MTR-001", body: "Dear Underwriter, please provide renewal terms." },
    ] },
  communications: [],
  permissions: { canApprove: true, canAct: true },
  // The server's operational view (D-131), as GET /workflows/runs/:id returns it for each state.
  operational: {
    origin: "manual", originLabel: "Started by Wanjiru Kamau on 1 October",
    status: { waiting_approval: "Waiting for approval from Wanjiru Kamau", waiting_party: "Approved — not delivered", exception: "Escalated to Wanjiru Kamau — no terms from First Insurer near expiry" }[runState],
    tone: "attention",
    currentWork: runState === "waiting_approval" ? { title: "Renewal pack ready", detail: "ASAP prepared the renewal pack, the client letter and the terms request to First Insurer." } : runState === "exception" ? { title: "Stopped — needs a person", detail: "No renewal terms from First Insurer with 5 days to expiry." } : { title: "Deliver the terms request to First Insurer", detail: "The request is approved but has not been sent — ASAP has no mailbox connected." },
    completed: "ASAP checked the policy, looked for the schedule, prepared the renewal pack and drafted two messages.",
    blockers: runState === "exception" ? [{ label: "No renewal terms from First Insurer with 5 days to expiry.", blocking: true, fix: "Call the underwriter at First Insurer today." }] : [{ label: "The expiring policy schedule", blocking: false, fix: null }],
    moreBlockers: 0,
    needsFromYou: runState === "waiting_approval" ? "Review the pack and both messages, then approve the bundle or say what is wrong." : runState === "exception" ? "Call the underwriter at First Insurer today." : "Send the approved request to First Insurer yourself, then record how it was delivered.",
    waitingFor: null, nextFollowUpAt: null, escalatesAt: "2026-12-17T06:00:00.000Z", escalatesTo: "Wanjiru Kamau", chasing: "not_started",
    afterYouAct: runState === "waiting_approval" ? "Approval lets ASAP continue to delivery preparation. Nothing is sent automatically." : "ASAP resumes this same renewal from the step that stopped — nothing already done is done again.",
    attention: true, attentionReason: "x",
    primaryAction: { waiting_approval: { kind: "approve", label: "Approve bundle" }, waiting_party: { kind: "record_delivery", label: "Record delivery" }, exception: { kind: "resume", label: "I've fixed it — resume" } }[runState],
    outputs: [{ label: "Renewal pack", state: "Prepared" }],
    owner: { id: "a0000000-0000-4000-8000-000000000001", name: "Wanjiru Kamau" },
    paused: null, escalated: runState === "exception", upcoming: [],
    interventions: [{ key: "pause", label: "Pause", available: true, why: null }, { key: "follow_up_now", label: "Follow up now", available: false, why: "There is nothing to follow up yet — the insurer request has not been delivered." }, { key: "resume", label: "Resume", available: runState === "exception", why: runState === "exception" ? null : "It is not paused or stopped." }, { key: "escalate", label: "Escalate", available: true, why: null }, { key: "stop", label: "Stop automation", available: true, why: null }, { key: "follow_up_date", label: "Change follow-up date", available: true, why: null }, { key: "assign", label: "Assign", available: true, why: null }],
  },
});
const decideApproval = vi.fn(async () => { runState = "waiting_party"; return { outcome: "done", reason: null, run: renewalRun() }; });
const askQuestion = vi.fn(async () => ({ state: "not_configured", conversationId: null, message: null, suggestions: [] }));
const saveTurns = vi.fn(async () => ({ conversationId: "a0000000-0000-4000-8000-000000000001" }));

vi.mock("../lib/supabase.js", () => ({ supabase: { auth: { signOut: async () => ({}) } }, throughSupabaseBase: (u: string) => u }));
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
    audit: async () => ({ recordId: null, entries: [
      { id: "a1", actorType: "user", actorName: "Wanjiru Kamau", actorId: ME, actorLabel: "A person", action: "client.created", objectType: "client", objectId: CLIENT, result: "success", failureReason: null, changed: [], evidence: [], occurredAt: "2026-09-02T09:00:00Z", client: { id: CLIENT, name: "Tausi Hauliers Ltd" }, record: { type: "client", id: CLIENT, label: "Tausi Hauliers Ltd" }, workItemId: null, external: false, coverOrMoney: false },
      { id: "a2", actorType: "user", actorName: "Baraka Otieno", actorId: BARAKA, actorLabel: "A person", action: "work_item.assigned", objectType: "work_item", objectId: WORK, result: "success", failureReason: null, changed: ["owner_id: Wanjiru → Baraka"], evidence: [], occurredAt: "2026-09-30T08:00:00Z", client: { id: CLIENT, name: "Tausi Hauliers Ltd" }, record: { type: "work_item", id: WORK, label: "Renew Tausi Hauliers motor fleet" }, workItemId: WORK, external: false, coverOrMoney: false },
      { id: "a3", actorType: "user", actorName: "Baraka Otieno", actorId: BARAKA, actorLabel: "A person", action: "work_item.manage", objectType: "work_item", objectId: WORK, result: "denied", failureReason: "permission_denied", changed: [], evidence: [], occurredAt: "2026-09-30T08:05:00Z", client: { id: CLIENT, name: "Tausi Hauliers Ltd" }, record: { type: "work_item", id: WORK, label: "Renew Tausi Hauliers motor fleet" }, workItemId: WORK, external: false, coverOrMoney: false },
    ], visible: 3, returned: 3 }),
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
    renewalRuns: async () => ({ runs: [renewalRun()] }),
    workflowRun: async () => renewalRun(),
    decideApproval,
    testAutomation,
    automationRuns: async () => ({ runs: [{ id: "72000000-0000-4000-8000-000000000001", automation_id: AUTO, event_id: "73000000-0000-4000-8000-000000000001", event_name: "document.received", work_item_id: WORK, outcome: "could_not_finish", condition_results: [], prepared_action: null, reason: "The step had nothing to prepare from.", decided_by: null, decided_at: null, decision: null, started_at: "2026-09-29T10:00:00Z", finished_at: "2026-09-29T10:00:01Z" }] }),
    automationLastTest: async () => ({ lastTest: { testedAt: "2026-09-28T10:00:00Z", checked: 4, wouldFire: 1, problems: [] } }),
    setAutomationEnabled, createClient, previewImport, commitImport, createOpportunity, createWorkItem, createAutomation, askQuestion,
    opportunity: async (id: string) => (id === OPP ? oppDetail() : null),
    opportunityAction,
    createContact,
    updateContact,
    workItem: async (id: string) => (id === CLAIM_WORK && claimMade ? {
      item: { id: CLAIM_WORK, steps: [{ id: "docs", label: "Collect the claim form and supporting documents", actor: "client", state: "now", guards: [], evidence: [{ kind: "document", label: "Claim form" }], actions: [], party: null, reason: null, recorded: [], runId: null }] },
      claim: { claim: { id: CLAIM, organization_id: ORG, work_item_id: CLAIM_WORK, client_id: CLIENT, policy_id: claimMade.policyId, policy_period_id: null, status: "draft", source: "manual", incident_on: claimMade.incidentOn, incident_summary: claimMade.incidentSummary, reported_on: null, insurer_reference: null }, documents: [], notes: [], clock: null, candidatePeriods: [] },
    } : null),
    askStatus: async () => ({ modelConfigured: false }),
    conversations: async () => ({ conversations: [] }),
    conversationMessages: async () => ({ messages: [] }),
    saveTurns,
    document: async (id: string) => (id === DOC ? docDetail() : id === UNDOC ? undocDetail() : null),
    documents: async () => ({ documents: [undocDetail().document], limits: { maxBytes: 1, readableMimeTypes: [] } }),
    reviewDocumentField, applyTargets, applyPreview, applyToRecord,
    uploadDocument, documentFiled,
  },
}));

const me = {
  user: { id: ME, email: "wanjiru@example.test", full_name: "Wanjiru Kamau", display_name: null },
  memberships: [],
  active_organization: { id: ORG, name: "Tausi Brokers", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
  permissions: ["placement:approve", "organization:edit", "client:create", "client:edit", "claim:create", "space:create", "job:edit", "automation:create", "automation:edit", "audit:view", "email:approve", "policy:edit"],
};

async function live(who: typeof me = me) {
  const { loadLiveAdapters } = await import("./live.js");
  return (await loadLiveAdapters({ me: who, switchToDemo: () => {} })) as {
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
    runState = "waiting_approval";
    decideApproval.mockClear();
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
    for (const ws of ["compare", "money", "reconciliation", "commission"]) {
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
    // D-137: the chat card for the same batch, pressed after the Space imported it, is done — not Retry.
    const late = (await A.records.act("import.commit", { batchId: "80000000-0000-4000-8000-000000000001" })) as { ok: boolean; error?: string };
    expect(late.ok).toBe(true);
    expect(commitImport).toHaveBeenCalledTimes(1);

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
    // D-138: when the record already holds the value, the document can still be filed as its evidence.
    applyPreview.mockResolvedValueOnce({ target: { targetType: "policy", targetId: POL_OK, label: "TH-MTR-001 · Motor", reason: "r", condition: "known" }, fields: [{ documentFieldId: FIELD, fieldKey: "policy_number", currentValue: "TH-MTR-001", proposedValue: "TH-MTR-001", page: 1, region: null, condition: "inferred", state: "accepted", unchanged: true, blockedBecause: null }], missing: [] } as never);
    await a.records.act("doc.applyPreview", { documentId: DOC, target: "policy:" + POL_OK });
    const ev = text(a.ai.workspace({ ws: "document", documentId: DOC }));
    expect(ev).toContain("File as evidence for TH-MTR-001 · Motor");
    expect(ev).toContain("it says nothing about cover");
    const filed = (await a.records.act("doc.apply", { documentId: DOC, evidenceOnly: true })) as { ok: boolean; text: string };
    expect(filed).toMatchObject({ ok: true, text: "Filed as evidence for TH-MTR-001 · Motor" });
    expect(applyToRecord).toHaveBeenLastCalledWith(DOC, expect.objectContaining({ fields: [expect.objectContaining({ fieldKey: "policy_number", from: "TH-MTR-001", to: "TH-MTR-001" })] }));
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

    it("an explicit client name wins over the Space in front", async () => {
      const A = await live();
      const r = await route(A, "Which policies does Tausi Farms Ltd have?", clientA);
      expect(r.lead).toMatch(/Tausi Farms Ltd/);
      expect(r.lead).not.toMatch(/Hauliers/);
    });

    it("'No, I meant the other Tausi' switches between the two similar clients", async () => {
      const A = await live();
      await route(A, "Which policies does Tausi Hauliers Ltd have?", {});
      const r = await route(A, "No, I meant the other Tausi. Which policies does it have?", {});
      expect(r.lead).toMatch(/Tausi Farms Ltd/);
    });

    it("'this claim' and 'this quotation' with nothing of that kind in front are said so, not guessed", async () => {
      const A = await live();
      expect((await route(A, "What's next on this claim?", clientA)).lead).toBe("No claim is open in front of you.");
      expect((await route(A, "What's next on this quotation?", clientBref)).lead).toBe("No quotation is open in front of you.");
    });

    it("'this quotation' and 'this work' read the record in front", async () => {
      const A = await live();
      const q = await route(A, "What's next on this quotation?", { ws: "quote", opportunityId: OPP });
      expect(q.lead).toBe("Next: Prepare the request to CIC General.");
      const w = await route(A, "What's next on this work?", { ws: "workitem", workItemId: WORK });
      expect(w.lead).toBe("Next: Request renewal terms from the insurer.");
    });

    it("removing the context chip stops it applying; the Space in front is used instead", async () => {
      const A = await live();
      const withChip = await route(A, "When does this client's policy expire?", clientA, { clientId: CLIENT_B });
      expect(withChip.lead).toMatch(/TF-FIRE-009/);
      const B = await live();
      const without = await route(B, "When does this client's policy expire?", clientBref, null);
      expect(without.lead).toMatch(/TF-FIRE-009/);
      const C = await live();
      const other = await route(C, "Which policies does this client have?", clientA, null);
      expect(other.lead).toMatch(/Tausi Hauliers/);
    });

    it("a subject from another client does not leak into a question asked in front of a different client", async () => {
      const A = await live();
      await route(A, "When does TF-FIRE-009 expire?", clientBref);
      const r = await route(A, "When does it expire?", clientA);
      expect(r.lead).not.toMatch(/TF-FIRE-009/);
    });

    it("a refresh starts a clean context: nothing resolved before it is carried over", async () => {
      const A = await live();
      await route(A, "When does TF-FIRE-009 expire?", clientBref);
      expect(A.ai.context().previousSubject).not.toBeNull();
      const B = await live();
      expect(B.ai.context().previousSubject).toBeNull();
      expect(B.ai.context().pendingAction).toBeNull();
    });

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
      // Read before the write: afterwards the Space shows what the server answered, and a supplied
      // requirement no longer offers the form.
      const form = control(B.ai.workspace({ ws: "quote", opportunityId: OPP }), "opp.action", (o) => (o["payload"] as { action?: string })?.action === "supply_requirement")!;
      expect(form).not.toBeNull();
      await B.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId);
      const fromAsk = lastOpp();
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
      expect(r.pending!.sections.find((x) => x.label === "CHANGE")!.items[0]).toBe("Due: No date → 15 Oct 2026");
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

  describe("Activity for a manager (D-124)", () => {
    it("names the person who acted, the client, the record, the outcome — and answers the manager's questions", async () => {
      const A = await live();
      const ws = A.ai.workspace({ ws: "activity" }) as { blocks: { t: string; items?: string[][]; rows?: { title: string; note: string; badge: string; action: { ref: object } | null }[] }[] };
      const all = text(ws);
      expect(all).not.toMatch(/· system\b|"system"/);
      const list = ws.blocks.find((b) => b.t === "rows")!.rows!;
      const assigned = list.find((r) => r.title.startsWith("Work assigned"))!;
      expect(assigned.note).toMatch(/^Baraka Otieno · Tausi Hauliers Ltd · Done/);
      expect(assigned.action!.ref).toEqual({ ws: "workitem", workItemId: WORK });
      expect(list.find((r) => r.badge === "Refused")!.note).toContain("Refused: permission denied");
      const facts = Object.fromEntries(ws.blocks.find((b) => b.t === "facts")!.items!);
      expect(facts["Sent outside the brokerage"]).toBe("Nothing — no message left ASAP");
      expect(facts["Cover or money"]).toBe("No change to cover or money");
      expect(facts["Blocked or refused"]).toMatch(/^1 attempt/);
      expect(facts["Next actions held by"]).toContain("Wanjiru Kamau (1)");
    });
  });

  describe("automations are honest (D-125)", () => {
    it("the saved renewal automation, whose trigger nothing emits, reads as unable to run and cannot be switched on", async () => {
      const A = await live();
      const ws = A.ai.workspace({ ws: "automation", automationId: AUTO }) as { statusLabel: string; blocks: unknown[] };
      expect(ws.statusLabel).toBe("Cannot run");
      const all = text(ws);
      expect(all).toContain("does not fire yet");
      expect(all).not.toContain("Switch this automation on");
      expect(all).toContain("Run in test mode");
      expect(all).toContain("Could not finish");
      expect(all).toContain("would act on 1 item of 4");
      expect(all).not.toMatch(/Force a failure|Simulate/);
    });

    it("the builder offers only executable triggers; Ask offers Save only when every part runs", async () => {
      const A = await live();
      const list = A.ai.workspace({ ws: "automation" }) as { blocks: { t: string; fields?: { key: string; options?: { value: string }[] }[] }[] };
      const builder = list.blocks.find((b) => b.t === "builder")!;
      expect(builder.fields!.find((f) => f.key === "trigger")!.options!.map((o) => o.value)).toEqual(["document.received"]);
      const bad = (await A.ai.route("Create an automation: when a renewal is approaching, email the client automatically", {})) as { pending?: unknown; lead: string; text: string };
      expect(bad.pending).toBeUndefined();
      expect(bad.lead).toBe("That cannot be saved as a working automation.");
      expect(bad.text).toMatch(/not available yet|does not fire yet/);
      expect(bad.text).toMatch(/never sends/);
      const good = (await A.ai.route("Create an automation: whenever a document arrives on a claim, prepare it for review", {})) as { pending: { action: string; payload: Record<string, unknown>; actionId: string } };
      expect(good.pending.action).toBe("automation.create");
      expect(good.pending.payload).toMatchObject({ trigger: "document.received", verb: "prepare", conditions: [{ fact: "kind", operator: "equals", value: "claim" }] });
      expect(createAutomation).not.toHaveBeenCalled();
      const saved = (await A.records.act(good.pending.action, good.pending.payload, good.pending.actionId)) as { ok: boolean };
      expect(saved.ok).toBe(true);
      expect(createAutomation).toHaveBeenCalledWith(expect.objectContaining({ triggerEvent: "document.received", enabled: false, approval: "always", conditions: [{ fact: "kind", operator: "equals", value: "claim" }] }));
      const tested = (await A.records.act("automation.test", { id: AUTO })) as { text: string };
      expect(tested.text).toBe("Test mode: it would act on 1 open item of 3 checked");
    });
  });

  it("a read-only member is refused plainly, before any request, from Ask and from a Space", async () => {
    const A = await live({ ...me, permissions: ["client:view", "job:view"] });
    const r = (await A.ai.route("add Simba Traders as a company client", {})) as { lead: string; pending?: unknown };
    expect(r.lead).toBe("Your role cannot add clients.");
    expect(r.pending).toBeUndefined();
    expect(createClient).not.toHaveBeenCalled();
    const w = (await A.ai.route("Assign this to Baraka", { ws: "workitem", workItemId: WORK, ref: { ws: "workitem", workItemId: WORK } })) as { lead: string };
    expect(w.lead).toBe("Your role cannot change who owns Work or when it is due.");
    const space = (await A.records.act("work.assign", { workItemId: WORK, userId: BARAKA })) as { ok: boolean; denied: boolean };
    expect(space).toMatchObject({ ok: false, denied: true });
    expect(manageWork).not.toHaveBeenCalled();
  });

  describe("onboarding QA regressions (2 Oct hosted test)", () => {
    it("an unattached upload is read on load, and its review opens that exact document — not Today", async () => {
      undocState = "extracted";
      const A = await live();
      const ws = A.ai.workspace({ ws: "document", documentId: UNDOC }) as unknown as { kind: string; title: string };
      expect(ws.kind).toBe("Document");
      expect(text(ws)).toContain("ASAP_QA_TEST_20261002.pdf");
      expect(text(ws)).not.toContain("What matters now");
    });

    it("an invalid document or an unknown destination says so instead of opening Today", async () => {
      const A = await live();
      expect((A.ai.workspace({ ws: "document", documentId: "not-a-uuid" }) as { title: string }).title).toBe("Document not found");
      expect((A.ai.workspace({ ws: "nowhere" }) as { title: string }).title).toBe("That page does not exist");
    });

    it("after a reload the document, its 12 waiting values and a live review card come back from the server", async () => {
      undocState = "extracted";
      const A = (await live()) as unknown as { ai: { workspace: (r: unknown) => unknown }; records: { sel: { conversation: (id: string) => { messages: { ingest?: string[]; restored?: boolean; lead?: string }[] } } }; ingestCard: (ids: string[], base?: unknown) => { reviewRef?: { documentId: string }; confirmLabel?: string; sections: { items: string[] }[] } };
      const setup = text(A.ai.workspace({ ws: "setup" }));
      expect(setup).toContain("ASAP_QA_TEST_20261002.pdf");
      expect(setup).toContain("12 values need confirmation");
      const card = A.records.sel.conversation("cnv_main").messages.find((m) => m.restored);
      // The card lists every document still awaiting review; the unattached upload must be among them.
      expect(card?.ingest).toContain(UNDOC);
      const live2 = A.ingestCard(card!.ingest!, { status: "open" });
      expect(live2.confirmLabel).toBe("Review values");
      expect(live2.reviewRef?.documentId).toBe(UNDOC);
    });

    it("setup never claims everything is reviewed while a file is still being read", async () => {
      undocState = "queued";
      const A = await live();
      const setup = text(A.ai.workspace({ ws: "setup" }));
      expect(setup).toContain("○ Everything read and reviewed");
      expect(setup).toContain('["Being read","1"]');
      expect(setup).toContain("ASAP_QA_TEST_20261002.pdf");
      undocState = "extracted";
    });
  });

  describe("chat attachments and onboarding (D-132)", () => {
    it("a new brokerage is welcomed with four ways to start, and can skip", async () => {
      const A = (await live()) as unknown as { greetingLead?: string; greetingChips: { label: string }[]; attachMenu: { label: string }[] };
      // This brokerage already has clients, so it is not welcomed as new.
      expect(A.greetingLead).toBeUndefined();
      expect(A.attachMenu.map((c) => c.label)).toEqual(["Upload documents", "Import client/policy records", "Add client manually", "Connect email (optional, not needed yet)"]);
    });

    it("a dropped spreadsheet becomes a creation preview; confirming creates the records through the real import", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true })));
      const A = (await live()) as unknown as { ingest: (f: File[]) => Promise<{ lead: string; pending: { action: string; title: string; confirmLabel: string; sections: { label: string; items: string[] }[] } }> };
      const r = await A.ingest([new File(["client_name,policy_number\nSimba Traders,ST-1\n"], "book.csv", { type: "text/csv" })]);
      expect(previewImport).toHaveBeenCalled();
      expect(r.lead).toBe("I found 1 client and 1 policy");
      // Premium basis is unknown, so it is not imported until corrected.
      expect(r.pending.title).toBe("Needs correcting before import");
      expect(r.pending.sections[0]!.items).toContain("Say whether the premiums are gross or total payable.");
      expect(commitImport).not.toHaveBeenCalled();
    });

    it("dropped documents are filed one by one, the same bytes are not stored twice, and unsupported files are refused", async () => {
      const put = vi.fn(async () => ({ ok: true }));
      vi.stubGlobal("fetch", put);
      const A = (await live()) as unknown as { ingest: (f: File[]) => Promise<{ lead: string; text: string; ingest: string[] }>; ingestCard: (ids: string[]) => { title: string; sections: { items: string[] }[] } };
      const r = await A.ingest([new File(["%PDF-1"], "schedule-a.pdf", { type: "application/pdf" }), new File(["%PDF-1"], "again.pdf", { type: "application/pdf" }), new File(["x"], "notes.docx")]);
      expect(uploadDocument).toHaveBeenCalledTimes(2);
      expect(put).toHaveBeenCalledTimes(1);
      expect(documentFiled).toHaveBeenCalledTimes(1);
      expect(r.text).toMatch(/notes\.docx is not a file ASAP reads/);
      const card = A.ingestCard(r.ingest);
      // Never "read" before extraction finishes: the new file is waiting, the known one is on file.
      expect(card.title).toBe("Reading 2 files…");
      expect(card.sections[0]!.items.join(" ")).toMatch(/schedule-a\.pdf — Waiting to be read/);
      expect(card.sections[0]!.items.join(" ")).toMatch(/again\.pdf — already on file/);
    });

    it("typed onboarding requests open the picker or the right Space", async () => {
      const A = await live();
      const up = (await A.ai.route("Import these policy schedules", {})) as { chips: { label: string; pick?: boolean }[] };
      expect(up.chips[0]).toMatchObject({ label: "Choose files", pick: true });
      const own = (await A.ai.route("This is Tausi Hauliers Ltd's motor policy", {})) as { lead: string };
      expect(own.lead).toBe("Files you add next are filed under Tausi Hauliers Ltd.");
      const setup = A.ai.workspace({ ws: "setup" }) as { title: string };
      expect(setup.title).toBe("Setting up your book");
    });
  });

  describe("Renewal Autopilot in the interface (D-129)", () => {
    it("the Renewal Space answers the seven questions: one status, current work, blockers, one action, follow-up, outputs", async () => {
      const A = await live();
      const ws = A.ai.workspace({ ws: "renewal", runId: RUN, workItemId: WORK });
      const all = text(ws);
      expect(ws.statusLabel).toBe("Waiting for approval from Wanjiru Kamau");
      expect(all).toContain("Started by Wanjiru Kamau on 1 October · 6 of 11 steps complete.");
      expect(all).toContain("Renewal pack ready");
      expect(all).toContain("ASAP checked the policy, looked for the schedule, prepared the renewal pack and drafted two messages.");
      expect(all).toContain("Not blocking — ASAP carries on and says so in the pack");
      expect(all).toContain("Approve bundle");
      expect(all).toContain("Escalates to Wanjiru Kamau");
      // Technical steps and the full bundle are collapsed behind their own views.
      expect(all).not.toContain("5 items on file, 1 missing");
      expect(all).not.toMatch(/was sent|has been sent/i);
      const review = text(A.ai.workspace({ ws: "renewal", runId: RUN, workItemId: WORK, view: "review" }));
      expect(review).toContain("Renewal of your Motor policy TH-MTR-001");
      expect(review).toContain("No verified address on file — you deliver it");
      expect(review).toContain("Reject — say what is wrong");
      const history = text(A.ai.workspace({ ws: "renewal", runId: RUN, view: "history" }));
      expect(history).toContain("5 items on file, 1 missing");
      const actions = text(A.ai.workspace({ ws: "renewal", runId: RUN, view: "actions" }));
      expect(actions).toContain("Pause");
      expect(actions).toContain("There is nothing to follow up yet — the insurer request has not been delivered.");
    });

    it("Ask separates the automatic window from manual renewals, approves through the same contract, and puts the next step in the receipt", async () => {
      const A = await live();
      const list = (await A.ai.route("What renewals are coming up?", {})) as { lead: string; text: string };
      expect(list.lead).toBe("No policy period ends within the 60-day renewal window.");
      expect(list.text).toMatch(/1 renewal was started by a person, outside the automatic window/);
      const ref = { ws: "renewal", runId: RUN, workItemId: WORK };
      const r = (await A.ai.route("Approve the renewal", { ...ref, ref })) as { pending: { action: string; payload: Record<string, string>; actionId: string } };
      expect(r.pending.action).toBe("renewal.decide");
      expect(decideApproval).not.toHaveBeenCalled();
      const [first, second] = await Promise.all([A.records.act(r.pending.action, r.pending.payload, r.pending.actionId), A.records.act(r.pending.action, r.pending.payload, r.pending.actionId)]);
      expect(decideApproval).toHaveBeenCalledTimes(1);
      expect(decideApproval).toHaveBeenCalledWith(APPROVAL, { decision: "approve", bundleSha256: "c".repeat(64) });
      const res = first as { ok: boolean; text: string; detail: string; status: string; next: { label: string }[] };
      expect(res).toMatchObject({ ok: true, status: "succeeded", text: "Approved — not sent" });
      expect(res.detail).toBe("ASAP opened the next step: deliver the insurer request and record how it was delivered. Next follow-up after delivery: 5 days.");
      expect(res.next[0]!.label).toBe("Open next step");
      expect(second).toBe(first);
      // The Space shows the approved state at once — no reload, no wait for the re-read.
      expect(A.ai.workspace(ref).statusLabel).toBe("Approved — not delivered");
    });

    it("Ask answers from the workflow in front and turns controls into confirm cards on the real endpoints", async () => {
      const A = await live();
      const ref = { ws: "renewal", runId: RUN, workItemId: WORK };
      const where = (await A.ai.route("Where is this renewal?", { ...ref, ref })) as { lead: string };
      expect(where.lead).toBe("Tausi Hauliers Ltd — Motor renewal: Waiting for approval from Wanjiru Kamau.");
      const pause = (await A.ai.route("Pause this", { ...ref, ref })) as { pending: { action: string; payload: Record<string, unknown> } };
      expect(pause.pending).toMatchObject({ action: "renewal.pause", payload: { runId: RUN } });
      const now = (await A.ai.route("Follow up now", { ...ref, ref })) as { lead: string; pending?: unknown };
      expect(now.pending).toBeUndefined();
      expect(now.lead).toBe("Follow up now isn't available.");
    });

    it("the Work item shows ASAP is handling the renewal; a stop says what is needed and offers resume", async () => {
      runState = "exception";
      const A = await live();
      expect(text(A.ai.workspace({ ws: "workitem", workItemId: WORK }))).toContain("ASAP is handling this renewal");
      const ws = text(A.ai.workspace({ ws: "renewal", runId: RUN }));
      expect(ws).toContain("No renewal terms from First Insurer with 5 days to expiry.");
      expect(ws).toContain("Call the underwriter at First Insurer today.");
      expect(ws).toContain("I've fixed it — resume");
    });
  });

  /*
   * The acceptance-test path (fresh brokerage): insurers added to an existing quote by name and a
   * draft prepared to each, contacts saved with and after the client, and the quote view agreeing
   * with what the server answered the moment a write lands.
   */
  describe("insurers, drafts and contacts from Ask", () => {
    type Pending = { action: string; payload: Record<string, unknown>; actionId: string; sections: { label: string; items: string[] }[]; external: string; title: string };
    type Routed = { pending?: Pending; lead?: string; text?: string; clarify?: { options: { label: string; text: string }[] } };
    const ctx = { ws: "quote", opportunityId: OPP, clientId: CLIENT, ref: { ws: "quote", opportunityId: OPP } };
    const ask = async (A: Awaited<ReturnType<typeof live>>, q: string, c: unknown = ctx) => (await A.ai.route(q, c)) as Routed;
    const section = (r: Routed, label: string) => r.pending!.sections.find((x) => x.label === label)?.items ?? [];
    const withOutstanding = () => {
      const d = oppDetail();
      d.requirements[0]!.suppliedAt = null as unknown as string;
      d.requirements[0]!.label = "UX TEST: five vehicle values and logbooks";
      return d;
    };
    beforeEach(() => {
      opportunityAction.mockClear();
      createClient.mockClear();
      createContact.mockClear();
      updateContact.mockClear();
    });

    it("three insurers named at once: one card with client, quote, requirement and recipients — nothing sent, nothing written before confirm", async () => {
      const api = (await import("../lib/api.js")).api as unknown as { opportunity: (id: string) => Promise<unknown> };
      const spy = vi.spyOn(api, "opportunity").mockResolvedValue(withOutstanding());
      const A = await live();
      const r = await ask(A, "For the UX TEST Karibu Logistics quote, add APA Insurance, CIC and Jubilee as insurers to approach. Prepare each request but do not send anything.");
      expect(r.clarify).toBeUndefined();
      expect(r.pending!.action).toBe("opp.action");
      // CIC resolves to CIC General on file, Jubilee to Jubilee Insurance; APA is put on file.
      expect(r.pending!.payload).toEqual({ id: OPP, action: "approach_insurers", insurers: [{ name: "APA Insurance" }, { insurerId: INS_CIC }, { insurerId: "92000000-0000-4000-8000-000000000002" }], prepare: true });
      expect(section(r, "UNDERSTOOD")).toEqual(["Client: Tausi Hauliers Ltd", "Quote: Motor fleet (Commercial motor)", "Insurers: APA Insurance, CIC General, Jubilee Insurance"]);
      expect(section(r, "MISSING").join(" ")).toMatch(/UX TEST: five vehicle values and logbooks — does not stop the drafts/);
      expect(section(r, "CHANGE").join(" ")).toMatch(/APA Insurance — put on file as a new insurer/);
      expect(section(r, "CHANGE").join(" ")).toMatch(/CIC General — already on this quotation, not added twice/);
      expect(section(r, "CHANGE").join(" ")).toMatch(/no insurer address is on file/);
      expect(r.pending!.external).toMatch(/^Nothing is sent/);
      expect(opportunityAction).not.toHaveBeenCalled();
      // The same list asked again is the same action: a second confirm is not a second write.
      const again = await ask(A, "For the UX TEST Karibu Logistics quote, add APA Insurance, CIC and Jubilee as insurers to approach. Prepare each request but do not send anything.");
      expect(again.pending!.actionId).toBe(r.pending!.actionId);
      spy.mockRestore();
    });

    it("confirmed: the receipt says drafts were prepared and nothing was sent, and the requirement stays outstanding", async () => {
      const d = withOutstanding();
      opportunityAction.mockResolvedValueOnce({ outcome: "done", reason: null, opportunity: d, results: [
        { insurerId: "92000000-0000-4000-8000-0000000000a1", insurerName: "APA Insurance", newOnFile: true, approach: "added", request: "prepared" },
        { insurerId: INS_CIC, insurerName: "CIC General", newOnFile: false, approach: "already", request: "prepared" },
      ] } as never);
      const A = await live();
      const out = (await A.records.act("opp.action", { id: OPP, action: "approach_insurers", insurers: [{ name: "APA Insurance" }, { insurerId: INS_CIC }], prepare: true }, "k1")) as { ok: boolean; text: string; receipt: { changed: string[]; unchanged: string[] } };
      expect(out.ok).toBe(true);
      expect(out.text).toBe("1 insurer added, 2 draft requests prepared — nothing was sent");
      expect(out.receipt.changed).toEqual(["APA Insurance (put on file) — added, draft request prepared", "CIC General — already on this quotation, draft request prepared"]);
      expect(out.receipt.unchanged).toEqual(expect.arrayContaining(["No request was sent or approved", "No insurer has been contacted", "The client requirement is still outstanding: UX TEST: five vehicle values and logbooks"]));
      expect(JSON.stringify(out)).not.toMatch(/(?<![Nn]othing )\b(was|were) sent\b(?! or)|approached by ASAP/);
    });

    it("the quote view shows what the server answered at once, before any re-read", async () => {
      const A = await live();
      const d = oppDetail();
      d.requirements.push({ id: "93000000-0000-4000-8000-000000000009", label: "UX TEST: five vehicle values and logbooks", required: true, suppliedAt: null as unknown as string, suppliedByName: null as unknown as string, evidence: null });
      opportunityAction.mockResolvedValueOnce({ outcome: "done", reason: null, opportunity: d } as never);
      await A.records.act("opp.action", { id: OPP, action: "add_requirement", label: "UX TEST: five vehicle values and logbooks" }, "k2");
      const view = JSON.stringify(A.ai.workspace({ ws: "quote", opportunityId: OPP }));
      expect(view).toContain("UX TEST: five vehicle values and logbooks");
      expect(view).toContain("Outstanding");
      expect(view).toMatch(/does not stop you adding insurers or preparing drafts/);
    });

    it("asked without names, it asks which insurers; the reply naming three is read against the same quote", async () => {
      const A = await live();
      const first = await ask(A, "Add insurers to this quotation and prepare each request");
      expect(first.lead).toBe("Which insurers should I add?");
      expect(opportunityAction).not.toHaveBeenCalled();
      // The reply carries no "insurer" or "quote" — and no quotation is open in context any more.
      const reply = await ask(A, "All three: APA Insurance, CIC and Jubilee", {});
      expect(reply.pending!.payload).toMatchObject({ id: OPP, action: "approach_insurers", prepare: true });
      expect((reply.pending!.payload["insurers"] as unknown[]).length).toBe(3);
    });

    it("an ambiguous name asks a short clarification and writes nothing; a clear list does not", async () => {
      const api = (await import("../lib/api.js")).api as unknown as { opportunity: (id: string) => Promise<unknown> };
      const d = oppDetail();
      d.availableInsurers = [{ id: INS_CIC, name: "CIC General" }, { id: "92000000-0000-4000-8000-0000000000c1", name: "Jubilee Allianz General" }, { id: "92000000-0000-4000-8000-0000000000c2", name: "Jubilee Health Insurance" }];
      const spy = vi.spyOn(api, "opportunity").mockResolvedValue(d);
      const A = await live();
      const r = await ask(A, "Add APA and Jubilee as insurers to this quotation");
      expect(r.lead).toBe("Which “Jubilee”?");
      expect(r.clarify!.options.map((o) => o.label)).toEqual(["Jubilee Allianz General", "Jubilee Health Insurance"]);
      expect(r.clarify!.options[0]!.text).toBe("APA, Jubilee Allianz General");
      expect(opportunityAction).not.toHaveBeenCalled();
      const picked = await ask(A, r.clarify!.options[0]!.text);
      if (!picked.pending) throw new Error(JSON.stringify(picked));
      expect(picked.pending!.payload["insurers"]).toEqual([{ name: "APA" }, { insurerId: "92000000-0000-4000-8000-0000000000c1" }]);
      spy.mockRestore();
    });

    it("prepare each request for insurers already on the quote: one draft each, one confirm", async () => {
      const api = (await import("../lib/api.js")).api as unknown as { opportunity: (id: string) => Promise<unknown> };
      const d = oppDetail();
      d.insurers.push({ ...d.insurers[0]!, id: "91000000-0000-4000-8000-000000000002", insurerId: "92000000-0000-4000-8000-000000000002", insurerName: "Jubilee Insurance" });
      const spy = vi.spyOn(api, "opportunity").mockResolvedValue(d);
      const A = await live();
      const r = await ask(A, "Prepare each request");
      if (!r.pending) throw new Error(JSON.stringify(r));
      expect(r.pending!.payload).toEqual({ id: OPP, action: "approach_insurers", insurers: [{ insurerId: INS_CIC }, { insurerId: "92000000-0000-4000-8000-000000000002" }], prepare: true });
      expect(r.pending!.external).toMatch(/Nothing is sent/);
      spy.mockRestore();
    });

    it("the quote Space adds insurers by name with the same contract, and a prepared draft can be read, copied and edited before approval", async () => {
      oppStage = "request_prepared";
      const A = await live();
      const ws = A.ai.workspace({ ws: "quote", opportunityId: OPP });
      const t = JSON.stringify(ws);
      expect(t).toContain("Add insurers to approach");
      expect(t).toContain("Draft request to CIC General — not approved, not sent");
      expect(t).toContain("Edit the draft to CIC General");
      expect(t).toContain("no insurer address on file");
      await A.records.act("opp.approach", { id: OPP, names: "APA Insurance, CIC and Jubilee", prepare: "yes" }, "k3");
      expect(opportunityAction.mock.calls.at(-1)).toEqual([OPP, { action: "approach_insurers", insurers: [{ name: "APA Insurance" }, { name: "CIC" }, { name: "Jubilee" }], prepare: true }]);
      oppStage = "not_asked";
    });

    it("adding a client with a contact: the preview and the create carry it; the receipt claims it only when saved and read back", async () => {
      const A = await live();
      const r = await ask(A, "Add UX TEST Karibu Logistics Ltd as a company client. Primary contact: UX TEST David Otieno, Finance Manager, david.otieno@example.test", {});
      expect(createClient.mock.calls[0]![0]).toMatchObject({ preview: true, contact: { fullName: "UX TEST David Otieno", roleLabel: "Finance Manager", email: "david.otieno@example.test", phone: null } });
      expect(section(r, "UNDERSTOOD")).toContain("Primary contact: UX TEST David Otieno · Finance Manager · david.otieno@example.test");
      expect(r.text).toMatch(/UX TEST David Otieno is saved as the primary contact with the client/);
      createClient.mockImplementationOnce(async () => ({ outcome: "created", file: { client: { id: "30000000-0000-4000-8000-0000000000ff" } }, contact: { state: "saved", contactId: "c9000000-0000-4000-8000-0000000000aa", reason: null } }) as never);
      created.push({ id: "30000000-0000-4000-8000-0000000000ff", name: "UX TEST Karibu Logistics Ltd" });
      const out = (await A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId)) as { ok: boolean; text: string; receipt: { changed: string[] } };
      expect(createClient.mock.calls.at(-1)![0]).toMatchObject({ confirmNew: true, contact: { fullName: "UX TEST David Otieno", roleLabel: "Finance Manager", email: "david.otieno@example.test", phone: null } });
      expect(out.text).toContain("with UX TEST David Otieno as the primary contact");
      expect(out.receipt.changed).toContain("Primary contact: UX TEST David Otieno");
    });

    it("a contact the server did not save is never claimed saved", async () => {
      const A = await live();
      createClient.mockImplementationOnce(async () => ({ outcome: "created", file: { client: { id: "30000000-0000-4000-8000-0000000000ff" } }, contact: { state: "not_saved", contactId: null, reason: "The contact could not be saved. Add it on the client record." } }) as never);
      if (!created.some((c) => c.id === "30000000-0000-4000-8000-0000000000ff")) created.push({ id: "30000000-0000-4000-8000-0000000000ff", name: "UX TEST Karibu Logistics Ltd" });
      const out = (await A.records.act("client.create", { name: "UX TEST Karibu Logistics Ltd", kind: "corporate", confirmNew: "yes", contactName: "UX TEST David Otieno", contactEmail: "david.otieno@example.test" }, "k4")) as { text: string; receipt: { changed: string[]; unchanged: string[] } };
      expect(out.text).not.toMatch(/primary contact/);
      expect(out.receipt.changed).not.toContain("Primary contact: UX TEST David Otieno");
      expect(out.receipt.unchanged.join(" ")).toMatch(/The contact was not saved/);
    });

    it("adding a contact afterwards from Ask, and editing it: cards first, saved to the record, shown on the client after", async () => {
      const A = await live();
      const r = await ask(A, "Add UX TEST David Otieno, Finance Manager, david.otieno@example.test as the contact for Tausi Hauliers", {});
      if (!r.pending) throw new Error(JSON.stringify(r));
      expect(r.pending!.action).toBe("contact.create");
      expect(r.pending!.payload).toEqual({ clientId: CLIENT, fullName: "UX TEST David Otieno", roleLabel: "Finance Manager", email: "david.otieno@example.test", phone: "" });
      expect(r.pending!.external).toBe("No message is sent to them.");
      expect(createContact).not.toHaveBeenCalled();
      await A.records.act(r.pending!.action, r.pending!.payload, r.pending!.actionId);
      expect(createContact).toHaveBeenCalledTimes(1);
      const client = JSON.stringify(A.ai.workspace({ ws: "client", clientId: CLIENT }));
      expect(client).toContain("UX TEST David Otieno");
      expect(client).toContain("Finance Manager · david.otieno@example.test · no phone on file");
      // The one on file by that name is updated, not duplicated.
      const edit = await ask(A, "Update the contact Otieno Were, Finance Director, +254 700 000 111 for Tausi Hauliers", {});
      expect(edit.pending!.action).toBe("contact.update");
      expect(edit.pending!.payload).toMatchObject({ contactId: "c1", fullName: "Otieno Were", roleLabel: "Finance Director", email: "otieno@example.test", phone: "+254 700 000 111" });
      await A.records.act(edit.pending!.action, edit.pending!.payload, edit.pending!.actionId);
      expect(updateContact).toHaveBeenCalledWith("c1", { fullName: "Otieno Were", roleLabel: "Finance Director", email: "otieno@example.test", phone: "+254 700 000 111" });
      expect(JSON.stringify(A.ai.workspace({ ws: "client", clientId: CLIENT }))).toContain("Finance Director");
    });

    it("a client whose first word is short is still opened by its name", async () => {
      const id = "30000000-0000-4000-8000-0000000000ux";
      created.push({ id, name: "UX TEST Karibu Logistics Ltd" });
      const A = await live();
      const r = await A.ai.route("Open UX TEST Karibu Logistics Ltd", {});
      expect((r.ref as { ws: string; clientId?: string })).toMatchObject({ ws: "client", clientId: id });
      const without = await A.ai.route("Open UX TEST Karibu Logistics", {});
      expect((without.ref as { clientId?: string }).clientId).toBe(id);
      created.splice(created.findIndex((c) => c.id === id), 1);
    });

    it("the client record lists its contacts, each opening an edit form, with a way to add another", async () => {
      const A = await live();
      const client = A.ai.workspace({ ws: "client", clientId: CLIENT });
      const t = JSON.stringify(client);
      expect(t).toContain("\"label\":\"Contacts\"");
      expect(t).toContain("\"contactId\":\"c1\"");
      expect(t).toContain("Add another contact");
      const edit = JSON.stringify(A.ai.workspace({ ws: "newcontact", clientId: CLIENT, contactId: "c1" }));
      expect(edit).toContain("Edit Otieno Were");
      expect(edit).toContain("\"action\":\"contact.update\"");
      expect(edit).toContain("\"value\":\"otieno@example.test\"");
    });
  });

  /*
   * Staging acceptance findings (D-135), in live mode: the import space asks for the premium basis
   * only when the server needs it, offers the workbook's sheets and a column mapping, and says what
   * a reload lost; a claim never saves the prompt as the incident; the cover check offers no button
   * it cannot honour; and quotations are compared from what was read, with no pick.
   */
  describe("staging findings", () => {
    const apiMod = async () => (await import("../lib/api.js")).api as unknown as Record<string, unknown>;

    it("import: the premium-basis question follows the server; sheets and headings re-read the same file; nothing is written", async () => {
      previewImport.mockClear();
      const original = previewImport.getMockImplementation()!;
      previewImport.mockImplementation(async () => ({
        batch: { id: "80000000-0000-4000-8000-000000000002", filename: "14_UX_TEST_Client_Vehicle_Policy_Book.xlsx", rowCount: 1, premiumBasis: null },
        source: "spreadsheet", sheetName: "Clients and policies",
        sheets: [{ name: "Read Me", rows: 3, headers: ["Sheet", "What it holds"] }, { name: "Clients and policies", rows: 1, headers: ["Client", "Named Party", "Premium"] }],
        rows: [{ id: "r1", lineNumber: 2, outcome: "match", problem: null, clientName: "UX TEST Karibu Logistics Ltd", contactName: "UX TEST David Otieno", contactEmail: "david.otieno@example.test", policyNumber: "UX-MTR-001", insurerName: "UX TEST Jubilee", classOfBusiness: "Motor", periodStart: "2026-10-01", periodEnd: "2027-09-30", premiumAmount: null, matchedClientId: CLIENT, candidates: [], contactStatus: "on_file" }],
        summary: { rows: 1, clientsToCreate: 0, contactsToCreate: 0, policiesToCreate: 1, needsReview: 0, invalid: 0 },
        // A premium column, empty on every row: the server does not ask, so neither does the page.
        columns: [{ header: "Client", meaning: "client_name" }, { header: "Named Party", meaning: null }, { header: "Premium", meaning: "premium_amount" }],
        blocking: [], mappedByModel: [],
      }) as never);
      const A = await live();
      await A.documents.read(new File(["x"], "14_UX_TEST_Client_Vehicle_Policy_Book.xlsx"));
      await A.records.act("import.preview", { name: "14_UX_TEST_Client_Vehicle_Policy_Book.xlsx" });
      const ws = text(A.ai.workspace({ ws: "import" }));
      expect(ws).not.toMatch(/Premiums in this file are gross/);
      expect(ws).toContain("New contacts\",\"0 (1 contact is already on file)");
      expect(ws).toContain("Sheets in this workbook");
      expect(ws).toContain("Read this sheet");
      expect(ws).toContain("What each column holds");
      await A.records.act("import.sheet", { sheet: "Read Me" });
      expect(previewImport).toHaveBeenLastCalledWith(expect.objectContaining({ sheetName: "Read Me" }));
      // Mapping: the column's position names it; the meaning goes to the server as the header's.
      await A.records.act("import.map", { col0: "client_name", col1: "contact_name", col2: "ignore" });
      expect(previewImport).toHaveBeenLastCalledWith(expect.objectContaining({ sheetName: "Read Me", columns: { Client: "client_name", "Named Party": "contact_name" } }));
      expect(commitImport).not.toHaveBeenCalledWith("80000000-0000-4000-8000-000000000002", expect.anything());
      previewImport.mockImplementation(original);
    });

    it("import: after a reload, a file that was read but not imported is said to be gone, not kept", async () => {
      const api = await apiMod();
      api["imports"] = async () => ({ batches: [{ id: "80000000-0000-4000-8000-000000000003", filename: "14_UX_TEST_Client_Vehicle_Policy_Book.xlsx", rowCount: 2, premiumBasis: null, status: "previewed", clientsCreated: 0, contactsCreated: 0, policiesCreated: 0, periodsCreated: 0, rowsSkipped: 0, failureReason: null, createdAt: "2026-10-03T08:00:00Z", committedAt: null }] });
      const A = await live();
      const ws = text(A.ai.workspace({ ws: "import" }));
      expect(ws).toContain("“14_UX_TEST_Client_Vehicle_Policy_Book.xlsx” was read but not imported");
      expect(ws).toContain("Nothing from that file was saved to your records");
      delete api["imports"];
    });

    it("claim: the three observed prompts keep only the incident; a prompt with no facts asks instead of saving it", async () => {
      const A = await live();
      const ctxP = { ws: "policy", clientId: CLIENT, policyYearId: PER_OK, ref: { ws: "policy", clientId: CLIENT, policyYearId: PER_OK } };
      // Two policies on file: ASAP asks which; the person picks TH-MTR-001.
      const which = (await A.ai.route("UX TEST KDM 811A had a low-speed collision on 2 October 2026 with front-left body damage, no injury reported. Prepare a draft claim for Tausi Hauliers but do not register it or contact anyone.", ctxP)) as { clarify: { options: { label: string; text: string }[] } };
      const pick = which.clarify.options.find((o) => o.label.startsWith("TH-MTR-001"))!;
      const r = (await A.ai.route(pick.text, ctxP)) as { pending?: { payload: Record<string, string>; external: string } };
      if (!r.pending) throw new Error(JSON.stringify(r));
      expect(r.pending!.payload["incidentSummary"]).toBe("UX TEST KDM 811A had a low-speed collision on 2 October 2026 with front-left body damage, no injury reported.");
      expect(r.pending!.payload["incidentOn"]).toBe("2026-10-02");
      expect(r.pending!.external).toMatch(/No message is sent/);
      const none = (await A.ai.route("Report a claim for Tausi Hauliers on 2 October 2026. Do not contact anyone on TH-MTR-001", ctxP)) as { pending?: unknown; lead: string };
      expect(none.pending).toBeUndefined();
      expect(none.lead).toBe("What happened?");
      expect(createWorkItem).not.toHaveBeenCalledWith(expect.objectContaining({ incidentSummary: expect.stringMatching(/contact/i) }));
    });

    it("Ask opens a document named by its file, filed to a client or not, and shows a client's own contacts and policies (D-137)", async () => {
      const A = await live();
      const doc = (await A.ai.route("Open ASAP_QA_TEST_20261002.pdf for review", {})) as { lead: string; text: string; ref: { ws: string; documentId: string } };
      expect(doc.ref).toEqual({ ws: "document", documentId: UNDOC });
      expect(doc.lead).toBe("Opening ASAP_QA_TEST_20261002.pdf.");
      expect(doc.text).toMatch(/not filed to a client yet/);
      const filed = (await A.ai.route("open schedule.pdf", {})) as unknown as { ref: { documentId: string } };
      expect(filed.ref.documentId).toBe(DOC);
      const c = (await A.ai.route("Show Tausi Hauliers Ltd and its policies and contacts", {})) as { lead: string; text: string; ref: unknown };
      expect(c.lead).toBe("Tausi Hauliers Ltd: 2 policies and 1 contact on file.");
      expect(c.text).toMatch(/Contacts: Otieno Were \(Finance\) — primary\./);
      expect(c.text).toMatch(/TH-MTR-001/);
      expect(c.text).not.toMatch(/no contact/i);
      expect(c.ref).toEqual({ ws: "client", clientId: CLIENT });
    });

    it("what the person forbids is taken out before routing: read-only asks stay read-only (D-137)", async () => {
      const A = await live();
      const rec = (await A.ai.route("Help me reconcile the CIC statement for Tausi Hauliers Ltd. Preview only; do not record payments or move money", {})) as { lead: string; text: string; ref: unknown; pending?: unknown };
      expect(rec.lead).toBe("Reconciliation is not available in ASAP yet.");
      expect(rec.text).toMatch(/What you asked ASAP not to do was not done/);
      expect(rec.ref).toBeNull();
      expect(rec.pending).toBeUndefined();
      const due = (await A.ai.route("Show the premium due for Tausi Hauliers Ltd and preview the matching receipt; do not record a payment or move money", {})) as { lead: string };
      expect(due.lead).not.toBe("Due when?");
      expect(due.lead).not.toMatch(/does not move money/);
      const pl = (await A.ai.route("Prepare placement with APA for Tausi Hauliers Ltd — do not bind cover or contact anyone", {})) as { lead: string; ref: unknown };
      expect(pl.lead).toBe("Placement is not available in ASAP yet.");
      expect(pl.ref).toBeNull();
    });

    it("cover check: a vehicle on no schedule is not on cover, and live mode offers no servicing or TOR button", async () => {
      const A = await live();
      const ws = A.ai.workspace({ ws: "coverage", reg: "KDN 482Q", clientId: CLIENT });
      const t0 = text;
      expect(ws.statusLabel).toBe("Cover not verified");
      expect(t0(ws)).not.toMatch(/Not on cover|nothing covers it/);
      const t = text(ws);
      expect(t).toContain("A request from the client, a logbook or an email doesn’t prove cover");
      expect(t).toContain("ASAP has not requested time on risk and has not created any servicing work");
      expect(t).not.toMatch(/servicing\.create|tor\.request/);
    });

    it("compare: three quotation documents compared as read, each value with its source; a reload rebuilds the same; no pick", async () => {
      const api = await apiMod();
      const Q = (n: number, insurer: string, premium: string | null) => ({
        document: { id: "e000000" + n + "-0000-4000-8000-000000000001", kind: "quote_slip", filename: "0" + (n + 1) + "_UX_TEST_Quotation_" + insurer + ".pdf", mimeType: "application/pdf", byteSize: 1, pageCount: 1, extractionState: "extracted", extractionError: null, clientId: null, workItemId: null, createdAt: "2026-10-03T08:4" + n + ":00Z" },
        pages: [], fileUrl: null, fileUrlExpiresAt: null,
        fields: [{ id: "f00000" + n + "0-0000-4000-8000-000000000001", fieldKey: "premium", proposedValue: premium, correctedValue: null, state: "proposed", condition: premium ? "known" : "missing", page: premium ? 1 : null, region: null, reviewedBy: null, reviewedAt: null }],
      });
      const docs = [Q(1, "APA", "245,000"), Q(2, "CIC", "231,500"), Q(3, "Jubilee", null)];
      const reading = (d: ReturnType<typeof Q>, insurer: string) => ({ document: { id: d.document.id, filename: d.document.filename, pageCount: 1, extractionState: "extracted" }, needsManualReview: null, linkedTo: null, permissions: { canReview: true },
        fields: [{ fieldKey: "insurer_name", proposedValue: "UX TEST " + insurer, correctedValue: null, page: 1, condition: "known", state: "proposed" }, ...d.fields.map((f) => ({ fieldKey: f.fieldKey, proposedValue: f.proposedValue, correctedValue: null, page: f.page, condition: f.condition, state: f.state }))], proposals: [] });
      const realDocuments = api["documents"];
      const realDocument = api["document"];
      api["documents"] = async () => ({ documents: docs.map((d) => d.document), limits: { maxBytes: 1, readableMimeTypes: [] } });
      api["document"] = async (id: string) => docs.find((d) => d.document.id === id) ?? null;
      const quotationReading = vi.fn(async (id: string) => { const i = docs.findIndex((d) => d.document.id === id); return reading(docs[i]!, ["APA", "CIC", "Jubilee"][i]!); });
      api["quotationReading"] = quotationReading;
      try {
        const A = await live();
        const r = (await A.ai.route("Compare all three UX TEST quotations and show me what could hurt the client", {})) as { lead: string; text: string; ref: { ws: string; documentIds: string[] } };
        expect(r.ref.ws).toBe("quotecompare");
        expect(r.ref.documentIds).toHaveLength(3);
        expect(r.lead).toBe("Comparing 3 quotations as ASAP read them.");
        expect(r.text).toMatch(/^No quotation can be recommended: material terms are missing/);
        const ws = A.ai.workspace(r.ref);
        const t = text(ws);
        expect(ws.title).toBe("Comparing 3 quotations as read");
        expect(t).toContain("UX TEST APA");
        expect(t).toContain("245,000 (page 1 · read, not confirmed)");
        expect(t).toContain("Not extracted — check the document");
        expect(t).toContain("What could hurt the client");
        // The premium opens at the field it was read from.
        expect(t).toContain("\"fieldId\":\"f0000010-0000-4000-8000-000000000001\"");
        // No pick: nothing names a quotation as the one to take.
        expect(t).not.toMatch(/we recommend|recommended (quote|insurer|option)|best quote|choose UX TEST/i);
        // A reload: the same records give the same comparison.
        const B = await live();
        B.ai.workspace(r.ref);
        await new Promise((res) => setTimeout(res, 0));
        expect(text(B.ai.workspace(r.ref))).toContain("245,000 (page 1 · read, not confirmed)");
        expect(reviewDocumentField).not.toHaveBeenCalledWith(expect.stringMatching(/^e0/), expect.anything(), expect.anything());
      } finally {
        api["documents"] = realDocuments;
        api["document"] = realDocument;
        delete api["quotationReading"];
      }
    });

    it("document review: each quotation term is decided on its own, with its page, and the decision shows (D-138)", async () => {
      const api = await apiMod();
      const DQ = "e0000009-0000-4000-8000-000000000001";
      const T = "3c000000-0000-4000-8000-000000000009";
      const detail = { document: { id: DQ, kind: "quote_slip", filename: "02_UX_TEST_Quotation_APA.pdf", mimeType: "application/pdf", byteSize: 1, pageCount: 1, extractionState: "extracted", extractionError: null, clientId: null, workItemId: null, createdAt: "2026-10-03T08:40:00Z" }, pages: [], fileUrl: null, fileUrlExpiresAt: null, fields: [] };
      const term = (state: string) => ({ id: T, ordinal: 2, termType: "other", label: "Geographic scope", proposedValue: "Kenya and Uganda; other territories by written agreement.", amount: null, currency: null, page: 1, region: null, condition: "known", method: "labelled_line", state, correctedValue: null, reviewedByName: state === "proposed" ? null : "Cynthia", reviewedAt: null, quoteTermId: null });
      const reading = (state: string) => ({ document: { id: DQ, filename: detail.document.filename, pageCount: 1, extractionState: "extracted" }, needsManualReview: null, linkedTo: null, permissions: { canReview: true }, fields: [], proposals: [term(state)] });
      const realDocument = api["document"];
      api["document"] = async (id: string) => (id === DQ ? detail : null);
      api["quotationReading"] = vi.fn(async () => reading("proposed"));
      const quotationReview = vi.fn(async () => ({ outcome: "done", reason: null, reading: reading("accepted") }));
      api["quotationReview"] = quotationReview;
      try {
        const A = await live();
        A.ai.workspace({ ws: "document", documentId: DQ });
        await new Promise((res) => setTimeout(res, 0));
        A.ai.workspace({ ws: "document", documentId: DQ });
        await new Promise((res) => setTimeout(res, 0));
        let t = text(A.ai.workspace({ ws: "document", documentId: DQ }));
        expect(t).toContain("Terms ASAP read");
        expect(t).toContain("Geographic scope — page 1");
        expect(t).toContain("Read, not confirmed");
        expect(t).toContain("Reject — the document does not say this");
        const same = (await A.records.act("doc.termDecide", { documentId: DQ, proposalId: T, decision: "correct", value: "Kenya and Uganda; other territories by written agreement." })) as { ok: boolean; error: string };
        expect(same.ok).toBe(false);
        expect(quotationReview).not.toHaveBeenCalled();
        const r = (await A.records.act("doc.termDecide", { documentId: DQ, proposalId: T, decision: "accept", value: "" })) as { ok: boolean };
        expect(r.ok).toBe(true);
        expect(quotationReview).toHaveBeenCalledWith(DQ, { action: "accept_proposal", proposalId: T });
        t = text(A.ai.workspace({ ws: "document", documentId: DQ }));
        expect(t).toContain("confirmed by Cynthia");
        expect(t).not.toContain("Record decision for Geographic scope");
      } finally {
        api["document"] = realDocument;
        delete api["quotationReading"];
        delete api["quotationReview"];
      }
    });

    it("a document is filed by a person — kind and client — and an invoice is never treated as a policy (D-138)", async () => {
      const api = await apiMod();
      const DI = "e0000008-0000-4000-8000-000000000001";
      const detail = (kind: string, clientId: string | null) => ({ document: { id: DI, kind, filename: "11_UX_TEST_CIC_Premium_Invoice.pdf", mimeType: "application/pdf", byteSize: 1, pageCount: 1, extractionState: "extracted", extractionError: null, clientId, workItemId: null, createdAt: "2026-10-03T08:40:00Z" }, pages: [], fileUrl: null, fileUrlExpiresAt: null,
        fields: [{ id: "f0000080-0000-4000-8000-000000000001", fieldKey: "invoice_reference", proposedValue: "CIC-INV-UXTEST-20261201", correctedValue: null, state: "accepted", condition: "known", page: 1, region: null, reviewedBy: null, reviewedAt: null }] });
      const realDocument = api["document"];
      api["document"] = async (id: string) => (id === DI ? detail("invoice", null) : null);
      const classifyDocument = vi.fn(async (_id: string, input: { kind: string; clientId: string | null }) => ({ document: { ...detail(input.kind, input.clientId).document } }));
      api["classifyDocument"] = classifyDocument;
      api["quotationReading"] = vi.fn(async () => ({ document: { id: DI, filename: "x", pageCount: 1, extractionState: "extracted" }, needsManualReview: null, linkedTo: null, permissions: { canReview: true }, fields: [], proposals: [] }));
      try {
        const A = await live();
        A.ai.workspace({ ws: "document", documentId: DI });
        await new Promise((res) => setTimeout(res, 0));
        const t = text(A.ai.workspace({ ws: "document", documentId: DI }));
        expect(t).toContain("File this document");
        expect(t).toContain("Invoices and payments are not recorded in ASAP yet");
        expect(t).not.toContain("Create the client and policy from this document");
        const r = (await A.records.act("doc.classify", { documentId: DI, kind: "invoice", clientId: CLIENT })) as { ok: boolean; text: string };
        expect(r).toMatchObject({ ok: true, text: "Filed under Tausi Hauliers Ltd" });
        expect(classifyDocument).toHaveBeenCalledWith(DI, { kind: "invoice", clientId: CLIENT });
        expect(text(A.ai.workspace({ ws: "document", documentId: DI }))).not.toContain("Apply confirmed values to a record");
      } finally {
        api["document"] = realDocument;
        delete api["classifyDocument"];
        delete api["quotationReading"];
      }
    });

    it("compare: with fewer than two quotations it says so, and opens no empty comparison", async () => {
      const A = await live();
      const r = (await A.ai.route("Compare all three UX TEST quotations", {})) as { lead: string; ref: unknown };
      expect(r.ref).toBeNull();
      expect(r.lead).toMatch(/don’t hold any quotation documents|only one quotation/);
    });
  });
});

describe("withoutProhibitions (D-137)", () => {
  it("drops each forbidden clause and says something was forbidden", async () => {
    const { withoutProhibitions } = await import("./live.js");
    expect(withoutProhibitions("Help me reconcile CIC. Preview only; do not record payments or move money")).toEqual({ text: "Help me reconcile CIC.", prohibited: true });
    expect(withoutProhibitions("prepare (but do not register) a claim draft").text).toBe("prepare a claim draft");
    expect(withoutProhibitions("Prepare placement with APA, don't bind cover").text).toBe("Prepare placement with APA");
    expect(withoutProhibitions("What clients do I have?")).toEqual({ text: "What clients do I have?", prohibited: false });
  });
});
