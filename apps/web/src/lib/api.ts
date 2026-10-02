import {
  clientSpaceResponseSchema,
  comparisonActionResponseSchema,
  placementActionResponseSchema,
  issuanceResponseSchema,
  issuanceActionResponseSchema,
  applyPreviewSchema,
  policySpaceResponseSchema,
  startRenewalResponseSchema,
  supervisionResponseSchema,
  companyRulesResponseSchema,
  creationContextSchema,
  type IssuanceAction,
  type ApplyPreviewRequest,
  placementResponseSchema,
  prepareActionResponseSchema,
  confirmPreparedActionResponseSchema,
  recordInstructionResponseSchema,
  quotationReadingResponseSchema,
  quotationReviewResponseSchema,
  comparisonResponseSchema,
  opportunityActionResponseSchema,
  opportunityListResponseSchema,
  opportunityResponseSchema,
  uuidSchema,
  type CreateOpportunityRequest,
  type ComparisonAction,
  type PlacementAction,
  type PrepareActionRequest,
  type RecordInstructionRequest,
  type QuotationReviewAction,
  type OpportunityAction,
  onboardingResponseSchema,
  type SaveOnboardingRequest,
  acceptInvitationResponseSchema,
  apiErrorSchema,
  actResponseSchema,
  manageWorkResponseSchema,
  agreementResponseSchema,
  agreementsResponseSchema,
  clientFileActionResponseSchema,
  clientFileResponseSchema,
  clientFilesResponseSchema,
  createClientResponseSchema,
  placementCreatedSchema,
  policyResponseSchema,
  createPolicyResponseSchema,
  documentsResponseSchema,
  mailboxesResponseSchema,
  emailThreadsResponseSchema,
  emailThreadResponseSchema,
  emailDraftSchema,
  emailThreadLinksSchema,
  type LinkEmailThreadRequest,
  type SaveEmailDraftRequest,
  connectMailboxResponseSchema,
  documentDetailSchema,
  documentFiledResponseSchema,
  applyPreviewResponseSchema,
  applyResponseSchema,
  applyTargetsResponseSchema,
  retryExtractionResponseSchema,
  uploadResponseSchema,
  reviewFieldResponseSchema,
  type ReviewFieldRequest,
  type ApplyRequest,
  type UploadInput,
  type CreatePolicyInput,
  claimDetailSchema,
  endorsementDetailSchema,
  askResponseSchema,
  askResponseV2Schema,
  conversationListResponseSchema,
  conversationMessagesResponseSchema,
  saveTurnsResponseSchema,
  type SaveTurnsRequest,
  type AskRequest,
  createWorkItemResponseSchema,
  markDraftCopiedResponseSchema,
  runEventsResponseSchema,
  runListResponseSchema,
  type RunListFilter,
  workItemResponseSchema,
  createInvitationResponseSchema,
  createOrganizationResponseSchema,
  invitationPreviewSchema,
  invitationsResponseSchema,
  meResponseSchema,
  membersResponseSchema,
  rolesResponseSchema,
  type ActRequest,
  type ManageWorkRequest,
  type AgreementAction,
  type ClaimAction,
  type ClientFileAction,
  type EndorsementAction,
  type K01View,
  type CreateInvitationRequest,
  type CreateWorkItemInput,
  type CreateOrganizationRequest,
  type UpdateMemberRequest,
  attentionResponseSchema,
  automationsResponseSchema,
  automationRunsResponseSchema,
  automationResponseSchema,
  automationTestResponseSchema,
  workflowListSchema,
  workflowDetailSchema,
  workflowActionResponseSchema,
  type CreateAutomationRequest,
  pinsResponseSchema,
  setPinResponseSchema,
  type SetPinRequest,
  historyResponseSchema,
  runDetailResponseSchema,
  searchResponseSchema,
  importsResponseSchema,
  importPreviewResponseSchema,
  importCommitResponseSchema,
  contactsResponseSchema,
  contactResponseSchema,
  type ImportPreviewRequest,
  type ImportCommitRequest,
  type CreateContactRequest,
  type UpdateContactRequest,
  spacePlanResponseSchema,
  workListResponseSchema,
  type WorkView,
} from "@asap/schema";
import { z } from "zod";
import { env } from "../env.js";
import { supabase } from "./supabase.js";

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
    /**
     * What the server said, when it composed an explanation rather than returning a code alone.
     *
     * Most failures are one of a fixed set and read better in the copy below. A few are composed
     * per request — why *this* file could not be read as a book, and what to do with it instead —
     * and for those the server's own sentence is the useful one.
     */
    readonly serverMessage?: string,
  ) {
    super(code);
    this.name = "ApiRequestError";
  }
}

