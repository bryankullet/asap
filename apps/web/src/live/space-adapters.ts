import {
  WORK_KIND_LABELS,
  WORK_PRIORITY_LABELS,
  WORK_VIEW_LABELS,
  type AttentionResponse,
  type SpaceFact,
  type SpaceFilter,
  type SpaceFrame,
  type SpaceFrameAction,
  type SpaceFrameBlock,
  type SpaceRef,
  type SpaceRow,
  type SpaceTone,
  type WorkItemRow,
  type WorkView,
  type WorkListResponse,
  type WorkPriority,
} from "@asap/schema";
import { formatSince } from "../components/status/slots.js";

/**
 * Real API responses, as Spaces.
 *
 * This is the whole of Today and Work: two functions, no layouts. Every value below is read from
 * a field the server computed — a rank, a reason, a party name, a priority band — and nothing is
 * composed, estimated or inferred here. Where a value is absent these produce the honest absence
 * and the block renders its own state rather than a plausible invention.
 *
 * Two vocabulary rules are enforced in code rather than in review (D-075, `vocabulary.test.ts`):
 * "Needs you" is never written, and "Waiting" never appears alone. A row held by an outside party
 * names the party and the date — *With CIC since 12 Aug* — and a `with_party` row that arrives
 * without both is a defect upstream, so it is shown as the brokerage's own work rather than
 * silently labelled with a word that means nothing.
 */

/** The badge tone a priority band earns. Semantic and fixed; never re-mapped per screen. */
const PRIORITY_TONE: Readonly<Record<WorkPriority, SpaceTone>> = {
  high: "attention",
  medium: "waiting",
  low: "neutral",
};

/**
 * Who is holding this item, in the words the product uses.
 *
 * The four task statuses are the only vocabulary: *Your work*, *With <party> since <date>*,
 * *In progress*, *Done*. There is no fifth, and there is no bare "Waiting".
 */
export function holderLabel(item: WorkItemRow): string {
  if (item.task_status === "done") return "Done";
  if (item.task_status === "in_progress") return "In progress";
  if (item.task_status === "with_party") {
    // A party and a date, or nothing: "Waiting" on its own tells a person nothing they can act on.
    if (item.task_party && item.task_since) {
      return `With ${item.task_party} since ${formatSince(item.task_since)}`;
    }
    return "Your work";
  }
  return "Your work";
}

/** The Space a work item opens as. The same four parts a workspace tab is keyed by. */
export function refForWorkItem(item: WorkItemRow, links: { work: string }): SpaceRef {
  return {
    spaceKind: spaceKindForKind(item.kind),
    recordType: "work_item",
    recordId: item.id,
    workflowId: null,
    path: links.work,
    title: item.title,
    label: WORK_KIND_LABELS[item.kind].toUpperCase(),
  };
}

/**
 * Which kind of Space a work item becomes.
 *
 * A renewal opens as a renewal and a claim as a claim, because the Space type is part of the
 * identity: the same client seen as a client and as the subject of a renewal is two pieces of
 * work, and one tab cannot be both. Kinds with no Space of their own yet open as the record.
 */
function spaceKindForKind(kind: WorkItemRow["kind"]): SpaceRef["spaceKind"] {
  switch (kind) {
    case "renewal":
      return "renewal";
    case "claim":
      return "claim";
    case "placement":
    case "new_business":
    case "tor":
      return "placement";
    case "endorsement":
    case "certificate":
      return "policy";
    case "money_in":
    case "money_out":
    case "reconciliation":
    case "wht":
      return "reconciliation";
    case "import":
    case "exception":
    case "compliance":
      return "servicing";
  }
}

/** The supporting line under a row title: who, what, who is holding it, and when it is next looked at. */
function noteFor(row: {
  item: WorkItemRow;
  client: { name: string } | null;
  owner: { name: string } | null;
}): string {
  const parts = [
    row.client?.name ?? "This brokerage",
    WORK_KIND_LABELS[row.item.kind],
    holderLabel(row.item),
  ];
  if (row.owner) parts.push(row.owner.name);
  else if (row.item.task_status !== "done") parts.push("unassigned");
  if (row.item.task_next_check) parts.push(`next check ${formatSince(row.item.task_next_check)}`);
  return parts.join(" · ");
}

