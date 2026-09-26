/**
 * A measuring harness for the permanent shell. Development only.
 *
 * Geometry parity needs a real browser: jsdom cannot tell you a sidebar is 228px wide. The
 * authenticated application cannot be reached from a measuring script without a real session, so
 * this page mounts the **shipping** `Shell` and the **shipping** stylesheets over a stubbed `/me`
 * and empty board responses, and measures that.
 *
 * What it proves: the shell's geometry, typography, colour and responsive behaviour are the
 * prototype's. What it does not prove, and must never be read as proving: authentication, RLS,
 * permissions, or that any business value is real — every value here is empty or a placeholder.
 *
 * It is not part of the production build. `index.html` is the only Rollup input, so nothing here
 * is emitted into `dist/`, and `scripts/check-bundle.mjs` would see it if that changed.
 */

if (import.meta.env.PROD) throw new Error("the parity harness is a development tool");

const json = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });

/*
 * A stand-in session, so the shell renders its signed-in state. The name is obviously a stand-in:
 * no fictional brokerage, client or policy belongs in this codebase, and a plausible-looking one
 * here would end up quoted as if it were real.
 */
/*
 * A stand-in brokerage, so the boards render with content in them and can be measured.
 *
 * Every id is a real uuid and every body is the endpoint's own shape, because `lib/api.ts`
 * validates each response — a fixture the API could not have produced would leave the board in
 * its loading state and the measurement would be of a skeleton. The names are obviously
 * placeholders: no fictional client, policy or claim belongs in this codebase, and a plausible
 * one here would end up quoted as though it were real.
 */
const ORG = "10000000-0000-4000-8000-00000000000a";
const CLIENT = "20000000-0000-4000-8000-000000000001";
const OWNER = "30000000-0000-4000-8000-0000000000aa";
const ORGANIZATION = {
  id: ORG,
  name: "Placeholder Brokerage",
  country: "KE",
  currency: "KES",
  timezone: "Africa/Nairobi",
};

const params = new URLSearchParams(location.search);
/** `?rows=0` measures the empty state; anything else measures a board with content. */
const ROW_COUNT = Number.parseInt(params.get("rows") ?? "4", 10);
/** `?book=0` measures a brand-new brokerage rather than one that is merely up to date. */
const HAS_BOOK = params.get("book") !== "0";

const PARTIES = ["CIC", "client", "assessor"];

function row(i: number) {
  const id = `00000000-0000-4000-8000-00000000000${i + 1}`;
  const external = i % 3 === 1;
  return {
    id,
    organization_id: ORG,
    title: i === 0 ? "Placeholder Company motor fleet placement — 2027: cover confirmation requested" : `Placeholder work item ${i + 1}`,
    kind: (["placement", "renewal", "claim", "endorsement"] as const)[i % 4]!,
    client_id: CLIENT,
    policy_period_id: null,
    insurer_id: null,
    class_of_business: null,
    owner_id: OWNER,
    task_status: external || i === 0 ? "with_party" : "needs_you",
    task_party: i === 0 ? "Placeholder Insurer" : external ? PARTIES[i % PARTIES.length]! : null,
    task_since: "2026-08-12T00:00:00.000Z",
    task_next_check: external || i === 0 ? "2026-08-26T00:00:00.000Z" : null,
    cover_status: null,
    cover_inception_at: null,
    money_status: null,
    reason: i === 0
      ? "The request was sent and the insurer has not answered."
      : "This is the reason the engine recorded against the row, shown behind one click.",
    /* The first row is a placement's reason-keyed Work (4B-4A/4B): every field from the server. */
    source_type: i === 0 ? "placement" : null,
    source_id: i === 0 ? "40000000-0000-4000-8000-00000000000a" : null,
    reason_code: i === 0 ? "awaiting_insurer" : null,
    required_action: i === 0 ? "Record the insurer's answer when it arrives, with its evidence." : null,
    evidence_needed: i === 0 ? "The insurer's confirmation, decline or query." : null,
    outcome_after: i === 0 ? "The confirmation is checked against what the client accepted." : null,
    steps: [],
    exception: null,
    version: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-12T00:00:00.000Z",
    completed_at: null,
    deleted_at: null,
  };
}

const ROWS = Array.from({ length: Math.max(0, ROW_COUNT) }, (_, i) => row(i));
const SIGNAL = {
  id: "cover_uncertain",
  because: "Cover was requested and no confirmation is recorded.",
  points: 48,
};
const context = (r: ReturnType<typeof row>) => ({
  client: { id: CLIENT, name: "Placeholder Client Ltd" },
  owner: { id: OWNER, name: "Placeholder Owner" },
  priority: "high" as const,
  period: null,
  facts: [],
  links: { work: r.source_type === "placement" ? `/placements/${r.source_id}` : `/r/${r.id}`, client: `/files/${CLIENT}`, policy: null, ask: r.title },
});