async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

async function request<S extends z.ZodTypeAny>(
  method: string,
  path: string,
  schema: S | null,
  body?: unknown,
  opts: { auth?: boolean; allow?: number[] } = { auth: true },
): Promise<z.infer<S>> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.auth !== false) {
    const token = await accessToken();
    if (!token) throw new ApiRequestError(401, "not_signed_in");
    headers["Authorization"] = `Bearer ${token}`;
  }
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  /*
   * A rejected fetch is not "something went wrong": the request never reached the service. In a
   * browser this is the same TypeError whether the host is wrong, the service is down, or CORS
   * refused the response, so the message names all three rather than guessing one.
   */
  let res: Response;
  try {
    res = await fetch(new URL(path, env.VITE_PUBLIC_API_BASE_URL), init);
  } catch (cause) {
    throw new ApiRequestError(0, "api_unreachable", {
      method,
      path,
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (!res.ok && !opts.allow?.includes(res.status)) {
    const parsed = apiErrorSchema.safeParse(await res.json().catch(() => ({})));
    throw new ApiRequestError(
      res.status,
      parsed.success ? parsed.data.error : "request_failed",
      parsed.success ? parsed.data.details : undefined,
      parsed.success ? parsed.data.message : undefined,
    );
  }
  if (!schema || res.status === 204) return undefined as z.infer<S>;
  // Every response is validated against the shared contract: a drift fails here, not in a
  // component. A failure here means the service is a different build from this one — which is a
  // deployment fact worth saying, not a generic error.
  const parsed = schema.safeParse(await res.json().catch(() => undefined));
  if (!parsed.success) {
    throw new ApiRequestError(0, "response_unrecognised", { path, issues: parsed.error.issues });
  }
  return parsed.data as z.infer<S>;
}

/** What a caller sends; `preview` has a default. */
type ManageWorkInput = Omit<ManageWorkRequest, "preview"> & { preview?: boolean };

export const api = {
  me: () => request("GET", "/me", meResponseSchema),
  ask: (q: string) => request("GET", `/ask?q=${encodeURIComponent(q)}`, askResponseSchema),
  /**
   * Ask a question. Everything that decides the answer — the tools, the grounding check, the
   * provider — is server-side; the browser sends words and a scope id and receives a state.
   */
  askQuestion: (body: AskRequest) => request("POST", "/ask", askResponseV2Schema, body),
  /** Whether a model is configured on the server (no vendor, no key). */
  askStatus: () => request("GET", "/ask/status", z.object({ modelConfigured: z.boolean() })),
  /** The caller's own Ask conversations, newest first, and one conversation's turns. */
  conversations: () => request("GET", "/conversations", conversationListResponseSchema),
  conversationMessages: (id: string) => request("GET", `/conversations/${id}/messages`, conversationMessagesResponseSchema),
  /** Append turns answered in the app from the records to the caller's server conversation. */
  saveTurns: (body: SaveTurnsRequest) => request("POST", "/conversations/turns", saveTurnsResponseSchema, body),
  /** Today. Ranked, capped and reasoned server-side, against the server's clock (D-058, §27). */
  attention: () => request("GET", "/attention", attentionResponseSchema),
  /** A validated Space plan for one record (D-059). Renewals only, so far. */
  space: (recordId: string, view: string) =>
    request("GET", `/spaces/${recordId}?view=${view}`, spacePlanResponseSchema),
  /**
   * A person's own pins. Not a Work view and not a navigation destination — the marker's list,
   * read where the marker is shown.
   */
  pins: () => request("GET", "/pins", pinsResponseSchema),
  /** The brokerage's standing instructions, and the history of every firing. */
  automations: () => request("GET", "/automations", automationsResponseSchema),
  automationRuns: (id: string) =>
    request("GET", `/automations/${id}/runs`, automationRunsResponseSchema),
  /** A new standing instruction. Created switched off, and never able to send by itself. */
  /** Renewal Autopilot (D-129): the runs, one run in full, and a person's decisions on them. */
  renewalRuns: () => request("GET", "/workflows/renewals", workflowListSchema),
  workflowRun: (id: string) => request("GET", `/workflows/runs/${id}`, workflowDetailSchema),
  startRenewal: (policyPeriodId: string) =>
    request("POST", "/workflows/renewals", workflowActionResponseSchema, { policyPeriodId }, { auth: true, allow: [403, 409] }),
  decideApproval: (id: string, input: { decision: "approve" | "reject"; bundleSha256: string; note?: string }) =>
    request("POST", `/workflow-approvals/${id}/decide`, workflowActionResponseSchema, input, { auth: true, allow: [403, 409, 422] }),
  recordCommunicationDelivery: (id: string, input: { method: string; reference: string; deliveredAt?: string }) =>
    request("POST", `/prepared-communications/${id}/delivery`, workflowActionResponseSchema, input, { auth: true, allow: [403, 409, 422] }),
  resumeWorkflow: (id: string) => request("POST", `/workflows/runs/${id}/resume`, workflowActionResponseSchema, undefined, { auth: true, allow: [403] }),
  /** The brokerage's own rules, each with its source, check date and version (D-131). */
  rules: () => request("GET", "/rules", companyRulesResponseSchema),
  setRule: (input: { key: string; value: unknown; source: string; verifiedAt: string; note?: string }) =>
    request("PUT", "/rules", z.object({ outcome: z.string(), reason: z.string().optional(), rules: companyRulesResponseSchema.optional() }), input, { auth: true, allow: [403, 422] }),
  /** Supervision (D-131): every workflow, grouped and ranked, with Upcoming and the governing rules. */
  supervision: () => request("GET", "/supervision", supervisionResponseSchema),
  pauseWorkflow: (id: string, reason?: string) =>
    request("POST", `/workflows/runs/${id}/pause`, workflowActionResponseSchema, reason ? { reason } : {}, { auth: true, allow: [403, 409] }),
  escalateWorkflow: (id: string, reason: string) =>
    request("POST", `/workflows/runs/${id}/escalate`, workflowActionResponseSchema, { reason }, { auth: true, allow: [403, 409] }),
  followUpNow: (id: string) => request("POST", `/workflows/runs/${id}/follow-up-now`, workflowActionResponseSchema, {}, { auth: true, allow: [403, 409] }),
  moveFollowUp: (id: string, on: string) =>
    request("POST", `/workflows/runs/${id}/follow-up`, workflowActionResponseSchema, { on }, { auth: true, allow: [403, 409, 422] }),
  setChasing: (id: string, stop: boolean, reason?: string) =>
    request("POST", `/workflows/runs/${id}/chasing`, workflowActionResponseSchema, { stop, ...(reason ? { reason } : {}) }, { auth: true, allow: [403, 409] }),
  stopWorkflow: (id: string, reason: string) =>
    request("POST", `/workflows/runs/${id}/stop`, workflowActionResponseSchema, { reason }, { auth: true, allow: [403, 409] }),
  workflowReceipt: (id: string) =>
    request("GET", `/workflows/runs/${id}/receipt`, z.object({ title: z.string(), outcome: z.string(), completedAt: z.string(), receipt: z.record(z.string(), z.unknown()) })),
  /** Test mode: conditions checked against open work; nothing prepared or written but its audit. */
  testAutomation: (id: string) => request("POST", `/automations/${id}/test`, automationTestResponseSchema, {}),
  automationLastTest: (id: string) =>
    request("GET", `/automations/${id}/last-test`, z.object({ lastTest: z.object({ testedAt: z.string(), checked: z.number(), wouldFire: z.number(), problems: z.array(z.string()) }).nullable() })),
  createAutomation: (input: CreateAutomationRequest) =>
    request("POST", "/automations", automationResponseSchema, input),
  setAutomationEnabled: (id: string, enabled: boolean) =>
    request("POST", `/automations/${id}/enabled`, automationResponseSchema, { enabled }),
  setPin: (recordId: string, body: SetPinRequest) =>
    request("PUT", `/work-items/${recordId}/pin`, setPinResponseSchema, body),
  /** Work's four views, ranked and capped by the API rather than by the browser. */
  workList: (view: WorkView, limit = 50) =>
    request("GET", `/work?view=${view}&limit=${limit}`, workListResponseSchema),
  createWorkItem: (input: CreateWorkItemInput) =>
    request("POST", "/work-items", createWorkItemResponseSchema, input, {
      auth: true,
      allow: [404, 409],
    }),
  workItem: (id: string) => request("GET", `/work-items/${id}`, workItemResponseSchema),
  /** The audit history of one record (C05). Read-only, gated on audit:view server-side. */
  imports: () => request("GET", "/imports", importsResponseSchema),
  previewImport: (input: ImportPreviewRequest) =>
    request("POST", "/imports", importPreviewResponseSchema, input),
  commitImport: (id: string, input: ImportCommitRequest) =>
    request("POST", `/imports/${id}/commit`, importCommitResponseSchema, input),
  contacts: (clientId: string) =>
    request("GET", `/clients/${clientId}/contacts`, contactsResponseSchema),
  createContact: (input: CreateContactRequest) =>
    request("POST", "/contacts", contactResponseSchema, input),
  updateContact: (id: string, input: UpdateContactRequest) =>
    request("PATCH", `/contacts/${id}`, contactResponseSchema, input),
  audit: () => request("GET", "/audit", historyResponseSchema),
  search: (q: string) => request("GET", `/search?q=${encodeURIComponent(q)}`, searchResponseSchema),
  history: (id: string) => request("GET", `/work-items/${id}/history`, historyResponseSchema),
  /** Owner, due date, next check (D-122): the one contract Ask and the Work Space both call. */
  manageWork: (id: string, input: ManageWorkInput) =>
    request("POST", `/work-items/${id}/manage`, manageWorkResponseSchema, input, { auth: true, allow: [403, 409, 422] }),
  act: (id: string, input: ActRequest) =>
    request("POST", `/work-items/${id}/actions`, actResponseSchema, input, {
      auth: true,
      allow: [409],
    }),
  markDraftCopied: (id: string) =>
    request("POST", `/drafts/${id}/copied`, markDraftCopiedResponseSchema, {}),
  runEvents: (id: string) => request("GET", `/runs/${id}/events`, runEventsResponseSchema),
  /** One run in full: steps, evidence, what it is waiting for, and the work it belongs to. */
  run: (id: string) => request("GET", `/runs/${id}`, runDetailResponseSchema),
  /**
   * The Jobs board: what ASAP is processing, grouped and counted server-side. One request serves
   * every tab, because the counts come back with the rows.
   */
  runList: (filter: RunListFilter, limit = 50) =>
    request("GET", `/runs?filter=${filter}&limit=${limit}`, runListResponseSchema),
  clientFiles: (view: K01View) =>
    request("GET", `/clients?view=${view}`, clientFilesResponseSchema),
  clientFile: (id: string) => request("GET", `/clients/${id}`, clientFileResponseSchema),
  createClient: (input: { name: string; kind: "individual" | "corporate"; confirmNew?: boolean }) =>
    request("POST", "/clients", createClientResponseSchema, input, { auth: true, allow: [409] }),
  clientFileAct: (id: string, input: ClientFileAction) =>
    request("POST", `/clients/${id}/file`, clientFileActionResponseSchema, input, {
      auth: true,
      allow: [409],
    }),
  agreements: () => request("GET", "/agreements", agreementsResponseSchema),
  /* ---- Documents: what is on file, and what ASAP read from it ----------------------------- */
  /** Everything on file, newest first. Optionally for one client or one piece of work. */
  documents: (filter: { clientId?: string; workItemId?: string } = {}) => {
    const q = new URLSearchParams();
    if (filter.clientId) q.set("clientId", filter.clientId);
    if (filter.workItemId) q.set("workItemId", filter.workItemId);
    const query = q.toString();
    return request("GET", `/documents${query ? `?${query}` : ""}`, documentsResponseSchema);
  },
  /** One document: its pages, what was extracted, and where each value was read from. */
  document: (id: string) => request("GET", `/documents/${id}`, documentDetailSchema),
  /**
   * Ask for somewhere to put a file. The bytes never pass through the API: it answers with a
   * signed URL the browser PUTs to, and the same bytes already on file are not an upload.
   */
  /** Tells the API the bytes arrived: the upload is direct to storage, so it cannot know. */
  documentFiled: (id: string) =>
    request("POST", `/documents/${id}/filed`, documentFiledResponseSchema, {}),
  /** The records this document might be about, each with why ASAP believes it. */
  applyTargets: (id: string) =>
    request("GET", `/documents/${id}/apply-targets`, applyTargetsResponseSchema),
  /** What applying would change, before anything is written. */
  applyPreview: (id: string, targetType: string, targetId: string) =>
    request(
      "GET",
      `/documents/${id}/apply-preview?targetType=${targetType}&targetId=${targetId}`,
      applyPreviewResponseSchema,
    ),
  /** Write the chosen values to the named record. */
  applyToRecord: (id: string, input: ApplyRequest) =>
    request("POST", `/documents/${id}/apply`, applyResponseSchema, input),
  /** Read a failed document again. Answers `retried: false` from any other state. */
  retryExtraction: (id: string) =>
    request("POST", `/documents/${id}/extraction/retry`, retryExtractionResponseSchema, {}),
  uploadDocument: (input: UploadInput) =>
    request("POST", "/documents", uploadResponseSchema, input),
  /** One person's decision about one extracted field. Extraction proposes; a person decides. */
  reviewDocumentField: (documentId: string, fieldId: string, input: ReviewFieldRequest) =>
    request(
      "POST",
      `/documents/${documentId}/fields/${fieldId}/review`,
      reviewFieldResponseSchema,
      input,
    ),

  /* ---- Mailboxes: the email the brokerage already works from -------------------------------- */
  /** What is connected, and what this deployment could connect. Never a token. */
  emailThreads: () => request("GET", "/email/threads", emailThreadsResponseSchema),
  emailThread: (id: string) => request("GET", `/email/threads/${id}`, emailThreadResponseSchema),
  /**
   * Save the reply being written. The server decides what an edit does to an approval — this
   * only carries what a person typed.
   */
  saveEmailDraft: (id: string, input: SaveEmailDraftRequest) =>
    request("PUT", `/email/threads/${id}/draft`, z.object({ draft: emailDraftSchema.nullable() }), input),
  /** Approve the reply exactly as it now reads. */
  approveEmailDraft: (id: string) =>
    request("POST", `/email/threads/${id}/draft/approve`, z.object({ draft: emailDraftSchema.nullable() })),
  /** Say what a conversation is about, or take back a link that was wrong. */
  linkEmailThread: (id: string, input: LinkEmailThreadRequest) =>
    request("PUT", `/email/threads/${id}/links`, z.object({ links: emailThreadLinksSchema }), input),
  mailboxes: () => request("GET", "/mailboxes", mailboxesResponseSchema),
  /** Begin connecting one, or be told plainly that this deployment cannot. */
  connectMailbox: (provider: "gmail" | "microsoft") =>
    request("POST", "/mailboxes/connect", connectMailboxResponseSchema, { provider }),
  /** Ask for a pass over the mailbox now. The reading itself is the worker's; this only asks. */
  syncMailbox: (id: string) =>
    request(
      "POST",
      `/mailboxes/${id}/sync`,
      z.object({ requested: z.boolean(), runId: z.string().nullable() }),
    ),
  /** Disconnect: the row stays as history, the tokens do not. */
  disconnectMailbox: (id: string) => request("DELETE", `/mailboxes/${id}`, null),

  policy: (id: string) => request("GET", `/policies/${id}`, policyResponseSchema),
  /** Record cover the brokerage already places. Asking twice records a period, never a twin. */
  createPolicy: (input: CreatePolicyInput) =>
    // 409 is an answer, not a failure: several clients could be meant, or none matched.
    request("POST", "/policies", createPolicyResponseSchema, input, { auth: true, allow: [409] }),
  claimAct: (id: string, input: ClaimAction) =>
    request(
      "POST",
      `/claims/${id}/actions`,
      z.object({ claim: claimDetailSchema.nullable() }),
      input,
    ),
  endorsementAct: (id: string, input: EndorsementAction) =>
    request(
      "POST",
      `/endorsements/${id}/actions`,
      z.object({ endorsement: endorsementDetailSchema.nullable() }),
      input,
    ),
  agreement: (id: string) => request("GET", `/agreements/${id}`, agreementResponseSchema),
  agreementAct: (input: AgreementAction) => request("POST", "/agreements/actions", null, input),
  createPlacement: (input: { clientId: string; insurerId: string; classOfBusiness: string }) =>
    request("POST", "/placements", placementCreatedSchema, { kind: "placement", ...input }),
  setActiveOrganization: (organization_id: string) =>
    request("POST", "/me/active-organization", null, { organization_id }),
  createOrganization: (input: CreateOrganizationRequest) =>
    request("POST", "/organizations", createOrganizationResponseSchema, input),

  /** Everything this brokerage holds about one client, in one read. */
  clientSpace: (id: string) => request("GET", `/clients/${id}/space`, clientSpaceResponseSchema),

  /* ---- Quotation work ------------------------------------------------------------------------ */
  /** Every opportunity of this brokerage. */
  opportunities: () => request("GET", "/opportunities", opportunityListResponseSchema),
  /** One opportunity, with its requirements, insurers, requests, responses and terms. */
  opportunity: (id: string) => request("GET", `/opportunities/${id}`, opportunityResponseSchema),
  /** Start quotation work. Idempotent on the request key: a double submit is one opportunity. */
  createOpportunity: (input: CreateOpportunityRequest) =>
    request("POST", "/opportunities", z.object({ opportunityId: uuidSchema, workItemId: uuidSchema }), input),
  /** Everything a person does to it, through one contract. */
  opportunityAction: (id: string, input: OpportunityAction) =>
    request("POST", `/opportunities/${id}/actions`, opportunityActionResponseSchema, input),
  /** The quotes beside each other, and whether the comparison still describes them. */
  comparison: (id: string, version?: number) =>
    request(
      "GET",
      `/opportunities/${id}/comparison${version === undefined ? "" : `?version=${version}`}`,
      comparisonResponseSchema,
    ),
  /** One placement: instruction, frozen basis, request, approval, submission, answer, cover. */
  placement: (id: string) => request("GET", `/placements/${id}`, placementResponseSchema),
  placementAction: (id: string, input: PlacementAction) =>
    request("POST", `/placements/${id}/actions`, placementActionResponseSchema, input),
  /** Prepare an action for a person to confirm. Nothing is recorded until they do (4B-4A). */
  preparePlacementAction: (placementId: string, input: PrepareActionRequest) =>
    request("POST", `/placements/${placementId}/prepare`, prepareActionResponseSchema, input),
  /** Policy issuance for one placement (4B-5): request, document, check, and the policy record. */
  issuance: (placementId: string) => request("GET", `/placements/${placementId}/issuance`, issuanceResponseSchema),
  issuanceAction: (placementId: string, input: IssuanceAction) =>
    request("POST", `/placements/${placementId}/issuance/actions`, issuanceActionResponseSchema, input),
  /** What applying would do, generated by the server. Writes nothing but an audit row. */
  issuancePreview: (placementId: string, input: ApplyPreviewRequest) =>
    request("POST", `/placements/${placementId}/issuance/preview`, applyPreviewSchema, input),
  /** One policy and its periods, assembled by the server with cover state and evidence (4C-1). */
  policySpace: (policyId: string, periodId?: string) =>
    request("GET", `/policies/${policyId}/space${periodId ? `?period=${encodeURIComponent(periodId)}` : ""}`, policySpaceResponseSchema),
  /** Start — or open, if one is open — this policy's renewal. Idempotent. */
  startPolicyRenewal: (policyId: string) => request("POST", `/policies/${policyId}/renewal`, startRenewalResponseSchema, {}),
  /** What a creation form may preselect, answered from records this person can see. */
  creationContext: (q: { policy?: string | undefined; period?: string | undefined; client?: string | undefined }) => {
    const params = new URLSearchParams();
    if (q.policy) params.set("policy", q.policy);
    if (q.period) params.set("period", q.period);
    if (q.client) params.set("client", q.client);
    return request("GET", `/creation-context?${params.toString()}`, creationContextSchema);
  },
  confirmPreparedAction: (id: string) =>
    request("POST", `/prepared-actions/${id}/confirm`, confirmPreparedActionResponseSchema, {}),
  discardPreparedAction: (id: string) =>
    request("POST", `/prepared-actions/${id}/discard`, confirmPreparedActionResponseSchema, {}),
  /** The client's instruction. Creates the placement; needs the source and the evidence. */
  recordInstruction: (opportunityId: string, input: RecordInstructionRequest) =>
    request("POST", `/opportunities/${opportunityId}/instruction`, recordInstructionResponseSchema, input),
  /** What ASAP read from a quotation, and what a person has decided about each reading. */
  quotationReading: (documentId: string) =>
    request("GET", `/documents/${documentId}/quotation`, quotationReadingResponseSchema),
  quotationReview: (documentId: string, input: QuotationReviewAction) =>
    request("POST", `/documents/${documentId}/quotation/actions`, quotationReviewResponseSchema, input),
  comparisonAction: (id: string, input: ComparisonAction) =>
    request("POST", `/opportunities/${id}/comparison/actions`, comparisonActionResponseSchema, input),

  /* ---- First-use onboarding ----------------------------------------------------------------- */
  /** Where a person got to, and what is actually set up. Never a claim: counts from real rows. */
  onboarding: () => request("GET", "/onboarding", onboardingResponseSchema),
  /** Move a step, or record a choice. A skip is a choice. */
  saveOnboarding: (input: SaveOnboardingRequest) =>
    request("PUT", "/onboarding", onboardingResponseSchema, input),
  /** Finish. Pressing it twice finishes once. */
  completeOnboarding: () => request("POST", "/onboarding/complete", onboardingResponseSchema),
  roles: () => request("GET", "/organizations/current/roles", rolesResponseSchema),
  members: () => request("GET", "/organizations/current/members", membersResponseSchema),
  updateMember: (membershipId: string, input: UpdateMemberRequest) =>
    request("PATCH", `/organizations/current/members/${membershipId}`, null, input),
  invitations: () =>
    request("GET", "/organizations/current/invitations", invitationsResponseSchema),
  invite: (input: CreateInvitationRequest) =>
    request("POST", "/organizations/current/invitations", createInvitationResponseSchema, input),
  revokeInvitation: (id: string) =>
    request("POST", `/organizations/current/invitations/${id}/revoke`, null, {}),
  invitationPreview: (token: string) =>
    request("GET", `/invitations/${token}`, invitationPreviewSchema, undefined, { auth: false }),
  acceptInvitation: (token: string) =>
    request("POST", `/invitations/${token}/accept`, acceptInvitationResponseSchema, {}),
};

/** Human-readable text for the stable error codes the API returns. */
export function describeApiError(err: unknown): string {
  if (!(err instanceof ApiRequestError)) {
    // Not an answer from the service: the browser itself failed (a file it could not read, a
    // network drop). Say which, rather than a category that hides it.
    const m = err instanceof Error ? err.message : typeof err === "string" ? err : "";
    if (/fetch|network/i.test(m)) return "The request did not reach the ASAP service — check your connection and retry.";
    return m ? `This browser could not complete it: ${m}` : "Something went wrong in this browser. Please try again.";
  }
  if (err.code === "validation_failed") {
    // Name the field the service refused, so the person knows what to correct.
    const issues = err.details as { path?: string; message?: string }[] | undefined;
    const first = Array.isArray(issues) ? issues[0] : undefined;
    if (first?.message) return `Please check ${first.path || "the details"}: ${first.message}.`;
  }
  const messages: Record<string, string> = {
    api_unreachable:
      "We cannot reach the ASAP service. It may be starting up, offline, or configured with the wrong address.",
    response_unrecognised:
      "The ASAP service answered in a shape this version does not recognise. The two are on different builds.",
    schema_behind:
      "The ASAP service is running ahead of its database: a migration has not been applied.",
    profile_missing: "Your sign-in exists but your profile record does not.",
    database_error: "The ASAP service could not read its database.",
    demo_mode_reaches_nothing:
      "This is the demonstration. It shows fictional records only and reaches nothing real.",
    not_a_book:
      "ASAP could not read that file as a book. The message above says why and what to do instead.",
    empty_file: "That file has no columns in it.",
    already_imported: "This exact file has already been imported. Nothing was read a second time.",
    not_signed_in: "Please sign in again.",
    invalid_session: "Your session has expired. Please sign in again.",
    permission_denied: "Your role does not allow this.",
    not_a_member: "You are not a member of that brokerage.",
    no_active_organization: "Choose a brokerage first.",
    already_a_member: "That person is already a member.",
    invitation_expired: "This invitation has expired. Ask your administrator for a new one.",
    invitation_revoked: "This invitation was withdrawn.",
    invitation_not_pending: "This invitation has already been used.",
    invitation_email_mismatch:
      "This invitation was sent to a different email address. Sign in with that address.",
    invitation_email_failed:
      "The invitation was recorded but the email could not be sent. Try again.",
    terms_not_accepted: "You must accept the terms to continue.",
    cannot_change_owner: "The owner's role and status cannot be changed here.",
    cannot_remove_self: "You cannot remove yourself.",
    validation_failed: "Please check the highlighted fields.",
    not_found: "Not found.",
    api_only: "The server is not configured to write work items. Ask your administrator.",
    version_stale: "This changed since you looked at it. Reload.",
    evidence_required: "Say where the evidence is.",
    already_sent: "This was already recorded as sent.",
    run_already_working: "ASAP is already working on this item.",
    client_file_not_cleared: "We cannot instruct cover for a client whose file is not complete.",
    principal_officer_only: "Only the principal officer can override the client-file gate.",
    file_incomplete: "The file is missing documents it needs before it can be cleared.",
    reason_required: "Type a reason.",
    client_must_land_not_started: "A client always lands as Not started.",
    period_not_this_clients: "That policy period belongs to another client.",
    clock_inputs_incomplete:
      "The clock needs the clause, its page, the days, and a verified start event with evidence.",
    already_recorded: "That fact is already recorded.",
    items_undecided: "Record the insurer's decision on every item first.",
    policyholder_instruction_required:
      "Transfer of ownership needs the policyholder's own instruction.",
    effective_date_not_after_current:
      "The effective date must be after the current version's start.",
    no_version_on_effective_date: "No policy version is effective on that date.",
  };
  /*
   * Codes whose message is the whole point: the server worked out something specific about this
   * request and said it in words. A fixed line here would replace the answer with a category.
   */
  const COMPOSED = new Set(["not_a_book"]);
  if (COMPOSED.has(err.code) && err.serverMessage) return err.serverMessage;
  return messages[err.code] ?? err.serverMessage ?? `Request failed (${err.code}).`;
}

/** Opens the run's SSE stream with the session token; EventSource cannot send headers. */
export async function streamRun(
  runId: string,
  onEvent: (event: { kind: string; data: Record<string, unknown> }) => void,
  signal: AbortSignal,
): Promise<void> {
  const token = await accessToken();
  if (!token) throw new ApiRequestError(401, "not_signed_in");
  const res = await fetch(new URL(`/runs/${runId}/stream`, env.VITE_PUBLIC_API_BASE_URL), {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" },
    signal,
  });
  if (!res.ok || !res.body) throw new ApiRequestError(res.status, "stream_failed");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let kind = "message";
      let data = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event:")) kind = line.slice(6).trim();
        else if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) {
        try {
          onEvent({ kind, data: JSON.parse(data) as Record<string, unknown> });
        } catch {
          // A malformed frame is dropped; the persisted events remain the record.
        }
      }
      if (kind === "done") return;
    }
  }
}
