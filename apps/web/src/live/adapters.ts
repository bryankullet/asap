import {
  WORK_KIND_LABELS,
  type AttentionItem,
  type Automation,
  type AutomationRun,
  type BoardTone,
  type FocusCardView,
  type JobCardView,
  type RunListItem,
  type WorkListResponse,
  type WorkTileView,
  type AutomationCardView,
} from "@asap/schema";

/**
 * Real records, as the approved demo's cards (D-064, D-066).
 *
 * Every field a card shows is resolved here, from rows the API already ranked, grouped and scoped
 * under the caller's session. Nothing is composed by a model and nothing is estimated: a label
 * comes from an enum, a name from the client row, a count from counted rows, and progress from
 * steps. Where there is nothing to say, these return the honest absence — an empty string or null
 * — and the card renders its own empty state rather than a plausible invention.
 *
 * The mirror of this file is `../demo/adapters.ts`, which produces the same shapes from the
 * approved fixtures. That is the whole of the difference between the demonstration and the
 * product: one function.
 */

/**
 * How long something has been as it is, in the demo's wording: minutes, then hours, then days.
 * The server's clock decides `now` — `generatedAt` — not the browser's.
 */
export function elapsedLabel(since: string, now: Date): string {
  const ms = now.getTime() - new Date(since).getTime();
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** "Acme Manufacturing · Commercial Motor" — whichever halves exist. */
function contextLine(
  client: { name: string } | null,
  period: { classOfBusiness: string; policyNumber: string | null } | null,
): string {
  const parts = [client?.name, period?.classOfBusiness ?? period?.policyNumber ?? undefined].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  // No client and no policy is not a failure: an item can be about the brokerage itself.
  return parts.length > 0 ? parts.join(" · ") : "This brokerage";
}

/* ---- Discover ------------------------------------------------------------------------------ */

/**
 * The tone of a focus card, from the item's own signals.
 *
 * The API ranks with deterministic signals and hands over the highest-scoring ones; the *word* in
 * the pill is the strongest signal's own name. A card never invents urgency: if nothing scored,
 * the tone is neutral.
 */
function focusTone(item: AttentionItem): { tone: BoardTone; label: string } {
  const strongest = [...item.signals].sort((a, b) => b.points - a.points)[0];
  const id = strongest?.id ?? "";
  if (item.runFailure) return { tone: "high", label: "Could not finish" };
  if (id === "evidence_conflicting" || id === "exception_open") return { tone: "high", label: "High" };
  if (id === "period_ending" || id === "cover_uncertain") return { tone: "medium", label: "At risk" };
  if (id === "money_unpaid" || id === "check_overdue") return { tone: "medium", label: "Overdue" };
  if (id === "evidence_missing" || id === "evidence_stale" || id === "step_blocked")
    return { tone: "medium", label: "Waiting" };
  if (id === "untouched") return { tone: "medium", label: "Untouched" };
  if (item.item.task_status === "done") return { tone: "resolved", label: "Done" };
  return { tone: "high", label: "High" };
}

/** What a card offers to do, phrased for the kind of work it is. */
function focusAction(kind: AttentionItem["item"]["kind"]): string {
  const label = WORK_KIND_LABELS[kind].toLowerCase();
  return `Review ${label}`;
}

export function focusCardFromAttention(
  entry: AttentionItem,
  now: Date,
  index: number,
): FocusCardView {
  const { tone, label } = focusTone(entry);
  const item = entry.item;
  return {
    id: item.id,
    href: entry.links.work,
    tone,
    toneLabel: label,
    clientLabel: entry.client?.name ?? "This brokerage",
    // Since the task last changed, which is what "how long has this been waiting" means.
    elapsed: elapsedLabel(item.task_since ?? item.updated_at, now),
    headline: item.title,
    // The engine's reason. A card never writes its own explanation.
    detail: entry.reason,
    workType: `${WORK_KIND_LABELS[item.kind]} Work`,
    action: focusAction(item.kind),
    // The demo gives only the first card the urgent border, however many are urgent.
    urgent: index === 0 && tone === "high",
    quiet: tone === "resolved",
  };
}

/* ---- Work ---------------------------------------------------------------------------------- */

/** The badge on a Work tile: what is true of the task, in Work's own vocabulary. */
function workPill(row: WorkListResponse["items"][number]): { pill: string; tone: BoardTone } {
  if (row.runFailure) return { pill: "Could not finish", tone: "high" };
  if (row.item.exception) return { pill: "High", tone: "high" };
  if (row.item.task_status === "done") return { pill: "Completed", tone: "resolved" };
  if (row.item.task_status === "with_party") {
    // Waiting on somebody, and the row knows which somebody.
    return { pill: row.item.task_party ? `Waiting on ${row.item.task_party}` : "Waiting", tone: "medium" };
  }
  if (row.item.task_status === "in_progress") return { pill: "In progress", tone: "neutral" };
  return { pill: "Active", tone: "high" };
}

export function workTileFromRow(row: WorkListResponse["items"][number]): WorkTileView {
  const { pill, tone } = workPill(row);
  return {
    id: row.item.id,
    href: `/r/${row.item.id}`,
    workType: WORK_KIND_LABELS[row.item.kind],
    pill,
    pillTone: tone,
    headline: row.item.title,
    summary: row.reason,
    contextLabel: contextLine(row.client, row.period),
  };
}

/* ---- Jobs ---------------------------------------------------------------------------------- */

const JOB_ICON: Record<JobCardView["pillTone"], { icon: string; tone: JobCardView["iconTone"] }> = {
  running: { icon: "✦", tone: "green" },
  waiting: { icon: "◷", tone: "amber" },
  work: { icon: "✓", tone: "blue" },
  done: { icon: "✓", tone: "green" },
  failed: { icon: "!", tone: "red" },
};

/** What the badge says, from the run's status alone. Never a business outcome. */
function jobPill(row: RunListItem): { label: string; tone: JobCardView["pillTone"] } {
  switch (row.run.status) {
    case "working":
      return { label: "Running", tone: "running" };
    case "paused":
      return { label: "Waiting", tone: "waiting" };
    case "finished":
      return { label: "Completed", tone: "done" };
    case "could_not_finish":
      return { label: "Could not finish", tone: "failed" };
    case "stopped":
      return { label: "Stopped", tone: "work" };
  }
}

export function jobCardFromRow(row: RunListItem, groupTitle: string): JobCardView {
  const { label, tone } = jobPill(row);
  const icon = JOB_ICON[tone];
  return {
    id: row.run.id,
    href: `/jobs/${row.run.id}`,
    group: groupTitle,
    icon: icon.icon,
    iconTone: icon.tone,
    headline: row.run.title,
    contextLine: contextLine(row.client, row.period),
    pillLabel: label,
    pillTone: tone,
    progress: row.progress,
    /*
     * What it last did, or what it is waiting for. Both are the run's own words, recorded as it
     * ran; neither is an outcome claim about the business.
     */
    note: row.waitingFor ?? row.lastEvent ?? "Nothing recorded yet",
    actionLabel: row.work ? (row.needsPerson ? "Open Work" : "Open") : "Open",
  };
}

/* ---- Automations --------------------------------------------------------------------------- */

/** The trigger and the prepared step, in the words the demo prints on the flow line. */
export const TRIGGER_LABELS: Record<Automation["trigger_event"], string> = {
  "quote.received": "Insurer terms arrive",
  "renewal.approaching": "Renewal approaches",
  "document.received": "A document arrives",
  "payment.received": "A payment arrives",
  "cover.confirmed": "Cover is confirmed",
  "claim.registered": "A claim is registered",
  "check.overdue": "A check falls overdue",
  "run.could_not_finish": "A job could not finish",
};

export const VERB_LABELS: Record<string, string> = {
  draft: "Prepare a draft",
  record_send: "Prepare a message to send",
  record_evidence: "Record the evidence",
  request: "Prepare the request",
  compare: "Prepare a comparison",
  reconcile: "Prepare a reconciliation",
};

/** An icon per trigger, so a grid of automations is scannable. Decoration, not meaning. */
const TRIGGER_ICONS: Record<Automation["trigger_event"], string> = {
  "quote.received": "✉",
  "renewal.approaching": "↻",
  "document.received": "↘",
  "payment.received": "≠",
  "cover.confirmed": "✓",
  "claim.registered": "⚑",
  "check.overdue": "◷",
  "run.could_not_finish": "!",
};

export function automationCardFromRow(
  automation: Automation,
  runs: AutomationRun[] | undefined,
): AutomationCardView {
  /*
   * What it has actually done, counted from its own run rows. "Ran 8 times" is a count or it is
   * nothing: with the runs not loaded yet the card says so rather than showing a zero that reads
   * as "this has never fired".
   */
  const activity = !automation.enabled
    ? "Paused · No new runs"
    : runs === undefined
      ? "Checking what it has done"
      : runs.length === 0
        ? "No runs yet"
        : `Ran ${runs.length} ${runs.length === 1 ? "time" : "times"} · ${
            runs.filter((r) => r.outcome === "prepared" || r.outcome === "needs_approval").length
          } prepared something`;

  return {
    id: automation.id,
    href: `/automations/${automation.id}`,
    icon: TRIGGER_ICONS[automation.trigger_event],
    enabled: automation.enabled,
    headline: automation.name,
    summary: automation.description,
    flowFrom: TRIGGER_LABELS[automation.trigger_event],
    flowTo: VERB_LABELS[automation.prepared_verb] ?? "Prepare the next step",
    activity,
  };
}