/** The facts behind a row, as evidence a person can check. */
function evidenceFor(
  facts: { label: string; reference: string | null; recordedBy: string | null }[],
) {
  return facts
    .filter(
      (f): f is { label: string; reference: string; recordedBy: string | null } =>
        f.reference !== null,
    )
    .slice(0, 4)
    .map((f) => ({
      label: f.label,
      reference: f.reference,
      recordedBy: f.recordedBy,
      recordedAt: null,
    }));
}

/**
 * Today — "What matters now".
 *
 * One prioritised list of human work, an observation from ASAP, and the quick actions the
 * prototype offers. Deliberately not a dashboard: a row earns its place by needing a person, and
 * cover and money appear on a row only when they are the reason it is there.
 */
export function todaySpace(
  response: AttentionResponse | undefined,
  state: { loading: boolean; error: boolean },
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "today",
    recordType: "organization",
    recordId: null,
    workflowId: null,
    path: "/today",
    title: "Today",
    label: "TODAY",
  };
  const base = {
    self,
    title: "What matters now",
    context: null,
    filters: [] as SpaceFilter[],
    related: [] as SpaceRef[],
    actions: [] as SpaceFrameAction[],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
    degraded: [] as SpaceFrame["degraded"],
  };

  if (state.loading || !response) {
    return {
      ...base,
      status: { label: "Reading", tone: "active" as SpaceTone },
      blocks: [],
      state: state.error ? ("error" as const) : ("loading" as const),
      emptyState: state.error
        ? {
            heading: "Today could not be read.",
            body: "Nothing has been changed. Try again, and if it keeps failing tell whoever administers this brokerage's ASAP.",
            actions: [],
          }
        : null,
    };
  }

  const items = response.items.filter((i) => i.section === "needs_you");
  const checks = response.items.filter((i) => i.section === "checks_due");

  /*
   * An empty Today is two different facts, and a new brokerage deserves the second one. "Nothing
   * needs you" said to someone with no clients is a lie of omission (D-068), so the counts the
   * server returned decide which emptiness this is.
   */
  if (response.items.length === 0) {
    const newBook = response.book.clients === 0 && response.book.policies === 0;
    return {
      ...base,
      status: { label: "Nothing open", tone: "done" as SpaceTone },
      blocks: [],
      state: "empty" as const,
      degraded: response.degraded,
      emptyState: newBook
        ? {
            heading: "There is nothing on file yet.",
            body: "Today shows the work that needs a person. Bring a book of clients in, or connect the mailbox, and it will fill itself from your own records.",
            actions: [
              quickAction("Import client records", "/import"),
              quickAction("Review connected email", "/email"),
            ],
          }
        : {
            heading: "Nothing needs a person right now.",
            body: `${response.book.work} ${response.book.work === 1 ? "item is" : "items are"} on file and none of them is waiting on anyone here. Work has everything, including what an outside party is holding.`,
            actions: [quickAction("Open all work", "/work")],
          },
    };
  }

  const blocks: SpaceFrameBlock[] = [
    rowsBlock("prioritised", "Prioritised from live records", items.map(attentionRow)),
  ];
  if (checks.length > 0) {
    blocks.push(rowsBlock("checks", "Checks due on the server's clock", checks.map(attentionRow)));
  }

  /*
   * What ASAP has observed. It is an observation and says so: nothing that needs a person lives
   * only in a run, and this block never carries an action a person has to take.
   */
  blocks.push({
    id: "observation",
    type: "note",
    label: "ASAP OBSERVED",
    tone: "active",
    title: observationTitle(response),
    text: "Ranking is computed from your own rows — a failed run, a passed check date, an unconfirmed cover, an unpaid premium — and every row can say which of those put it here. Nothing on this screen was written by a language model.",
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  });

  blocks.push(
    rowsBlock("quick", "Quick actions", [
      quickRow(
        "ask",
        "Ask about this brokerage",
        "Type a question and ASAP answers from your records, with what it read.",
        "/ask",
        "Open Ask",
      ),
      quickRow(
        "import",
        "Import client records",
        "Bring a book of clients, policies and contacts in from a spreadsheet.",
        "/import",
        "Open import",
      ),
      quickRow(
        "email",
        "Review connected email",
        "Threads from the connected mailbox, matched to clients where they match.",
        "/email",
        "Open email",
      ),
      quickRow(
        "new",
        "Start new work",
        "A renewal, a claim, a placement, a document.",
        "/new",
        "Start",
      ),
      quickRow(
        "all",
        "Open all work",
        "Everything, including what an outside party is holding.",
        "/work",
        "Open Work",
      ),
    ]),
  );

  return {
    ...base,
    status: {
      label: `${items.length} open`,
      tone: items.length === 0 ? ("done" as SpaceTone) : ("active" as SpaceTone),
    },
    blocks,
    state: "ready" as const,
    emptyState: null,
    degraded: response.degraded,
  };
}

