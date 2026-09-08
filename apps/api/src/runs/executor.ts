import { deriveTask, type RunRow, type Step, type WorkItemRow } from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { advance, draftFor } from "../engine/apply.js";

/**
 * Executes a run in-process (UI Build Spec v1 Part 8). Each step appends a persisted event, so
 * `GET /runs/:id/stream` can replay to a late or reconnecting client. The run ends through
 * `run_end`, which writes the run outcome and the work item's steps and task in one transaction:
 * a run that pauses or could not finish leaves the item in needs_you, never only in Activity.
 *
 * Phase 2 runs are deterministic: they read the item and produce drafts and notes. No model.
 */
export type RunPlan = {
  events: string[];
  /** Null when the run finishes; otherwise why it paused and what the person should do. */
  pause: { nextStep: string; blockedReason: string } | null;
  drafts: { stepId: string; to: string; subject: string; body: string }[];
  /** Reason recorded on the step when it finishes with a warning. */
  note: string | null;
};

export type RunFacts = {
  clientFileState: string | null;
  agreedRate: { rate_basis_points: number } | null | undefined;
};

export function planRun(
  item: WorkItemRow,
  stepId: string,
  facts: RunFacts = { clientFileState: null, agreedRate: undefined },
): RunPlan {
  const step = item.steps.find((s) => s.id === stepId);
  if (!step)
    return {
      events: [],
      pause: { nextStep: "Check this item", blockedReason: "The step no longer exists." },
      drafts: [],
      note: null,
    };
  const client = item.title.split(" — ")[0] ?? item.title;
  switch (step.id) {
    case "file_check": {
      const state = facts.clientFileState
        ? facts.clientFileState.replaceAll("_", " ")
        : "not on record";
      return {
        events: [
          `Looking for a client file for ${client}`,
          facts.clientFileState === "cleared"
            ? "Client file is cleared"
            : `Client file is ${state} — noted as a warning here; it blocks at placement approval`,
        ],
        pause: null,
        drafts: [],
        note: `Client file: ${state}. Warns here; blocks at placement approval.`,
      };
    }
    case "prepare": {
      const rate =
        facts.agreedRate === undefined
          ? "No insurer and class on this item to look a rate up for"
          : facts.agreedRate === null
            ? "No agreed rate on file for this class — commission will read as undocumented until one is confirmed"
            : `Agreed rate on file: ${(facts.agreedRate.rate_basis_points / 100).toFixed(2)}% of the commission basis`;
      return {
        events: ["Collecting the chosen quote and the client file state", rate],
        pause: null,
        drafts: [],
        note: null,
      };
    }
    case "documents":
      return {
        events: [
          "Listing the documents received",
          "No policy documents are attached yet — nothing was compared",
        ],
        pause: null,
        drafts: [],
        note: "Document comparison arrives with extraction.",
      };
    case "review": {
      const requestStep = item.steps.find((s) => s.id === "request_terms");
      const insurers = (item.steps.find((s) => s.id === "terms_return")?.party ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const events = ["Reading the expiring policy", "Listing what changed since last year"];
      if (insurers.length === 0) {
        return {
          events,
          pause: {
            nextStep: "Name the insurers to request terms from",
            blockedReason: "No insurers named yet.",
          },
          drafts: [],
          note: null,
        };
      }
      events.push(`Drafting term requests for ${insurers.join(", ")}`);
      return {
        events,
        pause: null,
        drafts: requestStep
          ? insurers.map((to) => ({ stepId: requestStep.id, ...draftFor(item, requestStep, to) }))
          : [],
        note: null,
      };
    }
    case "compare":
      return {
        events: [
          "Collecting the terms received",
          "No premium figures with a declared component yet — nothing was compared",
        ],
        pause: null,
        drafts: [],
        note: "Comparison arrives with money (Phase 3); terms are listed, not compared.",
      };
    default:
      return { events: [`${step.label}`], pause: null, drafts: [], note: null };
  }
}

/** The steps and task after a run ends, as `run_end` will store them. */
export function stepsAfterRun(
  item: WorkItemRow,
  stepId: string,
  plan: RunPlan,
  runId: string,
): { steps: Step[]; status: WorkItemRow["task_status"]; party: string | null } {
  const stamped = item.steps.map((s) => (s.id === stepId ? { ...s, runId } : s));
  const steps = plan.pause
    ? stamped.map((s) =>
        s.id === stepId
          ? { ...s, state: "blocked" as const, reason: plan.pause!.blockedReason }
          : s,
      )
    : advance(
        stamped.map((s) => (s.id === stepId ? { ...s, reason: plan.note } : s)),
        stepId,
      );
  const task = plan.pause ? { status: "needs_you" as const, party: null } : deriveTask(steps);
  return { steps, status: task.status, party: task.party };
}

export type Executor = (
  run: RunRow,
  item: WorkItemRow,
  stepId: string,
  facts?: RunFacts,
) => Promise<void>;

export function createExecutor(deps: {
  logger: Logger;
  delayMs: number;
}): (db: SupabaseClient) => Executor {
  const sleep = (ms: number) =>
    ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  return (db) => async (run, item, stepId, facts) => {
    const plan = planRun(item, stepId, facts);
    try {
      for (const message of plan.events) {
        const { error } = await db.rpc("run_event_append", {
          p_run_id: run.id,
          p_kind: "step",
          p_message: message,
        });
        if (error) throw new Error(error.message);
        await sleep(deps.delayMs);
      }
      for (const d of plan.drafts) {
        const { error } = await db.rpc("draft_create", {
          p_work_item_id: item.id,
          p_step_id: d.stepId,
          p_to: d.to,
          p_subject: d.subject,
          p_body: d.body,
        });
        if (error) throw new Error(error.message);
      }
      const after = stepsAfterRun(item, stepId, plan, run.id);
      const { error } = await db.rpc("run_end", {
        p_run_id: run.id,
        p_status: plan.pause ? "paused" : "finished",
        p_next_step: plan.pause?.nextStep ?? null,
        p_steps: after.steps,
        p_task_status: after.status,
        p_task_party: after.party,
      });
      if (error) throw new Error(error.message);
    } catch (err) {
      deps.logger.error({ err, run_id: run.id }, "run could not finish");
      const failed = item.steps.map((s) =>
        s.id === stepId
          ? {
              ...s,
              runId: run.id,
              state: "blocked" as const,
              reason: "ASAP could not finish this step.",
            }
          : s,
      );
      const { error } = await db.rpc("run_end", {
        p_run_id: run.id,
        p_status: "could_not_finish",
        p_next_step: "Check this item",
        p_steps: failed,
        p_task_status: "needs_you",
        p_task_party: null,
      });
      if (error)
        deps.logger.error({ err: error, run_id: run.id }, "run_end failed after run error");
    }
  };
}
