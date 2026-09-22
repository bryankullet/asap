import {
  RUN_GROUP_LABELS,
  type MailboxesResponse,
  type RunDetailResponse,
  type RunListResponse,
  type SpaceFilter,
  type SpaceFrame,
  type SpaceFrameAction,
  type SpaceFrameBlock,
  type SpaceRef,
  type SpaceRow,
  type SpaceTone,
} from "@asap/schema";
import { formatSince } from "../components/status/slots.js";

/**
 * Connections and Activity, as Spaces.
 *
 * Both are honesty surfaces more than anything else, so both are written to make the honest thing
 * the easy thing: a mailbox is never described as connected unless a row says so, and a run is
 * never the only place something a person must do appears.
 */

/* ---- Connections ------------------------------------------------------------------------- */

/**
 * What a mailbox is called, from what the **server** confirms — never inferred here.
 *
 * Six states, and which one applies is decided by two server-owned facts: the connection status,
 * and `sync.state`. "Syncing" appears when, and only when, the server says a sync run is active.
 * That is the whole rule: the word is not banned, it is *earned*. Until a reader exists the server
 * answers `never`, and a connected mailbox says plainly that reading has not started.
 */
function mailboxWords(mailbox: {
  status: string;
  sync: { state: string; lastSyncedAt: string | null; error: string | null };
}): { label: string; tone: SpaceTone } {
  /*
   * A disconnected mailbox never reaches here — it is not a live connection, so its provider row
   * reads "Not connected" like any other. What matters is that no disconnected mailbox can be
   * described as connected or as reading, whatever its sync row happens to say.
   */
  if (mailbox.status === "needs_reauthorisation") {
    return { label: "Needs authorising again", tone: "attention" };
  }
  if (mailbox.sync.state === "syncing") return { label: "Syncing", tone: "active" };
  if (mailbox.sync.state === "failed") return { label: "Sync stopped", tone: "attention" };
  if (mailbox.sync.state === "idle" && mailbox.sync.lastSyncedAt !== null) {
    return { label: "Connected", tone: "active" };
  }
  return { label: "Connected", tone: "active" };
}

