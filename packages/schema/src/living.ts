import { z } from "zod";
import { uuidSchema } from "./api/common.js";

/**
 * The Living Interface's surface contract (D-156).
 *
 * A Living Surface is a validated, declarative description of a working environment, composed on
 * the server from records the viewer may read:
 *
 *   authorized records → context → progress / obligation / change / consequence intelligence
 *     → surface spec → server validation against `component_definitions` and these schemas
 *     → permission filtering → the browser renders registered React components
 *
 * The same rules as the Space plan (D-059, §45 rules 9, 10, 12) hold, and are why this shape is
 * strict: a block names a registered component at a version; every value in its props was read from
 * a record by id; no model writes a value, a status or an approval; and the only things a block can
 * do are open the governed place where a guarded action lives, or ask a question. A surface never
 * writes business state itself.
 */

const line = z.string().min(1).max(500);
const label = z.string().min(1).max(200);
const isoDate = z.string().max(40);

/** A Space or record the browser can open — the same reference the shell's addresses carry. */
export const livingRefSchema = z
  .record(z.string().max(60), z.union([z.string().max(200), z.array(z.string().max(200)).max(10)]))
  .refine((r) => typeof r["ws"] === "string", "A reference names its workspace.");
export type LivingRef = z.infer<typeof livingRefSchema>;

/**
 * A governed command a block may offer (D-157): one of a closed set, each executed by the existing
 * endpoint that already owns it — the workflow approval, the run controls, the placement and the
 * issuance actions — under that endpoint's own permission checks, frozen payloads and audit. The
 * surface names the command and its target; the browser maps the name to the endpoint from a fixed
 * table. Nothing here can name an endpoint, widen a payload or skip a confirmation.
 */
export const LivingCommand = z.enum([
  "workflow_approval.decide",
  "run.follow_up_now",
  "run.move_follow_up",
  "run.pause",
  "run.resume",
  "run.escalate",
  "quotation.record_delivery",
  "quotation.record_response",
  "placement.approve_request",
  "placement.record_submission",
  "issuance.approve_request",
  "issuance.record_submission",
]);
export type LivingCommand = z.infer<typeof LivingCommand>;
/** What a person fills in before a command runs. Never pre-filled with a value the model chose. */
export const livingCommandInputSchema = z.strictObject({
  name: z.string().regex(/^[a-zA-Z]{1,40}$/),
  label,
  kind: z.enum(["text", "textarea", "date", "datetime", "select"]),
  required: z.boolean(),
  options: z.array(z.strictObject({ value: z.string().max(80), label })).max(12).default([]),
  hint: z.string().max(300).nullable().default(null),
});
export type LivingCommandInput = z.infer<typeof livingCommandInputSchema>;
const commandScalar = z.union([z.string().max(300), z.boolean(), z.null()]);

/** What a block may offer: open a governed place, ask a question, or run a governed command. */
export const livingActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("open"), label, ref: livingRefSchema, primary: z.boolean().default(false) }),
  z.strictObject({ kind: z.literal("ask"), label, text: line }),
  z.strictObject({
    kind: z.literal("command"),
    label,
    command: LivingCommand,
    /** The record the endpoint acts on: an approval, a run or a placement. */
    target: uuidSchema,
    /** Fixed fields the server already knows (a frozen bundle's hash, a request id). */
    payload: z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,39}$/), commandScalar).default({}),
    inputs: z.array(livingCommandInputSchema).max(6).default([]),
    /** Said before it runs, when the command is consequential. */
    confirm: z.strictObject({ title: label, body: line }).nullable().default(null),
    tone: z.enum(["primary", "default", "danger"]).default("default"),
  }),
]);
export type LivingAction = z.infer<typeof livingActionSchema>;

