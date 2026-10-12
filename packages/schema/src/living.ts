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

/** What a block may offer. Opening the governed place is how an action happens; nothing here writes. */
export const livingActionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("open"), label, ref: livingRefSchema, primary: z.boolean().default(false) }),
  z.strictObject({ kind: z.literal("ask"), label, text: line }),
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
};