export function connectionsSpace(
  response: MailboxesResponse | undefined,
  state: { loading: boolean; error: string | null },
  /** What a connect attempt came back with, when this deployment cannot connect that provider. */
  notConfigured: string | null,
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "route",
    recordType: "connections",
    recordId: null,
    workflowId: null,
    path: "/settings/connections",
    title: "Connections",
    label: "CONNECTIONS",
  };
  const base = {
    self,
    title: "Connected email and data",
    context: "What ASAP is allowed to read on this brokerage's behalf.",
    filters: [] as SpaceFilter[],
    related: [] as SpaceRef[],
    region: null,
    actions: [] as SpaceFrameAction[],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
  };

  if (state.error !== null) {
    return {
      ...base,
      status: { label: "Could not read", tone: "attention" },
      blocks: [],
      state: "error",
      degraded: [],
      emptyState: { heading: "The connections could not be read.", body: state.error, actions: [] },
    };
  }
  if (state.loading || !response) {
    return {
      ...base,
      status: { label: "Reading", tone: "active" },
      blocks: [],
      state: "loading",
      degraded: [],
      emptyState: null,
    };
  }

  const live = response.mailboxes.filter((m) => m.status !== "disconnected");
  const blocks: SpaceFrameBlock[] = [];

  /*
   * Every mailbox on file, with the reason it is in the state it is in. A provider this deployment
   * has no credentials for is shown as a row that says so rather than a button that fails.
   */
  const rows: SpaceRow[] = response.providers.map((provider) => {
    const mine = live.filter((m) => m.provider === provider.id);
    const mailbox = mine[0];
    const words = mailbox ? mailboxWords(mailbox) : undefined;

    const notes: string[] = [];
    if (mailbox) {
      notes.push(mailbox.emailAddress);
      if (mailbox.statusReason !== null) notes.push(mailbox.statusReason);
      /*
       * What reading is doing, in the server's own terms. A failure carries the error itself,
       * because "something went wrong" is not something a person can act on.
       */
      if (mailbox.status === "disconnected") {
        notes.push("Nothing is being read.");
      } else if (mailbox.sync.state === "syncing") {
        notes.push("Reading messages now");
      } else if (mailbox.sync.state === "failed") {
        notes.push(mailbox.sync.error ?? "The last read did not finish.");
      } else if (mailbox.sync.lastSyncedAt !== null) {
        notes.push(`Last synced ${formatSince(mailbox.sync.lastSyncedAt)}`);
      } else {
        notes.push("Connected. Reading has not started.");
      }
    } else if (!provider.available) {
      /*
       * The reason itself belongs beside the disabled control, not here: §34 puts a guard's words
       * next to what they block, and saying the same sentence twice in one row is noise.
       */
      notes.push("Not offered by this deployment.");
    } else {
      notes.push("Not connected. Nothing is read until a person authorises it.");
    }

    const actions: SpaceFrameAction[] = [];
    if (mailbox) {
      /*
       * Starting or retrying a read. Offered whenever the server says it can be, disabled with the
       * server's own reason when it cannot — including the honest one, that nothing reads a
       * mailbox in this deployment yet.
       */
      if (mailbox.status !== "disconnected") {
        actions.push({
          verb: "prepare",
          label: mailbox.sync.state === "failed" ? "Try reading again" : "Read the mailbox",
          to: null,
          stepId: `sync:${mailbox.id}`,
          disabledReason: mailbox.sync.canStart
            ? null
            : (mailbox.sync.cannotStartReason ?? "This cannot be started right now."),
          notPermittedReason: null,
        });
      }
      actions.push({
        verb: "exception",
        label: mailbox.status === "connected" ? "Disconnect" : "Authorise again",
        to: null,
        stepId: `mailbox:${mailbox.id}`,
        disabledReason: null,
        notPermittedReason: null,
      });
    } else {
      actions.push({
        verb: "prepare",
        label: "Connect",
        to: null,
        stepId: `connect:${provider.id}`,
        /*
         * Shown disabled with the reason rather than hidden (§34). A missing button teaches a
         * person that the feature does not exist; a disabled one with a sentence teaches them that
         * this deployment has not been given the credentials.
         */
        disabledReason: provider.available
          ? null
          : (provider.unavailableReason ?? "This deployment cannot connect it yet."),
        notPermittedReason: null,
      });
    }

    return {
      id: provider.id,
      title: provider.label,
      note: notes.join(" · "),
      badge: words?.label ?? (provider.available ? "Not connected" : "Unavailable here"),
      badgeTone: words?.tone ?? (provider.available ? "neutral" : "waiting"),
      why: null,
      related: null,
      region: null,
      actions,
      evidence: [],
    };
  });

  blocks.push({
    id: "sources",
    type: "rows",
    label: "Mailbox",
    rows,
    evidence: [],
    actions: [],
    state: rows.length === 0 ? "empty" : "ready",
    stateNote: rows.length === 0 ? "No mail provider is offered by this deployment." : null,
  });

  if (notConfigured !== null) {
    blocks.push({
      id: "not-configured",
      type: "note",
      label: null,
      tone: "waiting",
      title: "This deployment cannot connect that provider yet",
      text: notConfigured,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  /*
   * The gap, named — but only while it is real.
   *
   * This block appears when the server says no mailbox can start a read. The moment the sync
   * worker lands, `canStart` becomes true for a connected mailbox and this disappears on its own:
   * the message is a consequence of the backend's state, not a fixed sentence someone has to
   * remember to delete.
   */
  const readerMissing =
    live.length > 0 && live.every((m) => !m.sync.canStart && m.sync.state === "never");
  if (readerMissing) {
    blocks.push({
      id: "sync-unavailable",
      type: "missing",
      label: "NOT AVAILABLE YET",
      items: [
        {
          text: "Reading messages from a connected mailbox. Authorising records the connection, and nothing reads it yet — so there is no sync to start or show progress for.",
        },
        {
          text: "An initial import of past messages. It needs the same reader, so it cannot be offered before that exists.",
        },
      ],
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  blocks.push({
    id: "what-is-connected",
    type: "note",
    label: null,
    tone: "active",
    title: "What is genuinely connected",
    text: "Uploads read real files from your device and are stored against this brokerage. A mailbox is connected only when a person has authorised it and a row here says so — no provider key exists in the browser and none should.",
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  });

  return {
    ...base,
    status: {
      label: `${live.length} connected`,
      tone: live.length > 0 ? "active" : "neutral",
    },
    blocks,
    state: "ready",
    degraded: [],
    emptyState: null,
  };
}

/* ---- Activity ---------------------------------------------------------------------------- */

/**
 * Activity — what ASAP has been doing.
 *
 * Observation only, and the Space says so in its first block. A run is never the only place
 * something a person must do appears: anything needing a person is in Work first, which is what
 * makes Activity safe to ignore. That promise is the reason this board exists at all rather than
 * being a destination in the sidebar (D-074).
 */
export function activitySpace(
  response: RunListResponse | undefined,
  state: { loading: boolean; error: string | null },
  filters: readonly { id: string; label: string }[],
  activeFilter: string,
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "activity",
    recordType: "organization",
    recordId: null,
    workflowId: null,
    path: "/jobs",
    title: "Activity",
    label: "ACTIVITY",
  };
  const base = {
    self,
    title: "What ASAP has been doing",
    context: null,
    filters: filters.map((f) => ({
      id: f.id,
      label: f.label,
      active: f.id === activeFilter,
      count: response?.counts[f.id as keyof typeof response.counts] ?? null,
      to: `/jobs?filter=${f.id}`,
    })),
    related: [] as SpaceRef[],
    region: null,
    actions: [] as SpaceFrameAction[],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
  };

  if (state.error !== null) {
    return {
      ...base,
      status: { label: "Could not read", tone: "attention" },
      blocks: [],
      state: "error",
      degraded: [],
      emptyState: {
        heading: "The runs could not be read.",
        body: `${state.error} Nothing important lives only here — anything needing a person is in Work.`,
        actions: [],
      },
    };
  }
  if (state.loading || !response) {
    return {
      ...base,
      status: { label: "Reading", tone: "active" },
      blocks: [],
      state: "loading",
      degraded: [],
      emptyState: null,
    };
  }

  const total = response.groups.reduce((n, g) => n + g.items.length, 0);

  const observation: SpaceFrameBlock = {
    id: "observation",
    type: "note",
    label: null,
    tone: "active",
    title: "Nothing important lives only here",
    text: "Every decision ASAP prepares also exists in Work, where a person owns it. Activity is observation: a finished run means ASAP produced an output, never that a policy renewed, a claim was accepted or money arrived.",
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  };

  if (total === 0) {
    return {
      ...base,
      status: { label: "Nothing running", tone: "done" },
      blocks: [observation],
      state: "ready",
      degraded: response.degraded,
      emptyState: null,
    };
  }

  const blocks: SpaceFrameBlock[] = [observation];
  for (const group of response.groups) {
    if (group.items.length === 0) continue;
    blocks.push({
      id: `group-${group.key}`,
      type: "rows",
      /* The group's approved words, not the API's raw title, so a label cannot drift from the ban. */
      label: RUN_GROUP_LABELS[group.key],
      rows: group.items.map(runRow),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  return {
    ...base,
    status: { label: `${total} ${total === 1 ? "run" : "runs"}`, tone: "active" },
    blocks,
    state: "ready",
    degraded: response.degraded,
    emptyState: null,
  };
}

/** One run. Its own last event, in its own words, and the work it left for a person. */
function runRow(item: RunListResponse["groups"][number]["items"][number]): SpaceRow {
  const notes = [item.client?.name ?? "This brokerage"];
  if (item.lastEvent !== null) notes.push(item.lastEvent);
  if (item.waitingFor !== null) notes.push(item.waitingFor);
  if (item.progress !== null) notes.push(`${item.progress}% of its steps`);

  const actions: SpaceFrameAction[] = [
    {
      verb: "open",
      label: "Open run →",
      to: {
        spaceKind: "activity",
        recordType: "run",
        recordId: item.run.id,
        workflowId: null,
        path: `/jobs/${item.run.id}`,
        title: item.run.title,
        label: "RUN",
      },
      stepId: null,
      disabledReason: null,
      notPermittedReason: null,
    },
  ];
  /*
   * A run that stopped and left work goes to the *work*, not to itself. This is the promise that
   * makes Activity ignorable: the thing a person must do is somewhere they own.
   */
  if (item.work !== null) {
    actions.unshift({
      verb: "open",
      label: "Open the work →",
      to: {
        spaceKind: "work_item",
        recordType: "work_item",
        recordId: item.work.id,
        workflowId: null,
        path: `/r/${item.work.id}`,
        title: item.work.title,
        label: "WORK",
      },
      stepId: null,
      disabledReason: null,
      notPermittedReason: null,
    });
  }

  /*
   * Three words, and the group already decided which. A run waiting on an outside party is still
   * open, so it is Working — `waitingFor` carries the supporting sentence ("Jubilee must respond
   * before this continues"), and naming the party as a *state* is the human-work layer's job.
   */
  return {
    id: item.run.id,
    title: item.run.title,
    note: notes.join(" · "),
    badge: RUN_GROUP_LABELS[item.group],
    badgeTone:
      item.group === "stopped" ? "attention" : item.group === "working" ? "active" : "done",
    why: item.run.next_step,
    related: null,
    region: null,
    actions,
    evidence: [],
  };
}

/* ---- One run ----------------------------------------------------------------------------- */

/**
 * A single run, as a Space: what ASAP did, step by step, and what it left for a person.
 *
 * A `timeline` block, because that is what a run is — a sequence of things that happened, each
 * with its own evidence. There is no progress figure and no outcome claim anywhere in it: a
 * finished run produced an output, and whether cover was confirmed or money arrived is a different
 * fact on a different record (§45 rule 10).
 */
export function runSpace(
  detail: RunDetailResponse | undefined,
  state: { loading: boolean; error: string | null; missing: boolean },
  runId: string,
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "activity",
    recordType: "run",
    recordId: detail?.run.id ?? null,
    workflowId: null,
    path: `/jobs/${runId}`,
    title: detail?.run.title ?? "Run",
    label: "RUN",
  };
  const base = {
    self,
    title: detail?.run.title ?? "Run",
    context: null,
    filters: [] as SpaceFilter[],
    actions: [] as SpaceFrameAction[],
    permission: { canAssign: false, canApprove: false, note: null },
    degraded: [] as SpaceFrame["degraded"],
  };

  if (state.error !== null || state.missing) {
    return {
      ...base,
      related: [],
      evidence: [],
      status: { label: state.missing ? "Not found" : "Could not read", tone: "attention" },
      blocks: [],
      state: "error",
      emptyState: {
        heading: state.missing ? "No run with that id." : "This run could not be read.",
        body: state.missing
          ? "It may have finished and been cleared, or your role in this brokerage cannot see it. Anything it left for a person is in Work."
          : (state.error ?? ""),
        actions: [],
      },
    };
  }
  if (state.loading || !detail) {
    return {
      ...base,
      related: [],
      evidence: [],
      status: { label: "Reading", tone: "active" },
      blocks: [],
      state: "loading",
      emptyState: null,
    };
  }

  /*
   * `paused` is **not** stopped: it is a run still open, waiting on an outside party. It reads as
   * Working, and `waitingFor` says who must respond.
   */
  const stopped = detail.run.status === "could_not_finish" || detail.run.status === "stopped";
  const ended = detail.run.status === "finished";

  /* The work this run belongs to, so a person always reaches something they own. */
  const related: SpaceRef[] = detail.relatedWork
    ? [
        {
          spaceKind: "work_item",
          recordType: "work_item",
          recordId: detail.relatedWork.id,
          workflowId: null,
          path: `/r/${detail.relatedWork.id}`,
          title: detail.relatedWork.title,
          label: "WORK",
        },
      ]
    : [];

  const blocks: SpaceFrameBlock[] = [
    {
      id: "what-happened",
      type: "timeline",
      label: "WHAT ASAP DID",
      events: detail.events.map((event) => ({
        id: String(event.id),
        when: formatSince(event.created_at),
        text: event.message,
        tone:
          event.kind === "error"
            ? ("attention" as SpaceTone)
            : event.kind === "paused"
              ? ("waiting" as SpaceTone)
              : event.kind === "finished"
                ? ("done" as SpaceTone)
                : ("active" as SpaceTone),
        link: null,
        related: null,
        region: null,
      })),
      evidence: [],
      actions: [],
      state: detail.events.length === 0 ? "empty" : "ready",
      stateNote:
        detail.events.length === 0 ? "This run recorded no steps before it stopped." : null,
    },
  ];

  /*
   * What the run left for a person, and where it lives. Never the only route to it: the work item
   * carries it too, which is the whole reason Activity can be ignored at no cost.
   */
  if (detail.relatedWork) {
    blocks.push({
      id: "left-for-a-person",
      type: "rows",
      label: "WHAT A PERSON OWNS",
      rows: [
        {
          id: detail.relatedWork.id,
          title: detail.relatedWork.title,
          note:
            detail.relatedWork.nowStep === null
              ? "Nothing is waiting on this step."
              : `${detail.relatedWork.nowStep} is the step waiting.`,
          badge: null,
          badgeTone: "neutral",
          why: null,
          related: related[0] ?? null,
          region: null,
          actions: [
            {
              verb: "open",
              label: "Open the work →",
              to: related[0]!,
              stepId: null,
              disabledReason: null,
              notPermittedReason: null,
            },
          ],
          evidence: [],
        },
      ],
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  /*
   * What a person can do about a stopped run.
   *
   * `open_work` is the one that always exists, because the work is where the decision lives.
   * Retrying and resuming a step are offered **disabled with the server's own reason** rather than
   * hidden: no endpoint performs them yet, and a control that vanishes teaches a person the
   * capability does not exist when in fact it has not been built (§34).
   */
  if (detail.recovery.length > 0) {
    blocks.push({
      id: "recovery",
      type: "approval_gate",
      label: "WHAT YOU CAN DO",
      heading: stopped ? "This run stopped before it finished" : "This run has finished",
      detail:
        detail.waitingFor ??
        (detail.run.next_step ??
          "Everything it recorded is above, with its evidence. Nothing it left for a person lives only here."),
      blockedNote: null,
      evidence: [],
      actions: detail.recovery.map((option) =>
        option.kind === "open_work" && detail.relatedWork !== null
          ? {
              verb: "open" as const,
              label: option.label,
              to: related[0]!,
              stepId: null,
              disabledReason: option.disabledReason,
              notPermittedReason: null,
            }
          : {
              verb: "prepare" as const,
              label: option.label,
              to: null,
              stepId: option.kind,
              disabledReason:
                option.disabledReason ??
                "Nothing performs this yet. The work above is where the decision lives.",
              notPermittedReason: null,
            },
      ),
      state: "ready",
      stateNote: null,
    });
  }

  return {
    ...base,
    related,
    evidence: detail.evidence,
    status: {
      label: stopped ? "Stopped" : ended ? "Finished" : "Working",
      tone: stopped ? "attention" : ended ? "done" : "active",
    },
    blocks,
    state: "ready",
    emptyState: null,
  };
}