/** Where a displayed fact came from; a document opens to it. */
export const livingEvidenceSchema = z.strictObject({
  label,
  reference: line,
  documentId: uuidSchema.nullable(),
  recordedAt: z.string().nullable(),
});
export type LivingEvidence = z.infer<typeof livingEvidenceSchema>;

export const RenewalStage = z.enum(["attention", "preparing", "awaiting_terms", "comparing", "deciding", "placing", "issuing", "verified", "stopped"]);
export type RenewalStage = z.infer<typeof RenewalStage>;
export const RENEWAL_STAGES: { key: RenewalStage; label: string }[] = [
  { key: "attention", label: "Needs attention" },
  { key: "preparing", label: "Preparing" },
  { key: "awaiting_terms", label: "Insurer terms" },
  { key: "comparing", label: "Comparing" },
  { key: "deciding", label: "Client decision" },
  { key: "placing", label: "Placement" },
  { key: "issuing", label: "Issuance" },
  { key: "verified", label: "Verified" },
];

const tone = z.enum(["green", "gold", "red", "grey"]);

/* ---------------------------------------------------------------------------------------------- */
/* Block props — one strict schema per registered component. */

export const contextHeaderProps = z.strictObject({
  eyebrow: label,
  title: label,
  client: z.strictObject({ id: uuidSchema, name: label }).nullable(),
  facts: z.array(z.strictObject({ label, value: line })).max(6),
  status: z.strictObject({ label, tone }),
  owner: z.string().max(200).nullable(),
});

export const renewalJourneyProps = z.strictObject({
  stages: z.array(z.strictObject({ key: RenewalStage, label, state: z.enum(["done", "now", "next"]) })).max(9),
  /** The current stage in a sentence, from the records. */
  summary: line,
});

export const progressOpportunityProps = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: label,
        title: line,
        /** Why it matters, from the server's own reading. */
        why: line,
        responsible: z.string().max(200).nullable(),
        deadline: isoDate.nullable(),
        actionableNow: z.boolean(),
        requiresApproval: z.boolean(),
        blockedBy: z.array(line).max(6),
        tone,
      }),
    )
    .max(6),
});

export const obligationTrackerProps = z.strictObject({
  items: z
    .array(
      z.strictObject({
        party: label,
        what: line,
        since: isoDate.nullable(),
        due: isoDate.nullable(),
        /** "outside" for an insurer or the client; "brokerage" for a colleague; "asap" for a run. */
        kind: z.enum(["outside", "brokerage", "asap"]),
      }),
    )
    .max(10),
});

export const changeComparisonProps = z.strictObject({
  items: z
    .array(
      z.strictObject({
        subject: label,
        field: label,
        earlier: z.string().max(200).nullable(),
        revised: z.string().max(200).nullable(),
        revision: z.number().int().min(1),
        receivedAt: z.string().nullable(),
        affects: z.array(line).max(4),
      }),
    )
    .max(10),
});

export const consequencePanelProps = z.strictObject({
  items: z
    .array(
      z.strictObject({
        /** Confirmed from records; potential, inferred from a relationship; or unknown, because a fact is missing. */
        certainty: z.enum(["confirmed", "potential", "missing"]),
        text: line,
      }),
    )
    .max(8),
});

export const coverageEffectiveStateProps = z.strictObject({
  expiring: z.strictObject({ periodStart: isoDate, periodEnd: isoDate, insurerName: label, policyNumber: z.string().max(100).nullable() }).nullable(),
  /** The renewed cover as the server's cover reading states it — never inferred here. */
  renewed: z.strictObject({ state: z.string().max(60).nullable(), line }).nullable(),
  daysToExpiry: z.number().int().nullable(),
  statement: line,
});

export const quoteComparisonProps = z.strictObject({
  insurers: z
    .array(
      z.strictObject({
        name: label,
        stage: label,
        premium: z.string().max(80).nullable(),
        validUntil: isoDate.nullable(),
        revision: z.number().int().min(1).nullable(),
        terms: z.array(z.strictObject({ label, value: z.string().max(300).nullable(), unclear: z.boolean() })).max(20),
        declineReason: z.string().max(500).nullable(),
      }),
    )
    .max(8),
  /** Named facts, never a winner: ASAP does not choose for the client. */
  note: line.nullable(),
});