globalThis.fetch = (async (url: RequestInfo | URL) => {
  const u = String(url);
  if (u.includes("/me")) {
    return json({
      user: {
        id: "90000000-0000-4000-8000-000000000001",
        email: "harness@example.invalid",
        display_name: "Parity Harness",
        full_name: null,
      },
      memberships: [
        {
          id: "80000000-0000-4000-8000-000000000001",
          organization: ORGANIZATION,
          role: {
            id: "70000000-0000-4000-8000-000000000001",
            key: "brokerage_admin",
            name: "Brokerage admin",
            description: null,
            is_system: true,
          },
          is_owner: true,
          status: "active",
          joined_at: "2026-01-04T00:00:00.000Z",
        },
      ],
      active_organization: ORGANIZATION,
      permissions: ["work_item:assign"],
    });
  }
  if (u.includes("/attention")) {
    return json({
      organization: { id: ORG, name: ORGANIZATION.name },
      generatedAt: "2026-08-20T09:00:00.000Z",
      items: ROWS.map((r, i) => ({
        section: "needs_you",
        rank: i + 1,
        score: 48,
        item: r,
        reason: r.reason,
        signals: [SIGNAL],
        nowStep: null,
        runFailure: null,
        ...context(r),
      })),
      sections: [
        {
          key: "needs_you",
          label: "What matters now",
          visible: ROWS.length,
          returned: ROWS.length,
        },
        { key: "checks_due", label: "Checks due", visible: 0, returned: 0 },
      ],
      orphanRuns: [],
      degraded: [],
      cap: 12,
      book: HAS_BOOK
        ? { clients: 12, policies: 20, work: ROWS.length }
        : { clients: 0, policies: 0, work: 0 },
    });
  }
  if (u.includes("/work")) {
    const view = new URL(u, location.origin).searchParams.get("view") ?? "needs";
    return json({
      organization: { id: ORG, name: ORGANIZATION.name },
      view,
      label: view,
      generatedAt: "2026-08-20T09:00:00.000Z",
      items: ROWS.map((r, i) => ({
        rank: i + 1,
        item:
          view === "done"
            ? { ...r, task_status: "done", completed_at: "2026-08-19T00:00:00.000Z" }
            : r,
        reason: r.reason,
        nowStep: { id: "confirm", label: "Confirm cover", actor: "insurer" },
        runFailure: null,
        signals: [SIGNAL],
        ...context(r),
      })),
      visible: ROWS.length,
      returned: ROWS.length,
      cap: 50,
      counts: { needs: ROWS.length, with: 2, progress: 1, review: 0, recent: 3, done: 5 },
      degraded: [],
    });
  }
  if (u.includes("/search")) {
    const q = new URL(u, location.origin).searchParams.get("q") ?? "";
    return json({
      query: q,
      results:
        q === ""
          ? []
          : [
              { id: CLIENT, kind: "client", title: "Placeholder Client Ltd", subtitle: "Corporate client", to: `/clients/${CLIENT}`, clientName: null },
              { id: "00000000-0000-4000-8000-000000000001", kind: "policy", title: "P-PLACEHOLDER-1", subtitle: "Commercial motor", to: "/r/00000000-0000-4000-8000-000000000001?kind=policy", clientName: "Placeholder Client Ltd" },
              { id: "00000000-0000-4000-8000-000000000002", kind: "document", title: "placeholder-schedule.pdf", subtitle: "Policy schedule · not read yet", to: "/documents/00000000-0000-4000-8000-000000000002", clientName: "Placeholder Client Ltd" },
              { id: "00000000-0000-4000-8000-000000000003", kind: "email", title: "Placeholder thread subject", subtitle: "Email thread", to: "/email?thread=x", clientName: "Placeholder Client Ltd" },
            ],
      degraded: [],
    });
  }
  if (/\/runs\/[^/?]+$/.test(u.split("?")[0] ?? "")) {
    const runId = "50000000-0000-4000-8000-000000000001";
    return json({
      run: {
        id: runId,
        organization_id: ORG,
        work_item_id: ROWS[0]?.id ?? null,
        title: "Read the placeholder schedule",
        status: "could_not_finish",
        next_step: "Page 2 has no readable text.",
        started_by: null,
        boot_token: null,
        started_at: "2026-08-20T08:00:00.000Z",
        ended_at: "2026-08-20T08:04:00.000Z",
        created_at: "2026-08-20T08:00:00.000Z",
        updated_at: "2026-08-20T08:04:00.000Z",
      },
      events: [
        { id: 1, run_id: runId, seq: 1, kind: "step", message: "Opened the document", created_at: "2026-08-20T08:01:00.000Z" },
        { id: 2, run_id: runId, seq: 2, kind: "step", message: "Read pages 1 of 2", created_at: "2026-08-20T08:02:00.000Z" },
        { id: 3, run_id: runId, seq: 3, kind: "error", message: "Page 2 has no readable text", created_at: "2026-08-20T08:04:00.000Z" },
      ],
      relatedWork: ROWS[0]
        ? { id: ROWS[0].id, title: ROWS[0].title, taskStatus: "needs_you", nowStep: "Confirm the sum insured" }
        : null,
      evidence: [{ label: "Uploaded file", reference: "placeholder-schedule.pdf", recordedBy: "Placeholder Owner", recordedAt: null }],
      waitingFor: null,
      recovery: [
        { kind: "open_work", label: "Open the work", disabledReason: null },
        { kind: "retry", label: "Read it again", disabledReason: null },
      ],
    });
  }
  if (u.includes("/runs")) {
    const filter = new URL(u, location.origin).searchParams.get("filter") ?? "all";
    const runId = "50000000-0000-4000-8000-000000000001";
    const item = {
      run: {
        id: runId,
        organization_id: ORG,
        work_item_id: ROWS[0]?.id ?? null,
        title: "Read the placeholder schedule",
        status: "could_not_finish",
        next_step: "Page 2 has no readable text.",
        started_by: null,
        boot_token: null,
        started_at: "2026-08-20T08:00:00.000Z",
        ended_at: "2026-08-20T08:04:00.000Z",
        created_at: "2026-08-20T08:00:00.000Z",
        updated_at: "2026-08-20T08:04:00.000Z",
      },
      group: "work",
      progress: 40,
      lastEvent: "Page 2 has no readable text",
      waitingFor: null,
      needsPerson: true,
      work: ROWS[0] ? { id: ROWS[0].id, title: ROWS[0].title } : null,
      client: { id: CLIENT, name: "Placeholder Client Ltd" },
      period: null,
    };
    return json({
      organization: { id: ORG, name: ORGANIZATION.name },
      filter,
      label: filter,
      generatedAt: "2026-08-20T09:00:00.000Z",
      groups: ROWS.length === 0 ? [] : [{ key: "work", title: "ignored", items: [item] }],
      counts: { all: 1, running: 0, waiting: 0, work: 1, completed: 0 },
      visible: 1,
      returned: 1,
      cap: 50,
      degraded: [],
    });
  }
  if (u.includes("/mailboxes")) {
    return json({
      mailboxes: [
        {
          id: "70000000-0000-4000-8000-000000000001",
          provider: "gmail",
          emailAddress: "broking@example.invalid",
          displayName: null,
          status: "connected",
          statusReason: null,
          lastSyncedAt: null,
          connectedAt: "2026-08-01T00:00:00.000Z",
          sync: {
            state: "never",
            runId: null,
            lastSyncedAt: null,
            error: null,
            canStart: false,
            cannotStartReason: "Nothing reads a mailbox in this deployment yet.",
          },
        },
      ],
      providers: [
        { id: "gmail", label: "Gmail", available: true, unavailableReason: null },
        { id: "microsoft", label: "Microsoft 365", available: false, unavailableReason: "This deployment has no Microsoft credentials." },
      ],
    });
  }
  if (u.includes("/pins")) return json({ pins: [] });
  /*
   * Quotation work. The shape comes from the harness URL so every state a real one passes through
   * can be photographed: nothing asked yet, prepared, approved-but-unsent, quoted, declined.
   */
  /*
   * One placement. `stage` photographs each step it passes through, so the capture proves each
   * reads as what it is: instructed, draft, approved-not-sent, sent, confirmed-not-begun, active
   * cover, confirmed on changed terms, and a quotation that moved under the instruction.
   */
  if (u.includes("/placements/")) {
    const q = new URLSearchParams(location.search);
    const asked = q.get("stage") ?? "instructed";
    /* 4B-4B stages start from an existing one and are adjusted by placementStage() below. */
    const BASE: Record<string, string> = {
      "condition-unresolved": "active", "condition-satisfied": "active", "condition-waived": "active",
      "end-date-added": "changed", partial: "changed", "prepared-stale": "prepared", receipt: "accepted",
    };
    const stage = BASE[asked] ?? asked;
    const hasRequest = !["instructed", "drifted"].includes(stage);
    const approved = ["approved", "submitted", "future", "active", "changed", "rejected", "accepted", "prepared"].includes(stage);
    const wasSent = ["submitted", "future", "active", "changed", "rejected", "accepted", "prepared"].includes(stage);
    /* "rejected" and "accepted" are the client's answer to changed terms; "prepared" is Ask's. */
    const changedTerms = ["changed", "rejected", "prepared"].includes(stage);
    const answer = stage === "future" ? { outcome: "confirmed_as_requested", effectiveAt: "2099-01-01T00:00:00.000Z" }
      : stage === "active" ? { outcome: "confirmed_as_requested", effectiveAt: "2026-09-01T00:00:00.000Z" }
      : changedTerms || stage === "accepted" ? { outcome: "confirmed_with_changes", effectiveAt: "2026-09-01T00:00:00.000Z" }
      : null;
    const cover = stage === "future" ? { state: "confirmed", line: "Placeholder Insurer confirmed cover, beginning 1 Jan 2099. It has not started yet." }
      : stage === "active" ? { state: "active", line: "Cover began 1 Sept 2026, until 31 Aug 2027." }
      : changedTerms || stage === "accepted" ? { state: "active", line: "Cover began 1 Sept 2026 on the insurer's changed terms, until 31 Aug 2027." }
      : wasSent ? { state: "submitted", line: "Sent to Placeholder Insurer on 8 Sept 2026. Not confirmed — there is no cover yet." }
      : hasRequest ? { state: "requested", line: "A request is prepared. It has not been sent, and there is no cover." }
      : { state: null, line: "Nothing has been requested from the insurer yet." };
    const reason = stage === "instructed" ? "prepare_request" : stage === "drifted" ? "quote_moved" : stage === "draft" ? "approval_required"
      : stage === "approved" ? "submission_proof_missing" : stage === "submitted" ? "awaiting_insurer" : changedTerms && stage !== "rejected" ? "review_changed_terms"
      : stage === "rejected" ? "resolve_rejected_changes" : "issue_policy";
    const copy: Record<string, [string, string, string, string]> = {
      prepare_request: ["prepare the placement request", "The client has instructed, and nothing has been prepared for the insurer yet.", "Prepare the placement request from the frozen terms.", "None — a draft is not sent."],
      quote_moved: ["review what changed in the quotation", "The insurer revised the quotation after the client accepted it.", "Review each change, and record the client's instruction again where it matters.", "A new client instruction, if the change is material."],
      approval_required: ["approve placement request", "A placement request is prepared and nobody permitted has approved it.", "Approve the current version of the request.", "Approval by someone who may approve placements."],
      submission_proof_missing: ["send the approved request and record how", "The request is approved but there is no evidence it reached the insurer.", "Send it yourself — sending from ASAP is not connected — then record how, to whom and when.", "The sent message, or a note of when, from which mailbox and to whom."],
      awaiting_insurer: ["cover confirmation requested", "The request was sent and the insurer has not answered.", "Record the insurer's answer when it arrives, with its evidence.", "The insurer's confirmation, decline or query."],
      review_changed_terms: ["review changed insurer terms", "The insurer confirmed cover on terms that differ from what the client accepted.", "Review each difference, put them to the client, and record the client's decision.", "The client's decision on the changes, and how it arrived."],
      resolve_rejected_changes: ["resolve the rejected changes with the insurer", "The client rejected the insurer's changes. The insurer's cover stands as confirmed.", "Ask the insurer to confirm on the terms requested, or take the client's instruction again.", "The insurer's revised confirmation, or a new client instruction."],
      issue_policy: ["issue policy from confirmed cover", "Cover is confirmed and matches what the client accepted.", "Issue the policy from the insurer's confirmation.", "The insurer's policy schedule, when it arrives."],
    };
    const [headline, why, action, evidence] = copy[reason]!;
    const withInsurer = stage === "submitted";
    const matchItems = (changed: boolean) => [
      { id: "44000000-0000-4000-8000-000000000001", field: "insurer", termType: null, label: "Insurer", acceptedValue: "Placeholder Insurer", confirmedValue: "Placeholder Insurer", classification: "match", material: false },
      { id: "44000000-0000-4000-8000-000000000002", field: "effective_at", termType: null, label: "Cover begins", acceptedValue: "1 Sept 2026", confirmedValue: "1 Sept 2026", classification: "match", material: false },
      { id: "44000000-0000-4000-8000-000000000003", field: "premium", termType: null, label: "Premium", acceptedValue: "KES 5,310,000", confirmedValue: "KES 5,310,000", classification: "match", material: false },
      { id: "44000000-0000-4000-8000-000000000004", field: "term", termType: "limit", label: "Third party property damage", acceptedValue: "KES 20,000,000", confirmedValue: "KES 20,000,000", classification: "match", material: false },
      { id: "44000000-0000-4000-8000-000000000005", field: "term", termType: "excess", label: "Own damage", acceptedValue: changed ? "5% of claim, minimum KES 30,000" : "7.5% of claim, minimum KES 45,000", confirmedValue: "7.5% of claim, minimum KES 45,000", classification: changed ? "changed" : "match", material: changed },
      ...(changed ? [{ id: "44000000-0000-4000-8000-000000000006", field: "term", termType: "exclusion", label: "Riot and strike", acceptedValue: null, confirmedValue: "Excluded", classification: "added_by_insurer", material: true }] : []),
    ];
    const coverMatch = changedTerms
      ? { id: "45000000-0000-4000-8000-00000000000a", comparedAt: "2026-09-09T14:11:00.000Z", comparedByName: null, basisVersion: 1, current: true, staleReason: null, materialDifferences: 2, unclearCount: 0, items: matchItems(true) }
      : stage === "accepted"
        ? { id: "45000000-0000-4000-8000-00000000000b", comparedAt: "2026-09-10T09:01:00.000Z", comparedByName: null, basisVersion: 2, current: true, staleReason: null, materialDifferences: 0, unclearCount: 0, items: matchItems(false) }
        : stage === "active" || stage === "future"
          ? { id: "45000000-0000-4000-8000-00000000000c", comparedAt: "2026-09-09T14:11:00.000Z", comparedByName: null, basisVersion: 1, current: true, staleReason: null, materialDifferences: 0, unclearCount: 0, items: matchItems(false).slice(0, 4) }
          : null;
    const deferred = "Whether premium must be paid before issuance is a brokerage rule that arrives with Money (4D). It is not checked, and not assumed.";
    const ready = stage === "active" || stage === "future" || stage === "accepted";
    // Harness-only: the stub is a plain object adjusted per photographed stage.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reading: Record<string, any> = {
      work: [{
        id: "26000000-0000-4000-8000-00000000000c", reason, headline, why, action, evidence, after: "The next step opens in Work.",
        taskStatus: withInsurer ? "with_party" : "needs_you", taskParty: withInsurer ? "Placeholder Insurer" : null,
        taskSince: withInsurer ? "2026-09-08T11:02:00.000Z" : null, taskNextCheck: null, ownerName: stage === "draft" ? "Parity Harness" : null,
      }],
      coverMatch,
      changeAcceptance: stage === "rejected" ? {
        decision: "reject", decidedAt: "2026-09-10T09:00:00.000Z", source: "email",
        evidence: { kind: "note", id: null, label: "Client's finance director replied at 09:00 rejecting both changes.", path: null },
        recordedByName: "Parity Harness", items: [{ label: "Own damage", decision: "rejected" }, { label: "Riot and strike", decision: "rejected" }],
        followUpDraft: "Draft to Placeholder Insurer — not sent:\n\nDear Underwriter,\n\nOur client Placeholder Company has reviewed your confirmation.\nThey do not accept the change to: Own damage, Riot and strike. Please confirm cover on the terms requested.\n\nKind regards",
      } : null,
      readiness: ready
        ? { state: "ready", reasons: [], deferredChecks: [deferred], workItemId: "26000000-0000-4000-8000-00000000000c" }
        : { state: "blocked", reasons: changedTerms
            ? [{ code: "unaccepted_differences", message: stage === "rejected" ? "The client rejected the insurer's changes." : "The confirmed terms differ from what the client accepted in 2 places, and the client has not accepted them." }]
            : [{ code: "not_confirmed", message: "The insurer has not confirmed cover." }], deferredChecks: [deferred], workItemId: null },
      preparedActions: stage === "prepared" ? [{
        id: "46000000-0000-4000-8000-00000000000a", actionType: "record_client_acceptance", placementId: "40000000-0000-4000-8000-00000000000a", opportunityId: null,
        summary: "Record that the client accepted Placeholder Insurer's changes",
        changes: ["The client's acceptance of: Own damage, Riot and strike.", "A new client instruction, keeping the original.", "What the client accepted becomes version 2, from Placeholder Insurer's confirmation; the cover is checked again."],
        blockers: [], permitted: true, requiresConfirmation: true, state: "prepared",
        preparedAt: "2026-09-10T09:02:00.000Z", expiresAt: "2026-09-11T09:02:00.000Z", preparedByName: "Parity Harness", receipt: null,
      }] : [],
      placement: { id: "40000000-0000-4000-8000-00000000000a", title: "Placeholder Company motor fleet placement — 2027", requestedEffectiveAt: "2026-10-01T00:00:00.000Z", requestedExpiryAt: null, createdAt: "2026-09-07T10:40:00.000Z" },
      client: { id: CLIENT, name: "Placeholder Company" },
      opportunity: { id: "30000000-0000-4000-8000-00000000000a", title: "Placeholder Company motor fleet quotation — 2027", classOfBusiness: "Commercial motor" },
      insurer: { id: "21000000-0000-4000-8000-00000000000a", name: "Placeholder Insurer" },
      workItem: wasSent && answer === null
        ? { id: "26000000-0000-4000-8000-00000000000b", taskStatus: "with_party", taskParty: "Placeholder Insurer", taskSince: "2026-09-08T11:02:00.000Z" }
        : { id: "26000000-0000-4000-8000-00000000000b", taskStatus: "needs_you", taskParty: null, taskSince: null },
      instruction: {
        id: "41000000-0000-4000-8000-00000000000a", source: "telephone",
        evidence: { kind: "note", id: null, label: "Client rang at 10:40 and chose Placeholder Insurer on the terms shown.", path: null },
        clientConditions: null, instructedAt: "2026-09-07T10:40:00.000Z", recordedByName: "Parity Harness",
        recordedAt: "2026-09-07T10:45:00.000Z", comparisonVersion: 1, outsideComparison: false,
        exceptionReason: null, supersededAt: null, supersededReason: null,
      },
      instructionHistory: [],
      basis: {
        version: stage === "accepted" ? 2 : 1, origin: stage === "accepted" ? "client_accepted_changes" : "instruction",
        classOfBusiness: "Commercial motor", subject: null, effectiveAt: "2026-09-01T00:00:00.000Z", expiryAt: null, premiumBasis: null, clientConditions: null,
        premiumAmount: "5310000.00", premiumCurrency: "KES", validUntil: "2027-06-30",
        terms: [
          { termType: "limit", label: "Third party property damage", value: "KES 20,000,000", amount: null, currency: null, unclear: false },
          { termType: "excess", label: "Own damage", value: stage === "accepted" ? "7.5% of claim, minimum KES 45,000" : "5% of claim, minimum KES 30,000", amount: null, currency: null, unclear: false },
        ],
      },
      drift: stage === "drifted"
        ? { stale: true, changes: [{ label: "Premium", was: "KES 5,310,000", now: "KES 5,410,000" }, { label: "Own damage", was: "5% of claim, minimum KES 30,000", now: "5% of claim, minimum KES 50,000" }] }
        : { stale: false, changes: [] },
      request: hasRequest ? {
        id: "42000000-0000-4000-8000-00000000000a", version: 1, subject: "Placement instruction — Placeholder Company",
        body: "Please place cover.", coverRequested: "Commercial motor for Placeholder Company",
        effectiveAt: "2026-10-01T00:00:00.000Z", outstandingConditions: null, sha256: "a".repeat(64),
        preparedByName: "Parity Harness", preparedAt: "2026-09-07T11:00:00.000Z",
        approval: approved ? { approvedByName: "Parity Harness", approvedAt: "2026-09-07T12:00:00.000Z" } : null,
        submission: wasSent ? { method: "recorded_manual_email", recipient: "underwriting@placeholder-insurer.test", sentAt: "2026-09-08T11:02:00.000Z", evidence: { kind: "note", id: null, label: "Sent from my own mailbox at 11:02.", path: null }, recordedByName: "Parity Harness" } : null,
      } : null,
      requestHistory: [],
      insurerResponse: answer === null ? null : {
        id: "43000000-0000-4000-8000-00000000000a", confirmedPremiumAmount: "5310000.00", confirmedPremiumCurrency: "KES",
        confirmedPremiumBasis: null, confirmedSubject: null, confirmedClassOfBusiness: "Commercial motor", terms: [],
        outcome: answer.outcome, receivedAt: "2026-09-09T14:10:00.000Z", effectiveAt: answer.effectiveAt, expiryAt: null,
        insurerReference: "CN-2027-0041",
        changesNote: answer.outcome === "confirmed_with_changes" ? "Own damage excess raised to 7.5%, minimum KES 45,000; riot and strike excluded." : null,
        informationRequired: null, declineReason: null,
        evidence: { kind: "note", id: null, label: "Cover note received by email at 14:10.", path: null }, recordedByName: "Parity Harness",
      },
      cancellation: null,
      cover,
      blockers: stage === "drifted" ? ["The quotation changed after the client accepted it: Premium, Own damage. Nothing can be sent until it is reviewed."]
        : stage === "draft" ? ["The request is waiting for someone permitted to approve it."]
        : stage === "approved" ? ["The approved request has not been sent. Sending from ASAP is not connected; send it yourself and record how."]
        : changedTerms ? ["Placeholder Insurer's confirmed terms differ from what the client accepted: Own damage, Riot and strike. The cover is in force on the insurer's terms; the client has not agreed to them."]
        : stage === "instructed" ? ["No placement request has been prepared yet."] : [],
      nextAction: stage === "active" ? "Prepare policy issuance."
        : stage === "draft" ? "Have the request approved by someone permitted to approve placements."
        : stage === "approved" ? "Send the approved request to the insurer yourself, then record how it was sent."
        : stage === "submitted" ? "Record the insurer's answer when it arrives."
        : stage === "changed" ? "Put the changed terms to the client."
        : stage === "drifted" ? "Review what changed in the quotation, and record the client's instruction again if it matters."
        : stage === "future" ? "Prepare policy issuance." : "Prepare the placement request.",
      permissions: {
        canRecordInstruction: true, canPrepare: true, canApprove: q.get("perms") !== "officer",
        canRecordSubmission: true, canRecordResponse: true, approverRoles: ["Brokerage administrator", "Manager"],
      },
      sending: { available: false, reason: "Sending from ASAP is not connected yet. Copy the approved request into the mailbox it should go from, then record that it was sent." },
    };
    return json(placementStage(asked, reading));
  }
  /*
   * What ASAP read from a quotation, and the review of it. `stage` photographs each state:
   * unreviewed, already decided, not yet linked to an insurer's answer, and unreadable.
   */
  if (u.includes("/quotation")) {
    const q = new URLSearchParams(location.search);
    const stage = q.get("stage") ?? "unreviewed";
    const term = (id: string, ordinal: number, over: Record<string, unknown> = {}) => ({
      id, ordinal, termType: "excess", label: "Own damage excess",
      proposedValue: "5% of claim, minimum KES 30,000", amount: "30000.00", currency: "KES",
      page: 2, region: { x: 50, y: 120, width: 300, height: 12 },
      condition: "known", method: "labelled_line", state: "proposed",
      correctedValue: null, reviewedByName: null, reviewedAt: null, quoteTermId: null, ...over,
    });
    return json({
      document: {
        id: "3a000000-0000-4000-8000-00000000000a",
        filename: "placeholder-quotation.pdf",
        pageCount: 3,
        extractionState: stage === "unreadable" ? "failed" : "extracted",
      },
      needsManualReview: stage === "unreadable"
        ? "This document has no readable text. It is most likely a scan, and ASAP cannot read scanned documents yet — the terms have to be entered by hand."
        : null,
      linkedTo: stage === "unlinked" || stage === "unreadable"
        ? null
        : {
            insurerResponseId: "34000000-0000-4000-8000-00000000000a",
            insurerName: "Placeholder Insurer",
            opportunityId: "30000000-0000-4000-8000-00000000000a",
          },
      fields: stage === "unreadable" ? [] : [
        { fieldKey: "premium", proposedValue: "KES 5,310,000", correctedValue: null, page: 1, condition: "known", state: "proposed" },
        { fieldKey: "currency", proposedValue: "KES", correctedValue: null, page: 1, condition: "known", state: "proposed" },
        { fieldKey: "quote_valid_until", proposedValue: "28/02/2027", correctedValue: null, page: 1, condition: "known", state: "proposed" },
      ],
      proposals: stage === "unreadable" ? [] : [
        term("3c000000-0000-4000-8000-00000000000a", 0,
          stage === "reviewed"
            ? { state: "corrected", correctedValue: "5% of claim, minimum KES 50,000", reviewedByName: "Parity Harness", reviewedAt: "2026-09-07T09:00:00.000Z" }
            : {}),
        term("3c000000-0000-4000-8000-00000000000b", 1, {
          label: "Theft excess", proposedValue: "As per policy wording", condition: "unclear",
          amount: null, currency: null, page: 2,
          ...(stage === "reviewed" ? { state: "rejected", reviewedByName: "Parity Harness", reviewedAt: "2026-09-07T09:00:00.000Z" } : {}),
        }),
        term("3c000000-0000-4000-8000-00000000000c", 2, {
          termType: "exclusion", label: "Political violence",
          proposedValue: "Excluded unless separately arranged", amount: null, currency: null, page: 3,
        }),
      ],
      permissions: { canReview: true },
    });
  }
  /*
   * The comparison. Its own stub, ahead of the opportunity's, because its address is a longer
   * form of the same one. `stage` photographs each state it passes through: nothing to compare,
   * a live comparison, one that has gone out of date, and one already shown to the client.
   */
  if (u.includes("/comparison")) {
    const q = new URLSearchParams(location.search);
    const stage = q.get("stage") ?? "live";
    const INS_A = "21000000-0000-4000-8000-00000000000a";
    const INS_B = "21000000-0000-4000-8000-00000000000b";
    const CMP = "36000000-0000-4000-8000-00000000000f";
    const cell = (insurerId: string, value: string | null, over: Record<string, unknown> = {}) => ({
      insurerId, value, amount: null, currency: null,
      missing: value === null, unclear: false, corrected: false, evidence: null, ...over,
    });
    const stale = stage === "stale";
    return json({
      opportunity: {
        id: "30000000-0000-4000-8000-00000000000a",
        title: "Placeholder Company motor fleet quotation — 2027",
        classOfBusiness: "Commercial motor",
        coverStart: "2027-01-01",
        coverEnd: "2027-12-31",
        closedAt: null,
      },
      client: { id: CLIENT, name: "Placeholder Company" },
      readiness:
        stage === "empty"
          ? {
              ready: false,
              blockers: [
                "Only Placeholder Insurer has quoted. One quote is a quote, not a comparison.",
                "With Second Placeholder Insurer since 2026-09-01 — no answer yet.",
              ],
              approached: 2, quoted: 1, declined: 0,
              awaiting: [{ insurerName: "Second Placeholder Insurer", since: "2026-09-01" }],
              missingInformation: [],
            }
          : { ready: true, blockers: [], approached: 2, quoted: 2, declined: 0, awaiting: [], missingInformation: [] },
      comparison:
        stage === "empty" || stale
          ? null
          : {
              id: CMP,
              generatedAt: "2026-09-06T09:00:00.000Z",
              generatedByName: "Parity Harness",
              presentedAt: stage === "presented" ? "2026-09-07T09:00:00.000Z" : null,
              presentedByName: stage === "presented" ? "Parity Harness" : null,
              stale: false,
              staleReason: null,
              changes: [],
              columns: [
                { insurerId: INS_B, insurerName: "Second Placeholder Insurer", responseId: "34000000-0000-4000-8000-00000000000b", receivedAt: "2026-09-05T00:00:00.000Z", premiumAmount: "5620000.00", premiumCurrency: "KES", validUntil: "2027-06-30", validityNote: null, source: { kind: "note", id: null, label: "Quotation letter.", path: null } },
                { insurerId: INS_A, insurerName: "Placeholder Insurer", responseId: "34000000-0000-4000-8000-00000000000a", receivedAt: "2026-09-05T00:00:00.000Z", premiumAmount: "5310000.00", premiumCurrency: "KES", validUntil: "2027-06-30", validityNote: null, source: { kind: "note", id: null, label: "Terms read out by the underwriter.", path: null } },
              ],
              rows: [
                { termType: "limit", label: "Third party property damage", cells: [cell(INS_B, "KES 20,000,000"), cell(INS_A, "KES 20,000,000")], incomplete: false },
                { termType: "excess", label: "Own damage", cells: [cell(INS_B, "5% of claim, minimum KES 25,000"), cell(INS_A, "5% of claim, minimum KES 30,000", { corrected: true })], incomplete: false },
                { termType: "excess", label: "Theft", cells: [cell(INS_B, null), cell(INS_A, "As per policy wording", { unclear: true })], incomplete: true },
                { termType: "exclusion", label: "Political violence", cells: [cell(INS_B, "Excluded"), cell(INS_A, "Excluded unless separately arranged")], incomplete: false },
              ],
              recommendation: {
                insurerId: null, insurerName: null,
                headline: "These quotes are not yet like for like.",
                reasoning: [
                  "Placeholder Insurer quotes KES 5,310,000, against KES 5,620,000 from Second Placeholder Insurer.",
                  "Before recommending one, get the missing terms stated so the same cover is being priced.",
                ],
                caveats: [
                  "Second Placeholder Insurer did not state Theft.",
                  "Placeholder Insurer: Theft was stated in terms that cannot be compared.",
                ],
              },
            },
      history: stale
        ? [{ id: CMP, generatedAt: "2026-09-06T09:00:00.000Z", generatedByName: "Parity Harness", presentedAt: null, supersededAt: "2026-09-08T09:00:00.000Z", supersededReason: 'Placeholder Insurer changed the term "Own damage" after this comparison was made.' }]
        : [],
      permissions: { canGenerate: true, canPresent: true },
    });
  }
  if (u.includes("/opportunities/")) {
    const q = new URLSearchParams(location.search);
    const stage = q.get("stage") ?? "full";
    const bare = stage === "new";
    const A = "31000000-0000-4000-8000-00000000000a";
    const request = {
      id: "35000000-0000-4000-8000-00000000000a",
      subject: "Quotation request — Placeholder Company",
      body: "We invite terms.",
      preparedAt: "2026-09-02T00:00:00.000Z",
      preparedByName: "Parity Harness",
      approvedAt: stage === "prepared" ? null : "2026-09-03T00:00:00.000Z",
      approvedByName: stage === "prepared" ? null : "Parity Harness",
      sentAt: null,
      sentEmailMessageId: null,
    };
    return json({
      opportunity: {
        id: "30000000-0000-4000-8000-00000000000a",
        title: "Placeholder Company motor fleet quotation — 2027",
        classOfBusiness: "Commercial motor",
        riskSummary: bare ? null : "Five commercial vehicles",
        coverStart: bare ? null : "2027-01-01",
        coverEnd: bare ? null : "2027-12-31",
        ownerName: "Parity Harness",
        createdAt: "2026-09-01T00:00:00.000Z",
        closedAt: null,
        closedOutcome: null,
        closedReason: null,
        source: null,
      },
      client: { id: CLIENT, name: "Placeholder Company" },
      workItem: {
        id: "26000000-0000-4000-8000-00000000000a",
        taskStatus: bare ? "needs_you" : "with_party",
        taskParty: bare ? null : "Placeholder Insurer",
        taskSince: bare ? null : "2026-08-12T00:00:00.000Z",
      },
      requirements: bare
        ? [{ id: "33000000-0000-4000-8000-00000000000a", label: "Vehicle schedule with declared values", required: true, suppliedAt: null, suppliedByName: null, evidence: null }]
        : [
            { id: "33000000-0000-4000-8000-00000000000a", label: "Vehicle schedule with declared values", required: true, suppliedAt: null, suppliedByName: null, evidence: null },
            { id: "33000000-0000-4000-8000-00000000000b", label: "Previous year claims history", required: true, suppliedAt: "2026-09-02T00:00:00.000Z", suppliedByName: "Parity Harness", evidence: { kind: "note", id: null, label: "Handed over at the meeting.", path: null } },
          ],
      insurers: bare
        ? []
        : [
            {
              id: A,
              insurerId: "21000000-0000-4000-8000-00000000000a",
              insurerName: "Placeholder Insurer",
              addedAt: "2026-09-01T00:00:00.000Z",
              removedAt: null,
              removedReason: null,
              request: stage === "asked" ? null : request,
              response:
                stage === "quoted" || stage === "full"
                  ? {
                      id: "34000000-0000-4000-8000-00000000000a",
                      outcome: "quoted",
                      receivedAt: "2026-09-05T00:00:00.000Z",
                      premiumAmount: "5310000.00",
                      premiumCurrency: "KES",
                      validUntil: "2026-10-05",
                      declineReason: null,
                      recordedByName: "Parity Harness",
                      source: { kind: "note", id: null, label: "Terms read out by the underwriter.", path: null },
                      terms: [
                        { id: "36000000-0000-4000-8000-00000000000a", termType: "excess", label: "Own damage excess", extractedValue: "2.5% min 30,000", correctedValue: "2.5% min 35,000", correctedByName: "Parity Harness", correctedAt: "2026-09-06T00:00:00.000Z", amount: null, currency: null, unclear: false, evidence: null },
                        { id: "36000000-0000-4000-8000-00000000000b", termType: "excess", label: "Theft excess", extractedValue: null, correctedValue: null, correctedByName: null, correctedAt: null, amount: null, currency: null, unclear: true, evidence: null },
                      ],
                    }
                  : null,
            },
            {
              id: "31000000-0000-4000-8000-00000000000b",
              insurerId: "21000000-0000-4000-8000-00000000000b",
              insurerName: "Second Placeholder Insurer",
              addedAt: "2026-09-01T00:00:00.000Z",
              removedAt: null,
              removedReason: null,
              request: null,
              response:
                stage === "full"
                  ? { id: "34000000-0000-4000-8000-00000000000b", outcome: "declined", receivedAt: "2026-09-04T00:00:00.000Z", premiumAmount: null, premiumCurrency: null, validUntil: null, declineReason: "Outside their appetite.", recordedByName: "Parity Harness", source: { kind: "note", id: null, label: "By telephone.", path: null }, terms: [] }
                  : null,
            },
          ],
      availableInsurers: [
        { id: "21000000-0000-4000-8000-00000000000a", name: "Placeholder Insurer" },
        { id: "21000000-0000-4000-8000-00000000000b", name: "Second Placeholder Insurer" },
        { id: "21000000-0000-4000-8000-00000000000c", name: "Third Placeholder Insurer" },
      ],
      documents: [],
      permissions: { canEdit: q.get("perms") !== "none", canApprove: q.get("perms") !== "none", canRecordResponse: q.get("perms") !== "none" },
      sending: {
        available: false,
        reason: "Sending from ASAP is not connected yet. An approved request can be copied into the mailbox it should go from.",
      },
    });
  }
  /*
   * One client, assembled. The shape of the client comes from the harness URL so the measuring
   * run can photograph a company with several policies, a person with one, and a client with
   * nothing — without a database and without inventing a brokerage.
   */
  if (u.includes("/space") && u.includes("/clients/")) {
    const q = new URLSearchParams(location.search);
    const shape = q.get("client") ?? "full";
    const bare = shape === "bare";
    const single = shape === "single";
    return json({
      client: {
        id: CLIENT,
        name: bare ? "Placeholder Individual" : single ? "Placeholder Person" : "Placeholder Company",
        kind: bare || single ? "individual" : "corporate",
        fileStatus: bare ? "not_started" : "in_review",
        createdAt: "2026-01-04T00:00:00.000Z",
      },
      contacts: bare
        ? []
        : [
            { id: "c1000000-0000-4000-8000-000000000001", fullName: "Placeholder Contact", roleLabel: "Finance", email: "placeholder@example.invalid", phone: null, isPrimary: true },
            ...(single ? [] : [{ id: "c1000000-0000-4000-8000-000000000002", fullName: "Second Contact", roleLabel: "Operations", email: null, phone: null, isPrimary: false }]),
          ],
      policies: bare
        ? []
        : [
            {
              id: "c2000000-0000-4000-8000-000000000001",
              policyNumber: "PLACEHOLDER-1",
              classOfBusiness: "Motor",
              insurerName: "Placeholder Insurer",
              periods: [
                { id: "c3000000-0000-4000-8000-000000000001", periodStart: "2026-01-01", periodEnd: "2026-12-31", premiumAmount: "214500.00", premiumCurrency: "KES", premiumBasis: "gross", commissionAmount: "32175.00", premiumSource: "document", premiumVerifiedAt: "2026-02-01T00:00:00.000Z", premiumEvidenceDocumentId: "c6000000-0000-4000-8000-000000000001", current: true },
                ...(single ? [] : [{ id: "c3000000-0000-4000-8000-000000000002", periodStart: "2025-01-01", periodEnd: "2025-12-31", premiumAmount: "198000.00", premiumCurrency: "KES", premiumBasis: "gross", commissionAmount: null, premiumSource: "import", premiumVerifiedAt: null, premiumEvidenceDocumentId: null, current: false }]),
              ],
            },
            ...(single
              ? []
              : [{ id: "c2000000-0000-4000-8000-000000000002", policyNumber: "PLACEHOLDER-2", classOfBusiness: "Fire", insurerName: "Placeholder Insurer", periods: [{ id: "c3000000-0000-4000-8000-000000000003", periodStart: "2026-01-01", periodEnd: "2026-12-31", premiumAmount: null, premiumCurrency: null, premiumBasis: null, commissionAmount: null, premiumSource: "manual", premiumVerifiedAt: null, premiumEvidenceDocumentId: null, current: true }] }]),
          ],
      work: bare
        ? []
        : [{ id: "c4000000-0000-4000-8000-000000000001", kind: "renewal", title: "Placeholder renewal", taskStatus: "with_party", taskParty: "Placeholder Insurer", taskSince: "2026-08-12T00:00:00.000Z", ownerName: "Parity Harness", completedAt: null }],
      claims: bare || single
        ? []
        : [{ id: "c5000000-0000-4000-8000-000000000001", workItemId: "c4000000-0000-4000-8000-000000000002", status: "registered", incidentOn: "2026-08-01", incidentSummary: "Placeholder incident", insurerReference: "REF-99", policyId: "c2000000-0000-4000-8000-000000000001" }],
      endorsements: [],
      documents: bare ? [] : [{ id: "c6000000-0000-4000-8000-000000000001", filename: "placeholder.pdf", kind: "policy_schedule", extractionState: "extracted", createdAt: "2026-02-01T00:00:00.000Z" }],
      threads: bare ? [] : [{ id: "c7000000-0000-4000-8000-000000000001", subject: "Placeholder thread", lastMessageAt: "2026-08-12T00:00:00.000Z", messageCount: 3 }],
      fileMissing: bare ? [] : ["KRA PIN certificate"],
      mailboxConnected: !bare,
      permissions: {
        canEditContacts: q.get("perms") !== "none",
        canUploadDocuments: q.get("perms") !== "none",
        canStartWork: q.get("perms") !== "none",
      },
      gaps: [
        { id: "quotation", label: "Start quotation work", reason: "Quotations are not built yet, so there is nothing to open.", gap: "4B-2" },
        { id: "money", label: "Premium and balance", reason: "Premiums are recorded against each period, but invoices and payments have no records yet, so ASAP cannot say what is outstanding.", gap: "4D" },
      ],
    });
  }
  /*
   * First-use onboarding. The step, and whether this deployment has Google credentials, come from
   * the harness URL — so every one of the four steps and the two Gmail answers can be photographed
   * without a live Google client and without pretending one connected.
   */
  if (u.includes("/onboarding")) {
    const q = new URLSearchParams(location.search);
    const step = Number(q.get("step") ?? "1");
    const gmail = q.get("gmail") !== "off";
    const joined = q.get("joined") === "1";
    const done = q.get("done") === "1";
    return json({
      onboarding: {
        step: Number.isInteger(step) && step >= 1 && step <= 4 ? step : 1,
        recordsChoice: q.get("records"),
        mailboxChoice: q.get("mailbox"),
        completedAt: done ? "2026-09-20T10:00:00.000Z" : null,
        company: q.get("company") === "none"
          ? null
          : {
              id: ORG,
              name: ORGANIZATION.name,
              country: ORGANIZATION.country,
              currency: ORGANIZATION.currency,
              timezone: ORGANIZATION.timezone,
              canEdit: !joined,
              createdByYou: !joined,
            },
        progress: {
          documents: Number(q.get("documents") ?? "0"),
          imports: Number(q.get("imports") ?? "0"),
          clients: Number(q.get("clients") ?? "0"),
          mailboxConnected: q.get("connected") === "1",
        },
        gmailConfigured: gmail,
        gmailUnavailableReason: gmail
          ? null
          : "Gmail connection is not configured. Whoever administers this deployment can add the Google credentials.",
      },
    });
  }
  return json({});
}) as typeof fetch;

