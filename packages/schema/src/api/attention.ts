import { z } from "zod";
import { WorkItemRow, WorkView, type RunRow } from "../work.js";
import { uuidSchema } from "./common.js";

/**
 * `GET /attention` (Discover) and `GET /work` — the two capability endpoints behind the two
 * list destinations.
 *
 * Both existed only in the browser before: Discover's ranking lived in `TodayView.tsx` and decided
 * which third-party checks were due against the *browser's* clock, and Work selected 100 rows and
 * chose among them client-side. Architecture §42 requires every list endpoint to return a ranked,
 * capped default with a summary, and §27 puts the attention pipeline on the server.
 *
 * **The model never authors a rank or a business fact.** Every score below is computed from
 * repository rows by `apps/api/src/attention/signals.ts`, and every number that reaches a person
 * is read from a column. A model may one day *explain* a ranked item; it may not produce one.
 */

/** The two sections Discover shows, in this order (docs/click-through.md). */
export const AttentionSection = z.enum(["needs_you", "checks_due"]);
export type AttentionSection = z.infer<typeof AttentionSection>;

export const ATTENTION_SECTION_LABELS: Readonly<Record<AttentionSection, string>> = {
  // D-064: Discover leads with the demo's own question rather than a status word.
  needs_you: "What matters now",
  checks_due: "Checks due",
};

/**
 * How well a fact is known — the six conditions the product must represent.
 *
 * These describe *evidence*, not task, run, cover or money, so they never collide with the four
 * status layers (`packages/schema/src/status.ts`) and never appear in a status slot. They are
 * shown beside a fact, never as a headline.
 *
 *  - `known`      a person or an outside party recorded it, with a reference.
 *  - `inferred`   derived from rows we hold; true only if those rows are right. Always says from what.
 *  - `conflicting` two sources we hold disagree. Never silently resolved.
 *  - `missing`    required and not on file. Never rendered as a confident empty value.
 *  - `stale`      recorded, but older than the freshness this fact needs.
 *  - `waiting`    an outside party owes it, and we have asked.
 */
export const EvidenceCondition = z.enum([
  "known",
  "inferred",
  "conflicting",
  "missing",
  "stale",
  "waiting",
]);
export type EvidenceCondition = z.infer<typeof EvidenceCondition>;

export const EVIDENCE_CONDITION_LABELS: Readonly<Record<EvidenceCondition, string>> = {
  known: "Known",
  inferred: "Inferred",
  conflicting: "Conflicting",
  missing: "Missing",
  stale: "Stale",
  waiting: "Waiting for verification",
};

/** One fact behind a Discover item, with how well it is known and where it came from. */
export const attentionFactSchema = z.object({
  label: z.string().min(1).max(200),
  condition: EvidenceCondition,
  /** The reference a person recorded, or null when the condition is `missing` or `waiting`. */
  reference: z.string().max(500).nullable(),
  recordedBy: z.string().max(200).nullable(),
  recordedAt: z.string().nullable(),
  /** For `inferred`: what it was derived from. For `conflicting`: what disagrees. */
  derivedFrom: z.string().max(300).nullable(),
});
export type AttentionFact = z.infer<typeof attentionFactSchema>;

/**
 * A named, deterministic reason an item scored. Every signal is computed from rows; the `points`
 * are a fixed table in `signals.ts`, not a judgement, so the same rows always rank the same way.
 */
export const AttentionSignalId = z.enum([
  "run_failed", //            a run ended without doing its job and left this needing a person
  "step_blocked", //          the current step is blocked by a named guard
  "check_overdue", //         a third party was asked and the check date has passed
  "cover_uncertain", //       cover was requested and no confirmation is recorded
  "file_blocks_placement", // an incomplete client file is blocking live work
  "period_ending", //         the period of cover ends soon
  "money_unpaid", //          premium is unpaid or part paid
  "evidence_missing", //      the current step needs evidence nobody has recorded
  "evidence_stale", //        the newest evidence is older than this fact needs
  "evidence_conflicting", //  two sources we hold disagree
  "exception_open", //        the item was closed as an exception and still needs resolving
  "untouched", //             nothing has happened on it for a long time
]);
export type AttentionSignalId = z.infer<typeof AttentionSignalId>;

export const attentionSignalSchema = z.object({
  id: AttentionSignalId,
  /** Plain English, naming the row it came from. Never composed by a model. */
  because: z.string().min(1).max(300),
  points: z.number().int(),
});
export type AttentionSignal = z.infer<typeof attentionSignalSchema>;

/** A run that ended without doing its job, attached to the item it left needing a person. */
export const attentionRunFailureSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  status: z.enum(["paused", "could_not_finish", "stopped"]),
  /** What ASAP says it could not do. Never a business outcome (ui-contract, Runs and Activity). */
  nextStep: z.string().nullable(),
});
export type AttentionRunFailure = z.infer<typeof attentionRunFailureSchema>;

/** The client-policy-year this item belongs to, when policy context matters (Architecture §3A). */
export const attentionPeriodSchema = z.object({
  id: uuidSchema,
  classOfBusiness: z.string(),
  insurerName: z.string(),
  policyNumber: z.string().nullable(),
  periodStart: z.string(),
  periodEnd: z.string(),
  /** Days from the server's clock to the period end. Negative once it has passed. */
  daysToEnd: z.number().int().nullable(),
});
export type AttentionPeriod = z.infer<typeof attentionPeriodSchema>;

