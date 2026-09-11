import { z } from "zod";
import type { WorkItemKind } from "../work.js";

/**
 * The four boards' view models.
 *
 * The approved demo (D-064) decides what a card looks like; a card must not decide where its
 * content comes from. So each board's component renders one of these shapes, and two adapters
 * produce it: the fixtures, for the public demonstration, and the API, for a real brokerage. Same
 * pixels, different truth, and the difference is one function rather than one component per mode.
 *
 * Two rules these carry:
 *
 *  - **Every value is already resolved.** A view model holds the words that appear on screen —
 *    names, not ids; a label, not an enum. Resolving happens in the adapter, once, where it can be
 *    tested, not inside a card.
 *  - **Nothing here is authored by a model** (§45 rules 9, 10). Every field traces to a database
 *    column, a fixture, or a derivation over them.
 */

/** How prominent a card is. The demo's three tones, and nothing per-screen. */
export const BoardTone = z.enum(["high", "medium", "resolved", "neutral"]);
export type BoardTone = z.infer<typeof BoardTone>;

/** Discover's focus card. */
export const focusCardViewSchema = z.object({
  id: z.string(),
  /** Where the card leads. Always a route the app serves. */
  href: z.string(),
  tone: BoardTone,
  /** The word in the pill: High, At risk, Overdue, Accepted. */
  toneLabel: z.string(),
  /** Who it is about, in the client's own name. Never an id. */
  clientLabel: z.string(),
  /** How long it has been like this, in words: "12 min ago", "34 days". */
  elapsed: z.string(),
  headline: z.string(),
  detail: z.string(),
  /** "Servicing Work", "Renewal Work" — the kind of work, in the demo's wording. */
  workType: z.string(),
  /** What the card offers to do: "Review servicing". */
  action: z.string(),
  /** The first card carries the urgent left border; a settled one is quiet. */
  urgent: z.boolean(),
  quiet: z.boolean(),
});
export type FocusCardView = z.infer<typeof focusCardViewSchema>;

/** Work's tile. */
export const workTileViewSchema = z.object({
  id: z.string(),
  href: z.string(),
  /** "SERVICING / TOR" — the kind, upper-cased by the stylesheet, not here. */
  workType: z.string(),
  /** The badge: Active, Waiting, For review, High, Completed. */
  pill: z.string(),
  pillTone: BoardTone,
  headline: z.string(),
  /** One line on why it is where it is. The engine's reason, never composed here. */
  summary: z.string(),
  /** "Acme Manufacturing · Commercial Motor Fleet". */
  contextLabel: z.string(),
});
export type WorkTileView = z.infer<typeof workTileViewSchema>;

/** The Jobs board's card. */
export const jobCardViewSchema = z.object({
  id: z.string(),
  href: z.string(),
  /** The group heading it sits under: Running, Waiting externally, Work, Completed. */
  group: z.string(),
  icon: z.string(),
  iconTone: z.enum(["green", "amber", "blue", "red"]),
  headline: z.string(),
  contextLine: z.string(),
  pillLabel: z.string(),
  pillTone: z.enum(["running", "waiting", "work", "done", "failed"]),
  /** Derived from steps, never authored. Null means there is nothing to derive it from. */
  progress: z.number().int().min(0).max(100).nullable(),
  note: z.string(),
  actionLabel: z.string(),
});
export type JobCardView = z.infer<typeof jobCardViewSchema>;

/** An automation's card. */
export const automationCardViewSchema = z.object({
  id: z.string(),
  href: z.string(),
  icon: z.string(),
  enabled: z.boolean(),
  headline: z.string(),
  summary: z.string(),
  flowFrom: z.string(),
  flowTo: z.string(),
  /** What it has done lately, or that it is paused. Counted, never estimated. */
  activity: z.string(),
});
export type AutomationCardView = z.infer<typeof automationCardViewSchema>;

/**
 * The kind of work, in the words the approved demo prints above a card.
 *
 * The enum is a database value; this is the label. They are separate on purpose: renaming what a
 * person reads must never require a migration.
 */
export const WORK_KIND_LABELS: Readonly<Record<z.infer<typeof WorkItemKind>, string>> = {
  new_business: "New business",
  placement: "Placement",
  endorsement: "Servicing",
  tor: "Servicing / TOR",
  certificate: "Certificate",
  claim: "Claim",
  renewal: "Renewal",
  compliance: "Compliance",
  money_in: "Money",
  money_out: "Money",
  reconciliation: "Reconciliation",
  wht: "Withholding tax",
  import: "Import",
  exception: "Exception",
};