/**
 * A signed-in session, written where `supabase-js` looks for one.
 *
 * `lib/api.ts` refuses to call anything without a token — which is the point of it — so a harness
 * that did not install one would measure five error states. The token is a placeholder and reaches
 * nothing: every request is answered by the stub above.
 */
function installSession(): void {
  /*
   * The storage key supabase-js reads is derived from the project ref. Without a configured URL
   * there is no ref to derive — which is a measuring machine's situation, not a fault — so the
   * harness falls back to a placeholder rather than throwing and rendering nothing at all.
   */
  let ref = "parity-harness";
  try {
    const configured = import.meta.env["VITE_PUBLIC_SUPABASE_URL"] as string | undefined;
    if (configured) ref = new URL(configured).hostname.split(".")[0] ?? ref;
  } catch {
    /* Not a URL. The placeholder above stands, and every request is answered by the stub anyway. */
  }
  const session = {
    access_token: "parity-harness-token",
    refresh_token: "parity-harness-refresh",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: "90000000-0000-4000-8000-000000000001",
      aud: "authenticated",
      role: "authenticated",
      email: "harness@example.invalid",
      app_metadata: {},
      user_metadata: {},
      created_at: "2026-01-04T00:00:00.000Z",
    },
  };
  try {
    localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session));
  } catch {
    /* Without storage the harness still renders; it renders error states, and says so on screen. */
  }
}