/** Where a card leads. Every one resolves to a route the app already serves. */
export const attentionLinksSchema = z.object({
  /** The Work item itself. */
  work: z.string(),
  /** The client's file, when the item has a client. */
  client: z.string().nullable(),
  /** The policy, when the item has a period. */
  policy: z.string().nullable(),
  /** A question that opens this item in Ask, in the words a person would type. */
  ask: z.string(),
});
export type AttentionLinks = z.infer<typeof attentionLinksSchema>;

export const attentionItemSchema = z.object({
  section: AttentionSection,
  /** 1-based, within the section. Deterministic for the same rows and the same server clock. */
  rank: z.number().int().min(1),
  /** The sum of the signals' points. Shown to nobody; it exists so ranking is auditable. */
  score: z.number().int(),
  item: WorkItemRow,
  /** Plain English, from the engine's own `reason`; never composed by a model. */
  reason: z.string(),
  /** Why this scored where it did. At least one, and each names the row it came from. */
  signals: z.array(attentionSignalSchema).min(1),
  /** The step waiting on a person or a party, so a card need not re-derive it. */
  nowStep: z.object({ id: z.string(), label: z.string(), actor: z.string() }).nullable(),
  client: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  period: attentionPeriodSchema.nullable(),
  /** What is known, inferred, conflicting, missing, stale or waiting on this item. */
  facts: z.array(attentionFactSchema).max(12),
  runFailure: attentionRunFailureSchema.nullable(),
  links: attentionLinksSchema,
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

/**
 * A part of the answer that could not be computed. Discover renders what it has and says what it
 * could not read, rather than failing whole or pretending the gap is an empty result (§36).
 */
export const attentionDegradationSchema = z.object({
  what: z.string().min(1).max(200),
  because: z.string().min(1).max(300),
});
export type AttentionDegradation = z.infer<typeof attentionDegradationSchema>;

export const attentionResponseSchema = z.object({
  organization: z.object({ id: uuidSchema, name: z.string() }),
  /** The server's clock. A check is due against this, not against the browser's idea of now. */
  generatedAt: z.string(),
  items: z.array(attentionItemSchema),
  /** Per section: how many the caller can see, and how many were returned after the cap. */
  sections: z.array(
    z.object({
      key: AttentionSection,
      label: z.string(),
      /** Rows the caller can see. Rows RLS hides are not counted — a hidden row is never a number. */
      visible: z.number().int().min(0),
      returned: z.number().int().min(0),
    }),
  ),
  /**
   * Runs that could not finish and have no work item of their own, so they would otherwise be
   * reachable nowhere. Never the only route to a decision — the item carries it when there is one.
   */
  orphanRuns: z.array(attentionRunFailureSchema),
  /** Empty when everything was read. Non-empty means a partial success, and the UI says so. */
  degraded: z.array(attentionDegradationSchema),
  cap: z.number().int().min(1),
  /**
   * How much of a book there is at all, counted under the caller's session.
   *
   * "Nothing needs attention" and "you have not put anything in yet" are different facts and a
   * new brokerage deserves the second one: an empty screen that congratulates someone on being up
   * to date, when they have no clients, is a lie of omission.
   */
  book: z.object({
    clients: z.number().int().min(0),
    policies: z.number().int().min(0),
    work: z.number().int().min(0),
  }),
});
export type AttentionResponse = z.infer<typeof attentionResponseSchema>;

/** `GET /work?view=` — Work's four views, ranked and capped by the API rather than the browser. */
export const workListQuerySchema = z.object({
  view: WorkView.catch("needs"),
  limit: z.coerce.number().int().min(1).max(100).catch(50),
});
export type WorkListQuery = z.infer<typeof workListQuerySchema>;

export const workListResponseSchema = z.object({
  organization: z.object({ id: uuidSchema, name: z.string() }),
  view: WorkView,
  label: z.string(),
  generatedAt: z.string(),
  items: z.array(
    z.object({
      rank: z.number().int().min(1),
      item: WorkItemRow,
      /** The engine's own reason, so a card in Work can say why without re-deriving it. */
      reason: z.string(),
      nowStep: z.object({ id: z.string(), label: z.string(), actor: z.string() }).nullable(),
      runFailure: attentionRunFailureSchema.nullable(),
      /**
       * Who and which period of cover this is about. A work item carries ids only, and a card
       * that showed an id would be unreadable — so the server resolves both, under the caller's
       * session, exactly as Discover does. Null means there is none, or the caller may not see it.
       */
      client: z.object({ id: uuidSchema, name: z.string() }).nullable(),
      period: attentionPeriodSchema.nullable(),
    }),
  ),
  /** Rows the caller can see in this view, and how many came back after the cap. */
  visible: z.number().int().min(0),
  returned: z.number().int().min(0),
  cap: z.number().int().min(1),
  /**
   * How many each view would show, counted in the same pass. The tab row needs five numbers and
   * this way it costs one request rather than five — and the numbers cannot disagree with the
   * list under them, because they came from the same read.
   */
  counts: z.record(WorkView, z.number().int().min(0)),
  /** Empty when everything was read. Non-empty means a partial success, and the UI says so. */
  degraded: z.array(attentionDegradationSchema).default([]),
});
export type WorkListResponse = z.infer<typeof workListResponseSchema>;

/** Shared by both endpoints and by their tests: the run statuses that need a person. */
export const RUN_NEEDS_PERSON = ["paused", "could_not_finish", "stopped"] as const;

/** Does this run need a person? Kept here so the API and the chip agree on one answer. */
export function runNeedsPerson(run: Pick<RunRow, "status">): boolean {
  return (RUN_NEEDS_PERSON as readonly string[]).includes(run.status);
}