export const placementProgressProps = z.strictObject({
  insurerName: label,
  steps: z.array(z.strictObject({ label, state: z.enum(["done", "now", "next", "blocked"]), note: z.string().max(300).nullable() })).max(10),
  coverLine: line,
  blockers: z.array(line).max(6),
});

export const evidenceInspectorProps = z.strictObject({
  items: z.array(livingEvidenceSchema).max(20),
});

/** Exactly what will leave the brokerage, shown in full before anyone approves it (frozen payload). */
export const approvalBundleProps = z.strictObject({
  title: label,
  /** Whose approval it is and why it is needed, from the record. */
  why: line,
  items: z
    .array(z.strictObject({ heading: label, to: z.string().max(300).nullable(), subject: z.string().max(300), body: z.string().max(20000) }))
    .min(1)
    .max(10),
  /** When the viewer may not approve: who can. */
  approverNote: z.string().max(300).nullable(),
});

export const timelineProps = z.strictObject({
  events: z.array(z.strictObject({ at: z.string(), text: line, actor: z.string().max(200).nullable() })).max(15),
});

/** Every Living block's schema, by component id. The registry rows hold their JSON Schema. */
export const LIVING_BLOCK_PROPS = {
  ContextHeader: contextHeaderProps,
  RenewalJourney: renewalJourneyProps,
  ProgressOpportunity: progressOpportunityProps,
  ObligationTracker: obligationTrackerProps,
  ChangeComparison: changeComparisonProps,
  ConsequencePanel: consequencePanelProps,
  CoverageEffectiveState: coverageEffectiveStateProps,
  QuoteComparison: quoteComparisonProps,
  PlacementProgress: placementProgressProps,
  EvidenceInspector: evidenceInspectorProps,
  Timeline: timelineProps,
  ApprovalBundle: approvalBundleProps,
} as const;
export type LivingComponent = keyof typeof LIVING_BLOCK_PROPS;
export const LivingComponentId = z.enum(Object.keys(LIVING_BLOCK_PROPS) as [LivingComponent, ...LivingComponent[]]);

export const livingBlockSchema = z.strictObject({
  /** Stable across updates, so a re-composed surface reconciles in place instead of remounting. */
  id: z.string().min(1).max(80),
  component: LivingComponentId,
  version: z.number().int().min(1),
  /** Where it sits: the lead, the working column, or alongside it. */
  role: z.enum(["lead", "main", "side"]),
  title: z.string().max(120).nullable(),
  props: z.record(z.string(), z.unknown()),
  evidence: z.array(livingEvidenceSchema).max(10).default([]),
  actions: z.array(livingActionSchema).max(4).default([]),
  /** A short hash of the block's content: the browser marks a block "updated" when it changes. */
  hash: z.string().max(64),
});
export type LivingBlock = z.infer<typeof livingBlockSchema>;

export const livingSurfaceSchema = z.strictObject({
  version: z.literal(1),
  surfaceId: z.string().max(120),
  purpose: z.enum(["renewal"]),
  subject: z.strictObject({ kind: z.literal("work_item"), id: uuidSchema, title: label }),
  stage: z.strictObject({ key: RenewalStage, label }),
  generatedAt: z.string(),
  /** The whole surface's hash: unchanged means nothing to reconcile. */
  fingerprint: z.string().max(64),
  blocks: z.array(livingBlockSchema).max(14),
  /** Composition needs no model: an unavailable model only switches off what needs one. */
  ai: z.strictObject({ available: z.boolean() }),
  /**
   * Sources that could not be read for this viewer (D-157). The surface says so instead of
   * presenting the gap as missing insurance information.
   */
  unavailable: z.array(z.strictObject({ part: label, reason: z.enum(["restricted", "failed"]) })).max(12).default([]),
});
export type LivingSurface = z.infer<typeof livingSurfaceSchema>;