installSession();

/*
 * The application is imported *after* the stub and the session are in place. A static import would
 * be hoisted above both, and the first `/me` would go out before either existed.
 */
await import("./harness-app.js");

/**
 * The 4B-4B stages, as adjustments of a base placement reading: client conditions in each state,
 * an insurer-added end date, a partial answer, a stale prepared action and a receipt. Harness-only.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function placementStage(stage: string, r: any): any {
  const deferred = "Whether premium must be paid before issuance is a brokerage rule that arrives with Money (4D). It is not checked, and not assumed.";
  const condition = (state: string, extra: Record<string, unknown> = {}) => ({
    id: "47000000-0000-4000-8000-00000000000a", position: 0, text: "Subject to a satisfactory motor inspection of every vehicle", state,
    resolvedAt: state === "unresolved" ? null : "2026-09-12T10:00:00.000Z",
    resolvedByName: state === "unresolved" ? null : "Parity Harness",
    reason: state === "satisfied" ? "Inspection completed and passed for all five vehicles." : state === "waived" ? "Client withdrew the tracker requirement for this period." : null,
    evidence: state === "unresolved" ? null : { kind: "note", id: null, label: state === "waived" ? "Client's email of 12 September withdrawing it." : "Assessor's report dated 11 September, filed.", path: null },
    newInstructionId: state === "waived" ? "41000000-0000-4000-8000-00000000000b" : null,
    ...extra,
  });
  const tracker = { id: "47000000-0000-4000-8000-00000000000b", position: 1, text: "Install an approved tracker in every vehicle" };
  const work = (reason: string, headline: string, why: string, action: string, evidence: string) => [{
    id: "26000000-0000-4000-8000-00000000000d", reason, headline, why, action, evidence, after: "Once every condition is resolved, the policy can be issued.",
    taskStatus: "needs_you", taskParty: null, taskSince: null, taskNextCheck: null, ownerName: null,
  }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r0: any = {
    ...r,
    conditions: r.conditions ?? [],
    basis: { ...r.basis, periodMonths: r.basis.periodMonths ?? null, periodDays: r.basis.periodDays ?? null },
    coverMatch: r.coverMatch === null ? null : { ...r.coverMatch, items: r.coverMatch.items.map((i: Record<string, unknown>) => ({ calculation: null, ...i })) },
  };
  switch (stage) {
    case "condition-unresolved":
      return {
        ...r0,
        conditions: [condition("unresolved"), condition("unresolved", tracker)],
        readiness: { state: "blocked", reasons: [{ code: "condition_unresolved", message: "The client's conditions are not resolved: Subject to a satisfactory motor inspection of every vehicle; Install an approved tracker in every vehicle. Each must be confirmed by the insurer, satisfied with evidence, or waived by the client." }], deferredChecks: [deferred], workItemId: null },
        work: work("resolve_client_conditions", "resolve the client's conditions", "Cover matches what the client accepted, but one or more of the client's own conditions is not resolved.", "For each condition: record the insurer's confirmation, evidence that it was satisfied, or the client's waiver.", "The insurer's confirmation, evidence of what satisfied it, or the client's waiver and how it arrived."),
      };
    case "condition-satisfied":
      return { ...r0, conditions: [condition("satisfied"), condition("confirmed_by_insurer", { ...tracker, reason: null })] };
    case "condition-waived":
      return {
        ...r0,
        conditions: [condition("satisfied"), condition("waived", tracker)],
        instructionHistory: [{ ...r0.instruction, id: "41000000-0000-4000-8000-00000000000a", supersededAt: "2026-09-12T10:05:00.000Z", supersededReason: "The client waived a condition: Install an approved tracker in every vehicle" }],
        instruction: { ...r0.instruction, id: "41000000-0000-4000-8000-00000000000b", source: "email", clientConditions: "Subject to a satisfactory motor inspection of every vehicle", evidence: { kind: "note", id: null, label: "Client's email of 12 September withdrawing it.", path: null } },
      };
    case "end-date-added":
      return {
        ...r0,
        coverMatch: {
          ...r0.coverMatch, materialDifferences: 1,
          items: [
            ...r0.coverMatch.items.filter((i: { material: boolean }) => !i.material),
            { id: "44000000-0000-4000-8000-000000000009", field: "expiry_at", termType: null, label: "Cover ends", acceptedValue: null, confirmedValue: "2027-08-31T23:59:59.000Z", classification: "added_by_insurer", material: true, calculation: null },
          ],
        },
        blockers: ["Placeholder Insurer's confirmed terms differ from what the client accepted: Cover ends. The client never accepted an end date; the insurer set one."],
        readiness: { state: "blocked", reasons: [{ code: "unaccepted_differences", message: "The confirmed terms differ from what the client accepted in 1 place, and the client has not accepted them." }], deferredChecks: [deferred], workItemId: null },
      };
    case "partial":
      return {
        ...r0,
        changeAcceptance: {
          decision: "partial", decidedAt: "2026-09-10T09:00:00.000Z", source: "email",
          evidence: { kind: "note", id: null, label: "Client replied at 09:00: the excess is acceptable, the riot exclusion is not.", path: null },
          recordedByName: "Parity Harness",
          items: [{ label: "Own damage", decision: "accepted" }, { label: "Riot and strike", decision: "clarify" }],
          followUpDraft: "Draft to Placeholder Insurer — not sent:\n\nDear Underwriter,\n\nOur client Placeholder Company has reviewed your confirmation.\nThey ask you to clarify: Riot and strike.\n\nKind regards",
        },
        readiness: { state: "blocked", reasons: [{ code: "unaccepted_differences", message: "The client accepted only some of the insurer's changes." }], deferredChecks: [deferred], workItemId: null },
        work: work("clarify_changes", "clarify the terms the client queried", "The client accepted some of the insurer's changes and asked about others.", "Clarify the queried terms with the insurer or the client, then record the client's decision.", "The client's decision on the remaining changes."),
      };
    case "prepared-stale":
      return { ...r0, preparedActions: r0.preparedActions.map((a: Record<string, unknown>) => ({ ...a, state: "stale" })) };
    case "receipt":
      return {
        ...r0,
        preparedActions: [{
          id: "46000000-0000-4000-8000-00000000000c", actionType: "record_client_acceptance", placementId: "40000000-0000-4000-8000-00000000000a", opportunityId: null,
          summary: "Record that the client accepted Placeholder Insurer's changes",
          changes: ["The client's acceptance of: Own damage, Riot and strike.", "A new client instruction, keeping the original.", "What the client accepted becomes version 2, from Placeholder Insurer's confirmation; the cover is checked again."],
          blockers: [], permitted: true, requiresConfirmation: true, state: "executed",
          preparedAt: "2026-09-10T09:02:00.000Z", expiresAt: "2026-09-11T09:02:00.000Z", preparedByName: "Parity Harness",
          receipt: { message: "Record that the client accepted Placeholder Insurer's changes — done.", at: "2026-09-10T09:03:00.000Z", by: "Parity Harness" },
        }],
      };
    default:
      return r0;
  }
}
