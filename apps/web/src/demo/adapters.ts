import type {
  AutomationCardView,
  DemoAutomation,
  DemoJob,
  DemoWork,
  JobCardView,
  WorkTileView,
} from "@asap/schema";

/**
 * The approved fixtures, as the same view models the live adapters produce (D-066).
 *
 * The fixtures were extracted from the demo and already carry its exact wording, so these are
 * almost pass-throughs — which is the point. Both modes render one component, and the component
 * cannot tell which it is showing.
 */

const PILL_TONE: Record<string, WorkTileView["pillTone"]> = {
  High: "high",
  Resolved: "resolved",
  Completed: "resolved",
  Waiting: "medium",
  "For review": "medium",
  Active: "high",
};

export function workTileFromDemo(work: DemoWork): WorkTileView {
  return {
    id: work.id,
    href: `/work/${work.id}`,
    workType: work.workType,
    pill: work.pill,
    pillTone: PILL_TONE[work.pill] ?? "neutral",
    headline: work.headline,
    summary: work.summary,
    contextLabel: work.contextLabel,
  };
}

const JOB_TONE: Record<DemoJob["pillTone"], JobCardView["pillTone"]> = {
  running: "running",
  waiting: "waiting",
  work: "work",
  done: "done",
  failed: "failed",
};

export function jobCardFromDemo(job: DemoJob): JobCardView {
  return {
    id: job.id,
    href: `/jobs/${job.id}`,
    group: job.group,
    icon: job.icon,
    iconTone: job.iconTone,
    headline: job.headline,
    contextLine: job.contextLine,
    pillLabel: job.pillLabel,
    pillTone: JOB_TONE[job.pillTone],
    progress: job.progress,
    note: job.note,
    actionLabel: job.actionLabel,
  };
}

export function automationCardFromDemo(automation: DemoAutomation): AutomationCardView {
  return {
    id: automation.id,
    href: `/automations/${automation.id}`,
    icon: automation.icon,
    enabled: automation.enabled,
    headline: automation.headline,
    summary: automation.summary,
    flowFrom: automation.flowFrom,
    flowTo: automation.flowTo,
    activity: automation.enabled ? automation.activity : "Paused · No new runs",
  };
}
