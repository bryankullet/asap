import { z } from "zod";
import { uuidSchema } from "./common.js";

/**
 * `GET /clients/:id/space` — everything that matters about one client, assembled.
 *
 * One read rather than nine, because the Space is about a relationship and a relationship is not
 * nine independent lists. Every field is a row from this brokerage's own tables; nothing here is
 * derived by a model, and anything the brokerage has not recorded is absent rather than guessed.
 *
 * What is deliberately **not** in this shape: a balance, and quotes. Neither has a table yet, and
 * a plausible-looking zero would be worse than the honest gap the Space shows instead.
 */

export const ClientSpaceKind = z.enum(["individual", "corporate"]);

/** A person at the client. `isPrimary` is who the brokerage writes to. */
export const clientSpaceContactSchema = z.object({
  id: uuidSchema,
  fullName: z.string(),
  roleLabel: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isPrimary: z.boolean(),
});
export type ClientSpaceContact = z.infer<typeof clientSpaceContactSchema>;

/**
 * One period of cover. The premium is reported exactly as recorded, with where it came from and
 * whether a document backs it — an imported figure is the old system's claim until a schedule
 * proves it (0039).
 */
export const clientSpacePeriodSchema = z.object({
  id: uuidSchema,
  periodStart: z.string(),
  periodEnd: z.string(),
  premiumAmount: z.string().nullable(),
  premiumCurrency: z.string().nullable(),
  premiumBasis: z.enum(["gross", "total_payable"]).nullable(),
  commissionAmount: z.string().nullable(),
  premiumSource: z.enum(["manual", "import", "document", "seed"]),
  /** Set only when a named document backs the figure. Null means recorded but unverified. */
  premiumVerifiedAt: z.string().nullable(),
  premiumEvidenceDocumentId: uuidSchema.nullable(),
  /** True when today falls inside this period. Computed from the dates, never stored. */
  current: z.boolean(),
});
export type ClientSpacePeriod = z.infer<typeof clientSpacePeriodSchema>;

export const clientSpacePolicySchema = z.object({
  id: uuidSchema,
  policyNumber: z.string().nullable(),
  classOfBusiness: z.string(),
  insurerName: z.string().nullable(),
  periods: z.array(clientSpacePeriodSchema),
});
export type ClientSpacePolicy = z.infer<typeof clientSpacePolicySchema>;

export const clientSpaceWorkSchema = z.object({
  id: uuidSchema,
  kind: z.string(),
  title: z.string(),
  taskStatus: z.enum(["needs_you", "with_party", "in_progress", "done"]),
  taskParty: z.string().nullable(),
  taskSince: z.string().nullable(),
  ownerName: z.string().nullable(),
  completedAt: z.string().nullable(),
});
export type ClientSpaceWork = z.infer<typeof clientSpaceWorkSchema>;

export const clientSpaceClaimSchema = z.object({
  id: uuidSchema,
  workItemId: uuidSchema,
  status: z.enum(["draft", "registered", "closed"]),
  incidentOn: z.string(),
  incidentSummary: z.string(),
  insurerReference: z.string().nullable(),
  policyId: uuidSchema.nullable(),
});
export type ClientSpaceClaim = z.infer<typeof clientSpaceClaimSchema>;

export const clientSpaceEndorsementSchema = z.object({
  id: uuidSchema,
  workItemId: uuidSchema,
  kind: z.string(),
  status: z.string(),
  effectiveOn: z.string().nullable(),
  policyId: uuidSchema.nullable(),
});
export type ClientSpaceEndorsement = z.infer<typeof clientSpaceEndorsementSchema>;

export const clientSpaceDocumentSchema = z.object({
  id: uuidSchema,
  filename: z.string(),
  kind: z.string(),
  extractionState: z.string(),
  createdAt: z.string(),
});
export type ClientSpaceDocument = z.infer<typeof clientSpaceDocumentSchema>;

export const clientSpaceThreadSchema = z.object({
  id: uuidSchema,
  subject: z.string(),
  lastMessageAt: z.string().nullable(),
  messageCount: z.number().int().min(0),
});
export type ClientSpaceThread = z.infer<typeof clientSpaceThreadSchema>;

/**
 * A capability this deployment does not have, named where a person would look for it.
 *
 * Shown as an unavailable action with its reason rather than a button that only changes the
 * screen. `gap` is the increment that will build it, so the absence is a plan rather than a
 * shrug.
 */
export const clientSpaceGapSchema = z.object({
  id: z.string().max(60),
  label: z.string().max(120),
  reason: z.string().max(300),
  gap: z.string().max(40),
});
export type ClientSpaceGap = z.infer<typeof clientSpaceGapSchema>;

export const clientSpaceResponseSchema = z.object({
  client: z.object({
    id: uuidSchema,
    name: z.string(),
    kind: ClientSpaceKind,
    fileStatus: z.string(),
    createdAt: z.string(),
  }),
  contacts: z.array(clientSpaceContactSchema),
  policies: z.array(clientSpacePolicySchema),
  work: z.array(clientSpaceWorkSchema),
  claims: z.array(clientSpaceClaimSchema),
  endorsements: z.array(clientSpaceEndorsementSchema),
  documents: z.array(clientSpaceDocumentSchema),
  threads: z.array(clientSpaceThreadSchema),
  /** What the compliance file still needs. Empty when nothing is outstanding. */
  fileMissing: z.array(z.string()),
  /** True when a mailbox is connected, so "no email" can be told apart from "nothing reads mail". */
  mailboxConnected: z.boolean(),
  /** What a person may do here, resolved from the session's permissions — never from the browser. */
  permissions: z.object({
    canEditContacts: z.boolean(),
    canUploadDocuments: z.boolean(),
    canStartWork: z.boolean(),
  }),
  /** Capabilities that do not exist yet, each named with the increment that builds it. */
  gaps: z.array(clientSpaceGapSchema),
});
export type ClientSpaceResponse = z.infer<typeof clientSpaceResponseSchema>;