/** The JSON Schema for one Living block, as `component_definitions.props_schema` holds it. */
export function livingPropsJsonSchema(component: LivingComponent): unknown {
  return z.toJSONSchema(LIVING_BLOCK_PROPS[component], { target: "draft-2020-12" });
}

/** The registry rows for the Living blocks: name, purpose, whether a fact must cite a source. */
export const LIVING_REGISTRY: Record<LivingComponent, { version: number; name: string; purpose: string; requiresEvidence: boolean }> = {
  ContextHeader: { version: 1, name: "Context header", purpose: "What the workspace is about: the record, its client, its status and who holds it.", requiresEvidence: false },
  RenewalJourney: { version: 1, name: "Renewal journey", purpose: "Where the renewal stands, stage by stage, derived from the records.", requiresEvidence: false },
  ProgressOpportunity: { version: 1, name: "Progress opportunities", purpose: "What could move the work forward now, why, who holds it and what blocks it.", requiresEvidence: false },
  ObligationTracker: { version: 1, name: "Obligations", purpose: "Who holds the next step, since when, and by when.", requiresEvidence: false },
  ChangeComparison: { version: 1, name: "Change comparison", purpose: "An earlier value beside a revised one, and what the revision affects.", requiresEvidence: true },
  ConsequencePanel: { version: 1, name: "Consequences", purpose: "What a change or a gap means, marked confirmed, potential or unknown.", requiresEvidence: false },
  CoverageEffectiveState: { version: 1, name: "Cover state", purpose: "The expiring period and the renewed cover exactly as the server's cover reading states it.", requiresEvidence: false },
  QuoteComparison: { version: 1, name: "Quote comparison", purpose: "Insurer answers side by side as named facts, never ranked by ASAP.", requiresEvidence: true },
  PlacementProgress: { version: 1, name: "Placement progress", purpose: "Instruction, request, insurer confirmation and issuance, each from its record.", requiresEvidence: false },
  EvidenceInspector: { version: 1, name: "Evidence", purpose: "The documents and references behind the facts on the surface, each openable.", requiresEvidence: false },
  Timeline: { version: 1, name: "Recent changes", purpose: "What changed recently on this work, in order, with who did it.", requiresEvidence: false },
  ApprovalBundle: { version: 1, name: "Approval bundle", purpose: "Exactly what will leave the brokerage, in full, with the governed approve and return commands.", requiresEvidence: false },
};

/* ---------------------------------------------------------------------------------------------- */
/* Personal arrangement of a surface (0080, D-157): interface state only, strict so it cannot become
   a side channel for business data. Scoped by the server to (brokerage, person, surface). */

export const surfaceKeySchema = z.string().regex(/^[a-z_]{1,40}(:[A-Za-z0-9_.:-]{1,200})?$/);
const blockId = z.string().min(1).max(80);
export const surfacePreferencesSchema = z.strictObject({
  pinned: z.array(blockId).max(30).default([]),
  collapsed: z.array(blockId).max(30).default([]),
  /** What the person had chosen inside blocks, by block id — e.g. the insurer column in focus. */
  selection: z.record(blockId, z.string().max(200)).default({}),
  /** When this person last looked at the surface, so Home can say what changed since. */
  lastSeenAt: z.string().max(40).nullable().default(null),
});
export type SurfacePreferences = z.infer<typeof surfacePreferencesSchema>;
export const surfacePreferencesResponseSchema = z.strictObject({ surfaceKey: surfaceKeySchema, prefs: surfacePreferencesSchema, updatedAt: z.string().nullable() });
export type SurfacePreferencesResponse = z.infer<typeof surfacePreferencesResponseSchema>;
