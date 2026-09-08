import { z } from "zod";

/**
 * Status as a typed contract — UI Build Spec v1, Part 2.
 *
 * This file is the only place these enums exist. Labels live beside them in one map; a label
 * string never appears anywhere else in the codebase. Each enum is a *layer*; the invariant
 * test proves no label is shared between layers, so a word on screen can only ever mean one
 * thing. (Architecture v3.1 §3A: these are workflow vocabularies, not economic states.)
 */

export const TaskStatus = z.enum(["needs_you", "with_party", "in_progress", "done"]);
export const RunStatus = z.enum(["working", "paused", "finished", "could_not_finish", "stopped"]);
export const CoverStatus = z.enum([
  "draft",
  "requested",
  "submitted",
  "confirmed",
  "active",
  "expired",
  "cancelled",
]);
export const MoneyStatus = z.enum([
  "not_invoiced",
  "unpaid",
  "part_paid",
  "paid",
  "received",
  "reconciled",
  "disputed",
  "due_to_insurer",
  "settled",
]);
export const FileStatus = z.enum([
  "not_started",
  "incomplete",
  "in_review",
  "cleared",
  "refresh_due",
]);
export const StockStatus = z.enum(["allocated", "issued", "voided", "unaccounted"]);

export type TaskStatus = z.infer<typeof TaskStatus>;
export type RunStatus = z.infer<typeof RunStatus>;
export type CoverStatus = z.infer<typeof CoverStatus>;
export type MoneyStatus = z.infer<typeof MoneyStatus>;
export type FileStatus = z.infer<typeof FileStatus>;
export type StockStatus = z.infer<typeof StockStatus>;

export const STATUS_LAYERS = ["task", "run", "cover", "money", "file", "stock"] as const;
export type StatusLayer = (typeof STATUS_LAYERS)[number];

/**
 * The one label map. Plain brokerage language; no word repeats across layers.
 * `with_party` is rendered by <TaskStatus> as "With {party} since {date}" — the label here is
 * the fixed prefix, and the component refuses to render without a party and a since date.
 */
export const TASK_LABELS: Readonly<Record<TaskStatus, string>> = {
  needs_you: "Needs you",
  with_party: "With",
  in_progress: "In progress",
  done: "Done",
};

export const RUN_LABELS: Readonly<Record<RunStatus, string>> = {
  working: "Working",
  paused: "Paused",
  finished: "Finished",
  could_not_finish: "Could not finish",
  stopped: "Stopped",
};

export const COVER_LABELS: Readonly<Record<CoverStatus, string>> = {
  draft: "Draft",
  requested: "Requested",
  submitted: "Submitted",
  confirmed: "Confirmed",
  active: "Active cover",
  expired: "Expired",
  cancelled: "Cancelled",
};

export const MONEY_LABELS: Readonly<Record<MoneyStatus, string>> = {
  not_invoiced: "Not invoiced",
  unpaid: "Unpaid",
  part_paid: "Part paid",
  paid: "Paid",
  received: "Received",
  reconciled: "Reconciled",
  disputed: "Disputed",
  due_to_insurer: "Due to insurer",
  settled: "Settled",
};

export const FILE_LABELS: Readonly<Record<FileStatus, string>> = {
  not_started: "Not started",
  incomplete: "Incomplete",
  in_review: "In review",
  cleared: "Cleared",
  refresh_due: "Refresh due",
};

export const STOCK_LABELS: Readonly<Record<StockStatus, string>> = {
  allocated: "Allocated",
  issued: "Issued",
  voided: "Voided",
  unaccounted: "Unaccounted",
};

export const LABELS_BY_LAYER: Readonly<Record<StatusLayer, Readonly<Record<string, string>>>> = {
  task: TASK_LABELS,
  run: RUN_LABELS,
  cover: COVER_LABELS,
  money: MONEY_LABELS,
  file: FILE_LABELS,
  stock: STOCK_LABELS,
};

/**
 * Words that must never appear in rendered status output. "Completed" is the one exception:
 * it is the task layer's own label for `done` and is banned everywhere else.
 * Components test their rendered text against `bannedStringsFor(layer)`.
 */
export const BANNED_STRINGS = [
  "Waiting",
  "Failed",
  "Success",
  "Space",
  "Job",
  "Completed",
] as const;
export type BannedString = (typeof BANNED_STRINGS)[number];

export function bannedStringsFor(layer: StatusLayer | "any"): readonly BannedString[] {
  return layer === "task" ? BANNED_STRINGS.filter((s) => s !== "Completed") : BANNED_STRINGS;
}

/** True when `text` contains a banned word for the given layer, matched as a whole word. */
export function containsBannedString(text: string, layer: StatusLayer | "any" = "any"): boolean {
  return bannedStringsFor(layer).some((word) => new RegExp(`\\b${word}\\b`).test(text));
}

/** The prototype validated this in a modal; the message is kept so the refusal reads the same. */
export const WITH_PARTY_ERROR = "Name the outside party and the next check date.";

export type TaskState = {
  status: TaskStatus;
  party?: string | null | undefined;
  since?: string | Date | null | undefined;
};

/**
 * The card-headline label for a task. `with_party` is only renderable with the party named; without
 * it the function throws rather than degrading to a bare "Waiting"-like label. Since dates are
 * rendered by the component ("With Jubilee since 3 Sep"); this returns the label the tests match.
 */
export function taskLabel(task: TaskState): string {
  if (task.status !== "with_party") return TASK_LABELS[task.status];
  if (!task.party || !task.since) throw new Error(WITH_PARTY_ERROR);
  return `${TASK_LABELS.with_party} ${task.party}`;
}
