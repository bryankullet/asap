import { z } from "zod";
import { WorkItemRow, WorkView, type RunRow } from "../work.js";
import { uuidSchema } from "./common.js";

/**
 * `GET /attention` and `GET /work` — the two capability endpoints behind Today and Work.
 *
 * Both existed only in the browser before: Today's ranking lived in `TodayView.tsx` and decided
 * which third-party checks were due against the *browser's* clock, and Work selected 100 rows and
 * chose among them client-side. Architecture §42 requires every list endpoint to return a ranked,
 * capped default with a summary, and §27 puts the attention pipeline on the server. This is the
 * first half of that: the same two sections a person sees today, ranked and capped by the API,
 * with the reason each item appears, against the server's clock.
 *
 * What this deliberately does **not** do: invent an importance score. §27's weighted score is
 * architecture Phase 4 work with detectors behind it. Ranking here is the section order the
 * click-through document already states, then recency — so Today does not change while it moves.
 */

/** The two sections Today shows, in this order (docs/click-through.md: "Ranking is not a preference"). */
export const AttentionSection = z.enum(["needs_you", "checks_due"]);
export type AttentionSection = z.infer<typeof AttentionSection>;

export const ATTENTION_SECTION_LABELS: Readonly<Record<AttentionSection, string>> = {
  needs_you: "Needs you",
  checks_due: "Checks due",
};

/** A run that ended without doing its job, attached to the item it left needing a person. */
export const attentionRunFailureSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  status: z.enum(["paused", "could_not_finish", "stopped"]),
  /** What ASAP says it could not do. Never a business outcome (ui-contract, Runs and Activity). */
  nextStep: z.string().nullable(),
});
export type AttentionRunFailure = z.infer<typeof attentionRunFailureSchema>;

export const attentionItemSchema = z.object({
  section: AttentionSection,
  /** 1-based, within the section. Stable for the same rows and the same server clock. */
  rank: z.number().int().min(1),
  item: WorkItemRow,
  /** Plain English, from the engine's own `reason`; never composed by a model. */
  reason: z.string(),
  /** The step waiting on a person or a party, so a card can name it without re-deriving. */
  nowStep: z.object({ id: z.string(), label: z.string(), actor: z.string() }).nullable(),
  runFailure: attentionRunFailureSchema.nullable(),
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

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
  cap: z.number().int().min(1),
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
    }),
  ),
  /** Rows the caller can see in this view, and how many came back after the cap. */
  visible: z.number().int().min(0),
  returned: z.number().int().min(0),
  cap: z.number().int().min(1),
});
export type WorkListResponse = z.infer<typeof workListResponseSchema>;

/** Shared by both endpoints and by their tests: the run statuses that need a person. */
export const RUN_NEEDS_PERSON = ["paused", "could_not_finish", "stopped"] as const;

/** Does this run need a person? Kept here so the API and the chip agree on one answer. */
export function runNeedsPerson(run: Pick<RunRow, "status">): boolean {
  return (RUN_NEEDS_PERSON as readonly string[]).includes(run.status);
}
