import { z } from "zod";
import { GuardRef } from "./actions.js";
import { CoverStatus, MoneyStatus, RunStatus, TaskStatus } from "./status.js";
import { uuidSchema } from "./api/common.js";

/**
 * Work items and runs as the web app reads them (UI Build Spec v1, Part 5.1 and Part 8), in the
 * column shape of migration 0022. Rows are validated on the way in so a bad status can never reach
 * a component. Phase 1 reads only; the engine that writes these is Phase 2.
 */

export const StepActor = z.enum([
  "asap",
  "you",
  "insurer",
  "client",
  "bank",
  "finance",
  "regulator",
]);
export const StepState = z.enum(["done", "now", "blocked", "todo"]);

export const Step = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  actor: StepActor,
  state: StepState,
  guards: z.array(GuardRef).default([]),
  /** Plain-language reason when `state` is `blocked`. */
  reason: z.string().nullable().default(null),
});
export type Step = z.infer<typeof Step>;

/** The fourteen Part 6 workflows. */
export const WorkItemKind = z.enum([
  "new_business",
  "placement",
  "endorsement",
  "tor",
  "certificate",
  "claim",
  "renewal",
  "compliance",
  "money_in",
  "money_out",
  "reconciliation",
  "wht",
  "import",
  "exception",
]);
export type WorkItemKind = z.infer<typeof WorkItemKind>;

const isoDate = z.string().datetime({ offset: true });

export const WorkItemRow = z
  .object({
    id: uuidSchema,
    organization_id: uuidSchema,
    title: z.string().min(1),
    kind: WorkItemKind,
    client_id: uuidSchema.nullable(),
    policy_period_id: uuidSchema.nullable(),
    owner_id: uuidSchema.nullable(),
    task_status: TaskStatus,
    task_party: z.string().nullable(),
    task_since: isoDate.nullable(),
    task_next_check: isoDate.nullable(),
    cover_status: CoverStatus.nullable(),
    money_status: MoneyStatus.nullable(),
    reason: z.string().nullable(),
    steps: z.array(Step),
    created_at: isoDate,
    updated_at: isoDate,
    completed_at: isoDate.nullable(),
    deleted_at: isoDate.nullable(),
  })
  // The 0022 row constraint, repeated here so a fixture cannot construct what the database refuses.
  .refine((r) => r.task_status !== "with_party" || (r.task_party && r.task_since), {
    message: "with_party requires task_party and task_since",
    path: ["task_party"],
  });
export type WorkItemRow = z.infer<typeof WorkItemRow>;

export const RunRow = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  work_item_id: uuidSchema.nullable(),
  title: z.string().min(1),
  status: RunStatus,
  next_step: z.string().nullable(),
  started_by: uuidSchema.nullable(),
  started_at: isoDate,
  ended_at: isoDate.nullable(),
  created_at: isoDate,
  updated_at: isoDate,
});
export type RunRow = z.infer<typeof RunRow>;

/** Work's four views (spec Part 1.3: `/work?view=needs|with|recent|done`). */
export const WorkView = z.enum(["needs", "with", "recent", "done"]);
export type WorkView = z.infer<typeof WorkView>;

export const WORK_VIEW_LABELS: Readonly<Record<WorkView, string>> = {
  needs: "Needs you",
  with: "With others",
  recent: "Recent",
  done: "Done",
};

/** The columns the web app selects. One string so query keys and RLS-scoped reads agree. */
export const WORK_ITEM_COLUMNS =
  "id, organization_id, title, kind, client_id, policy_period_id, owner_id, task_status, task_party, task_since, task_next_check, cover_status, money_status, reason, steps, created_at, updated_at, completed_at, deleted_at";
export const RUN_COLUMNS =
  "id, organization_id, work_item_id, title, status, next_step, started_by, started_at, ended_at, created_at, updated_at";