/** One line on what ASAP has been doing, from counted rows only. */
function observationTitle(response: AttentionResponse): string {
  const runs = response.orphanRuns.length;
  const needs = response.items.filter((i) => i.section === "needs_you").length;
  const checks = response.items.filter((i) => i.section === "checks_due").length;
  const parts = [`${needs} ${needs === 1 ? "item needs" : "items need"} a person`];
  if (checks > 0)
    parts.push(`${checks} ${checks === 1 ? "check has" : "checks have"} passed its date`);
  if (runs > 0) parts.push(`${runs} ${runs === 1 ? "run" : "runs"} stopped without finishing`);
  return parts.join(", ") + ".";
}

function quickAction(label: string, path: string): SpaceFrameAction {
  return {
    verb: "open",
    label,
    to: {
      spaceKind: "route",
      recordType: "route",
      recordId: null,
      workflowId: null,
      path,
      title: label,
      label: "ASAP",
    },
    stepId: null,
    disabledReason: null,
    notPermittedReason: null,
  };
}

function quickRow(id: string, title: string, note: string, path: string, label: string): SpaceRow {
  return {
    id,
    title,
    note,
    badge: null,
    badgeTone: "neutral",
    why: null,
    related: null,
    actions: [quickAction(label, path)],
    evidence: [],
  };
}

/** One Today row, from one ranked attention item. */
function attentionRow(row: AttentionResponse["items"][number]): SpaceRow {
  return {
    id: row.item.id,
    title: row.item.title,
    note: noteFor(row),
    badge: WORK_PRIORITY_LABELS[row.priority],
    badgeTone: PRIORITY_TONE[row.priority],
    /*
     * The engine's own reason, plus the named signals that scored it. Behind one click, because a
     * row that cannot say why it is on the screen is a row a person learns to distrust — and
     * because putting it in front of every row would bury the work itself.
     */
    why: `${row.reason} ${row.signals.map((s) => s.because).join(" ")}`.trim(),
    related: refForWorkItem(row.item, row.links),
    actions: [openAction(row.item, row.links)],
    evidence: evidenceFor(row.facts),
  };
}

function openAction(item: WorkItemRow, links: { work: string }): SpaceFrameAction {
  return {
    verb: "open",
    label: "Open →",
    to: refForWorkItem(item, links),
    stepId: null,
    disabledReason: null,
    notPermittedReason: null,
  };
}

function rowsBlock(id: string, label: string | null, rows: SpaceRow[]): SpaceFrameBlock {
  return {
    id,
    type: "rows",
    label,
    rows,
    evidence: [],
    actions: [],
    state: rows.length === 0 ? "empty" : "ready",
    stateNote: rows.length === 0 ? "Nothing in this list." : null,
  };
}

/**
 * Work — every view, through the same renderer.
 *
 * The five main views are the task-status layer itself plus Recent (D-075). The filters are links,
 * so choosing one changes what the server returns: a filter that hid rows the browser already had
 * would disagree with its own count the moment the cap bit.
 */
