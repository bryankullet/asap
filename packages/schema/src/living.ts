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
  "claim.receive_document",
  "endorsement.decide_item",
  "quotation.confirm_reading",
  "work.hand_over",
  "work.acknowledge_handover",
]);
export type LivingCommand = z.infer<typeof LivingCommand>;
/** What a person fills in before a command runs. Never pre-filled with a value the model chose. */
export const livingCommandInputSchema = z.strictObject({
  name: z.string().regex(/^[a-zA-Z]{1,40}$/),
  label,
  kind: z.enum(["text", "textarea", "date", "datetime", "select"]),
  required: z.boolean(),
  options: z.array(z.strictObject({ value: z.string().max(80), label })).max(40).default([]),
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

/**
 * Exploring a client decision that has not been made (D-160): "if the client chose this insurer".
 * Every figure is read from records; nothing is recorded, nothing is recommended, and the panel
 * says so. The alternatives live in the address, so an exploration can be shared, restored or undone.
 */
export const explorationPanelProps = z.strictObject({
  /** Insurers with an answer on the quotation, each one a choice that can be explored. */
  choices: z.array(z.strictObject({ id: uuidSchema, insurer: label, exploring: z.boolean(), answered: z.boolean() })).max(8),
  alternatives: z
    .array(
      z.strictObject({
        id: uuidSchema,
        insurer: label,
        /** Whether this answer could be chosen at all, and if not, why — from the record. */
        available: z.boolean(),
        unavailableReason: z.string().max(300).nullable(),
        premium: z.string().max(80).nullable(),
        versusExpiring: z.string().max(120).nullable(),
        direction: z.enum(["increase", "decrease", "same", "unknown"]),
        insurerChange: z.boolean(),
        validity: z.strictObject({ until: isoDate.nullable(), note: line, tone }),
        termDifferences: z.array(z.strictObject({ label, current: z.string().max(300).nullable(), alternative: z.string().max(300).nullable(), unclear: z.boolean() })).max(8),
        /** What choosing it would set in motion, in order — the governed steps, not a promise. */
        nextSteps: z.array(line).max(5),
      }),
    )
    .max(3),
  /** Always said: this is not a decision and nothing was recorded. */
  notice: line,
});

/** Any workflow's own steps, in order, as its run records them (D-161). Never a percentage. */
export const workJourneyProps = z.strictObject({
  steps: z.array(z.strictObject({ key: z.string().max(60), label, state: z.enum(["done", "now", "next", "waiting", "stopped", "skipped"]) })).max(16),
  summary: line,
});

/** A list of things, each done or not, with who holds it — documents, decisions, facts (D-161). */
export const workChecklistProps = z.strictObject({
  items: z
    .array(
      z.strictObject({
        key: z.string().max(80),
        label,
        detail: z.string().max(500).nullable(),
        state: z.enum(["done", "outstanding", "rejected", "pending"]),
        party: z.string().max(200).nullable(),
        since: isoDate.nullable(),
      }),
    )
    .max(40),
  /** Said under the list, e.g. "An offer is not acceptance; acceptance is not payment." */
  note: z.string().max(500).nullable(),
});

/* ---------------------------------------------------------------------------------------------- */
/* Ask ASAP inside a workspace (D-165): a request becomes a typed focus; the workspace recomposes. */

export const WorkspaceIntent = z.enum([
  "compare_revisions",
  "compare_quotes",
  "blockers",
  "evidence",
  "obligations",
  "consequences",
  "messages",
  "history",
  "next_steps",
  "explore",
  "reset",
]);
export type WorkspaceIntent = z.infer<typeof WorkspaceIntent>;
/** What to bring forward. `target` is a name from the record itself (an insurer, a term, a document), never a value. */
export const workspaceFocusSchema = z.strictObject({ intent: WorkspaceIntent, target: z.string().max(120).nullable() });
export type WorkspaceFocus = z.infer<typeof workspaceFocusSchema>;
export const workspaceInterpretationSchema = z.strictObject({
  focus: workspaceFocusSchema.nullable(),
  /** Insurers to explore, when the request is "what if the client chose …" (D-160). */
  explore: z.array(uuidSchema).max(3).nullable(),
  understood: z.string().max(300).nullable(),
  unclear: z.string().max(300).nullable(),
  /** Rules read it, or the model through the gateway, schema-checked (§45 rules 8, 11). */
  source: z.enum(["rules", "model", "none"]),
});
export type WorkspaceInterpretation = z.infer<typeof workspaceInterpretationSchema>;
export const workspaceInterpretRequestSchema = z.strictObject({ text: z.string().min(1).max(500) });

/** The answer to a request inside a workspace, from records; the blocks it concerns come forward. */
export const focusPanelProps = z.strictObject({
  /** The person's own words, said back. */
  question: line,
  understood: line,
  items: z.array(z.strictObject({ label, detail: z.string().max(500).nullable(), tone, ref: livingRefSchema.nullable() })).max(12),
  /** Said when the records hold nothing for the request — abstention, never a blank. */
  empty: line.nullable(),
  /** The blocks this answer concerns, brought forward and marked. */
  emphasis: z.array(z.string().max(80)).max(6),
  source: z.enum(["rules", "model"]),
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

/* ---------------------------------------------------------------------------------------------- */
/* The renewal portfolio (D-158): a typed query, refined in plain language, composed from records. */

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const PortfolioGroupBy = z.enum(["insurer", "class", "owner", "client", "month", "status"]);
export const PortfolioPremiumChange = z.enum(["increase", "decrease", "changed", "unknown"]);
export const PortfolioStatus = z.enum(["needs_me", "with_party", "in_progress", "done", "not_started"]);
/** The whole view, as data: what the person asked to see. Never a value — only what to select. */
export const portfolioQuerySchema = z.strictObject({
  subject: z.literal("renewals"),
  window: z.strictObject({ from: day, to: day, label }),
  groupBy: PortfolioGroupBy.nullable().default(null),
  filters: z
    .strictObject({
      insurers: z.array(uuidSchema).max(8).default([]),
      classOfBusiness: z.string().max(100).nullable().default(null),
      premiumChange: PortfolioPremiumChange.nullable().default(null),
      mine: z.boolean().default(false),
      status: PortfolioStatus.nullable().default(null),
    })
    .default({ insurers: [], classOfBusiness: null, premiumChange: null, mine: false, status: null }),
  /** Insurers side by side: the view groups by insurer and keeps only these. */
  compare: z.array(uuidSchema).max(4).default([]),
});
export type PortfolioQuery = z.infer<typeof portfolioQuerySchema>;

/** What the interpreter made of a request: the new query, each refinement in words, and what it did not understand. */
export const portfolioInterpretationSchema = z.strictObject({
  query: portfolioQuerySchema,
  understood: z.array(z.strictObject({ kind: z.enum(["window", "group", "filter", "compare", "reset"]), text: label })).max(12),
  /** Words it could not turn into a refinement. Said, never guessed. */
  unclear: z.string().max(300).nullable(),
  /** When a word names more than one thing (two insurers called "Jubilee …"), the choices. */
  clarify: z.strictObject({ question: line, options: z.array(z.strictObject({ label, text: line })).min(2).max(6) }).nullable(),
});
export type PortfolioInterpretation = z.infer<typeof portfolioInterpretationSchema>;
export const portfolioRequestSchema = z.strictObject({ query: portfolioQuerySchema.nullable().default(null), text: z.string().max(500).nullable().default(null) });

export const queryInterpretationProps = z.strictObject({
  /** The active view in words, each removable. */
  chips: z
    .array(
      z.strictObject({
        kind: z.enum(["window", "group", "filter", "compare"]),
        /** Which part of the query this chip is, so removing it is an exact edit, not a guess. */
        field: z.enum(["window", "groupBy", "compare", "insurers", "classOfBusiness", "premiumChange", "status", "mine"]),
        text: label,
        removable: z.boolean(),
      }),
    )
    .max(12),
  unclear: z.string().max(300).nullable(),
  clarify: z.strictObject({ question: line, options: z.array(z.strictObject({ label, text: line })).max(6) }).nullable(),
  /** How the renewal premium is read, so a change is never a mystery. */
  basis: line,
});

const portfolioRow = z.strictObject({
  periodId: uuidSchema,
  workItemId: uuidSchema.nullable(),
  client: label,
  policy: z.string().max(200),
  insurer: label,
  classOfBusiness: z.string().max(100),
  ends: day,
  owner: z.string().max(200).nullable(),
  status: label,
  statusTone: tone,
  expiring: z.string().max(80).nullable(),
  renewal: z.string().max(80).nullable(),
  renewalBasis: z.enum(["placed", "expiring_insurer_quote", "none"]),
  change: z.string().max(120).nullable(),
  direction: z.enum(["increase", "decrease", "same", "unknown"]),
});
export const portfolioGroupsProps = z.strictObject({
  groups: z
    .array(
      z.strictObject({
        key: z.string().max(200),
        label,
        count: z.number().int().min(0),
        expiringTotals: z.array(z.string().max(80)).max(4),
        renewalTotals: z.array(z.string().max(80)).max(4),
        increases: z.number().int().min(0),
        decreases: z.number().int().min(0),
        unknown: z.number().int().min(0),
        rows: z.array(portfolioRow).max(100),
        more: z.number().int().min(0),
      }),
    )
    .max(40),
  /** How many renewals the view selects (a count, not money). */
  selected: z.number().int().min(0),
  /** True when the view groups insurers side by side. */
  comparing: z.boolean(),
});

/* Insurance-native intelligence (D-166) ------------------------------------------------------- */

const longText = z.string().min(1).max(2000);

/**
 * Email the inbound router filed to this work and nobody has dealt with yet (D-144), with ASAP's
 * reading of it labelled as a reading, and what the workspace proposes doing — through its own
 * governed commands. Filing an email records nothing; only a person's command does.
 */
export const arrivedMailProps = z.strictObject({
  items: z.array(z.strictObject({
    id: uuidSchema,
    from: label,
    subject: line,
    at: isoDate,
    party: z.string().max(200).nullable(),
    /** ASAP's reading of what the email is, in words — never a fact. */
    reading: line.nullable(),
    /** What was read from the email's own words (D-152), when anything was. */
    proposal: z.strictObject({ summary: line, words: line.nullable() }).nullable(),
    /** What the workspace proposes doing with it. */
    proposed: line,
  })).max(8),
  note: line,
});

/** The latest handover of this work between colleagues (D-166): done, open, watch, acknowledged. */
export const handoverNoteProps = z.strictObject({
  /** All null when the work has not been handed over yet. */
  from: label.nullable(),
  to: label.nullable(),
  at: isoDate.nullable(),
  done: longText.nullable(),
  open: longText.nullable(),
  watch: longText.nullable(),
  acknowledgedAt: isoDate.nullable(),
  /** True when the viewer is the person it was handed to. */
  forViewer: z.boolean(),
  /** How many earlier handovers this work has had. */
  earlier: z.number().int().min(0),
});

/** Other open work on the same client or policy, and why it bears on this work (D-166). */
export const relatedWorkProps = z.strictObject({
  items: z.array(z.strictObject({
    title: label,
    kind: label,
    status: line,
    why: line,
    /** potential: it may bear on this work; context: the same client, worth knowing. */
    certainty: z.enum(["potential", "context"]),
    ref: livingRefSchema,
  })).max(8),
});

/**
 * What usually happens, measured from this brokerage's own records (D-166): an estimate with its
 * basis and sample, or a plain statement that there is too little on file to say.
 */
export const responsePatternsProps = z.strictObject({
  items: z.array(z.strictObject({
    party: label,
    measure: line,
    sample: z.number().int().min(0),
    enough: z.boolean(),
  })).max(8),
  basis: line,
});

/**
 * What was decided in this client's last round for the same cover, and on what evidence (D-166):
 * the insurers' answers, declines with their reasons, and the client's recorded instruction.
 */
export const decisionTrailProps = z.strictObject({
  round: line,
  items: z.array(z.strictObject({
    at: isoDate.nullable(),
    text: line,
    by: z.string().max(200).nullable(),
    tone,
    ref: livingRefSchema.nullable(),
  })).max(10),
  note: line,
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
  QueryInterpretation: queryInterpretationProps,
  ExplorationPanel: explorationPanelProps,
  WorkJourney: workJourneyProps,
  FocusPanel: focusPanelProps,
  WorkChecklist: workChecklistProps,
  ArrivedMail: arrivedMailProps,
  HandoverNote: handoverNoteProps,
  RelatedWork: relatedWorkProps,
  ResponsePatterns: responsePatternsProps,
  DecisionTrail: decisionTrailProps,
  PortfolioGroups: portfolioGroupsProps,
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
  purpose: z.enum(["renewal", "portfolio", "claim", "endorsement"]),
  subject: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("work_item"), id: uuidSchema, title: label }),
    /** A portfolio view is identified by its query's hash. */
    z.strictObject({ kind: z.literal("portfolio"), id: z.string().regex(/^[0-9a-f]{16}$/), title: label }),
  ]),
  /** Where a renewal stands; a portfolio has no stage. */
  stage: z.strictObject({ key: RenewalStage, label }).nullable(),
  generatedAt: z.string(),
  /** The whole surface's hash: unchanged means nothing to reconcile. */
  fingerprint: z.string().max(64),
  blocks: z.array(livingBlockSchema).max(28),
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
  FocusPanel: { version: 1, name: "Focus", purpose: "The answer to a request asked inside a workspace, from records, with the blocks it concerns brought forward.", requiresEvidence: false },
  ArrivedMail: { version: 1, name: "Arrived email", purpose: "Email filed to this work and not yet dealt with, ASAP's reading labelled as a reading, and the governed step it proposes.", requiresEvidence: false },
  HandoverNote: { version: 1, name: "Handover", purpose: "Responsibility moving between colleagues: what is done, open and to watch, and whether the receiver has it.", requiresEvidence: false },
  RelatedWork: { version: 1, name: "Related work", purpose: "Other open work on the same client or policy, and why it bears on this work.", requiresEvidence: false },
  DecisionTrail: { version: 1, name: "Decided last time", purpose: "What was decided in the client's last round for the same cover, each decision with its evidence.", requiresEvidence: false },
  ResponsePatterns: { version: 1, name: "What usually happens", purpose: "Response times measured from this brokerage's own records, as an estimate with its basis and sample.", requiresEvidence: false },
  WorkJourney: { version: 1, name: "Work journey", purpose: "Any workflow's own steps in order, done, now, waiting or next, as its run records them.", requiresEvidence: false },
  WorkChecklist: { version: 1, name: "Work checklist", purpose: "Things each done or outstanding, with who holds them: documents, decisions, separately recorded facts.", requiresEvidence: false },
  ExplorationPanel: { version: 1, name: "Exploration", purpose: "A client decision explored before it is made: each alternative's premium, insurer change, validity, term differences and next steps, from records. Nothing is recorded or recommended.", requiresEvidence: false },
  QueryInterpretation: { version: 1, name: "Query interpretation", purpose: "The active view in plain words — window, grouping, filters, comparison — each removable, and what was not understood.", requiresEvidence: false },
  PortfolioGroups: { version: 1, name: "Portfolio groups", purpose: "Renewals selected by the query, grouped, with totals and premium changes computed from records.", requiresEvidence: false },
  ApprovalBundle: { version: 1, name: "Approval bundle", purpose: "Exactly what will leave the brokerage, in full, with the governed approve and return commands.", requiresEvidence: false },
};

/** The portfolio answer: the validated surface and what was made of the request. */
export const portfolioResponseSchema = z.strictObject({ surface: livingSurfaceSchema, interpretation: portfolioInterpretationSchema });
export type PortfolioResponse = z.infer<typeof portfolioResponseSchema>;

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
  /** The start of "since you last looked" for the current visit, kept stable while it lasts. */
  previousSeenAt: z.string().max(40).nullable().default(null),
});
export type SurfacePreferences = z.infer<typeof surfacePreferencesSchema>;
export const surfacePreferencesResponseSchema = z.strictObject({ surfaceKey: surfaceKeySchema, prefs: surfacePreferencesSchema, updatedAt: z.string().nullable() });
export type SurfacePreferencesResponse = z.infer<typeof surfacePreferencesResponseSchema>;

/* ---------------------------------------------------------------------------------------------- */
/* Home: what changed since this person last looked (D-159). From semantic events, never a value. */
export const homeChangeSchema = z.strictObject({
  key: z.string().max(200),
  at: z.string(),
  /** green: progress · gold: something to look at · red: ASAP stopped or a check is overdue */
  tone,
  text: line,
  /** The work it happened to, as titled on its record. */
  subject: z.string().max(200).nullable(),
  actor: z.string().max(200).nullable(),
  /** Repeated events on the same work are one line. */
  count: z.number().int().min(1),
  ref: livingRefSchema.nullable(),
});
export const homeChangesResponseSchema = z.strictObject({ since: z.string(), changes: z.array(homeChangeSchema).max(20), more: z.number().int().min(0) });
export type HomeChangesResponse = z.infer<typeof homeChangesResponseSchema>;