export function workSpace(
  response: WorkListResponse | undefined,
  state: { loading: boolean; error: boolean },
  options: { canAssign: boolean; people: { id: string; name: string }[] },
): SpaceFrame {
  const view = response?.view ?? "needs";
  const self: SpaceRef = {
    spaceKind: "work",
    recordType: "organization",
    recordId: null,
    workflowId: null,
    path: "/work",
    title: "Work",
    label: "WORK",
  };
  /*
   * The five main views, in the prototype's order. `review` is deliberately absent: "For review"
   * is contextual and appears where review is genuinely the question, never as the name for all
   * human work.
   */
  const MAIN: WorkView[] = ["needs", "with", "progress", "done", "recent"];
  const filters: SpaceFilter[] = MAIN.map((v) => ({
    id: v,
    label: WORK_VIEW_LABELS[v],
    active: v === view,
    count: response?.counts[v] ?? null,
    to: `/work?view=${v}`,
  }));

  const base = {
    self,
    title: "All work",
    context: null,
    filters,
    related: [] as SpaceRef[],
    actions: [] as SpaceFrameAction[],
    evidence: [],
    permission: {
      canAssign: options.canAssign,
      canApprove: false,
      note: options.canAssign ? null : "Your role can read this work but not change who owns it.",
    },
  };

  if (state.loading || !response) {
    return {
      ...base,
      status: { label: "Reading", tone: "active" as SpaceTone },
      blocks: [],
      state: state.error ? ("error" as const) : ("loading" as const),
      degraded: [],
      emptyState: state.error
        ? {
            heading: "This view could not be read.",
            body: "Nothing has been changed. The other views may still work.",
            actions: [],
          }
        : null,
    };
  }

  if (response.items.length === 0) {
    return {
      ...base,
      status: { label: "0 items", tone: "done" as SpaceTone },
      blocks: [],
      state: "empty" as const,
      degraded: response.degraded,
      emptyState: {
        heading: emptyHeading(view),
        body: "The counts beside each view above come from the same read as this list, so they cannot disagree with it.",
        actions: [],
      },
    };
  }

  const blocks: SpaceFrameBlock[] = [
    rowsBlock(
      "work",
      "Owner, party and state come from the records",
      response.items.map((row) => workRow(row, options)),
    ),
  ];

  return {
    ...base,
    status: {
      label: `${response.items.length} ${response.items.length === 1 ? "item" : "items"}`,
      tone: "active" as SpaceTone,
    },
    blocks,
    state: "ready" as const,
    emptyState: null,
    degraded: response.degraded,
  };
}

/** What an empty view says. Each one names its own emptiness rather than sharing a blank. */
function emptyHeading(view: WorkView): string {
  switch (view) {
    case "needs":
      return "Nothing is waiting on anyone here.";
    case "with":
      return "No item is with an outside party.";
    case "progress":
      return "Nothing has been started and left open.";
    case "done":
      return "Nothing has been completed yet.";
    case "recent":
      return "Nothing has been touched recently.";
    case "review":
      return "ASAP has not prepared anything that needs a look.";
  }
}

/** One Work row. Owner, party, state, next check, priority, reason, and where it opens. */
function workRow(
  row: WorkListResponse["items"][number],
  options: { canAssign: boolean },
): SpaceRow {
  const actions: SpaceFrameAction[] = [openAction(row.item, row.links)];
  /*
   * Assignment is offered as an action, not as a form on every row: the form is the `assignment`
   * block and it belongs in the item's own Space. Offering it here would be a mutation inside a
   * list, which is how a misclick reassigns the wrong item.
   */
  actions.unshift({
    verb: "assign",
    label: "Assign",
    to: null,
    stepId: row.nowStep?.id ?? "assign",
    disabledReason: null,
    notPermittedReason: options.canAssign
      ? null
      : "Your role can read this work but not change who owns it.",
  });
  return {
    id: row.item.id,
    title: row.item.title,
    note: noteFor(row),
    badge: badgeForWork(row),
    badgeTone: toneForWork(row),
    why: `${row.reason} ${row.signals.map((s) => s.because).join(" ")}`.trim(),
    related: refForWorkItem(row.item, row.links),
    actions,
    evidence: evidenceFor(row.facts),
  };
}

/**
 * A Work row's badge.
 *
 * It names the priority band, not the state: the state is already in the row's own line, in the
 * words the product uses, and a badge repeating "With CIC" beside "With CIC since 12 Aug" is a
 * badge that tells a person nothing. A completed item says so instead, because a priority on
 * something finished is noise.
 */
function badgeForWork(row: WorkListResponse["items"][number]): string {
  if (row.item.task_status === "done") return "Done";
  return WORK_PRIORITY_LABELS[row.priority];
}

function toneForWork(row: WorkListResponse["items"][number]): SpaceTone {
  if (row.item.task_status === "done") return "done";
  if (row.item.task_status === "with_party") return "waiting";
  return PRIORITY_TONE[row.priority];
}

/** Exported for the tests that assert a facts block is built from real rows rather than prose. */
export function factsFromPeriod(period: WorkListResponse["items"][number]["period"]): SpaceFact[] {
  if (!period) return [];
  return [
    { key: "CLASS", value: period.classOfBusiness, missing: false, evidence: [] },
    { key: "INSURER", value: period.insurerName, missing: false, evidence: [] },
    {
      key: "POLICY NUMBER",
      value: period.policyNumber ?? "",
      missing: period.policyNumber === null,
      evidence: [],
    },
    { key: "COVER ENDS", value: formatSince(period.periodEnd), missing: false, evidence: [] },
  ];
}
