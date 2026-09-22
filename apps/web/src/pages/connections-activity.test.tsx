import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  mailboxesResponseSchema,
  runDetailResponseSchema,
  runListResponseSchema,
  type MailboxesResponse,
  type RunListResponse,
} from "@asap/schema";
import { activitySpace, connectionsSpace, runSpace } from "../live/connections-space.js";
import { SpaceFrameView } from "../space/SpaceFrame.js";
import { JOB_FILTERS } from "../shell/nav.js";
import { renderInRouter } from "../test-utils.js";

/**
 * Connections and Activity.
 *
 * Both are honesty surfaces, and both are tested for the thing that would make them dishonest: a
 * mailbox described as connected when no row says so, and a run that is the only place something
 * a person must do appears.
 */

const ORG = "10000000-0000-4000-8000-00000000000a";
const RUN = "50000000-0000-4000-8000-000000000001";
const ITEM = "00000000-0000-4000-8000-000000000001";
const MAILBOX = "70000000-0000-4000-8000-000000000001";
const READY = { loading: false, error: null };

const mailboxes = (over: Partial<MailboxesResponse> = {}): MailboxesResponse =>
  mailboxesResponseSchema.parse({
    mailboxes: [],
    providers: [
      { id: "gmail", label: "Gmail", available: true, unavailableReason: null },
      {
        id: "microsoft",
        label: "Microsoft 365",
        available: false,
        unavailableReason: "This deployment has no Microsoft credentials.",
      },
    ],
    ...over,
  });

/** A mailbox in whatever state the server reports. The sync half is always the server's word. */
const box = (
  over: Partial<MailboxesResponse["mailboxes"][number]> = {},
  sync: Partial<MailboxesResponse["mailboxes"][number]["sync"]> = {},
): MailboxesResponse["mailboxes"][number] => ({
  id: MAILBOX,
  provider: "gmail",
  emailAddress: "broking@example.invalid",
  displayName: null,
  status: "connected",
  statusReason: null,
  lastSyncedAt: null,
  connectedAt: "2026-08-01T00:00:00.000Z",
  sync: {
    state: "never",
    runId: null,
    lastSyncedAt: null,
    error: null,
    canStart: false,
    cannotStartReason: "Nothing reads a mailbox in this deployment yet.",
    ...sync,
  },
  ...over,
});

const connected = () => mailboxes({ mailboxes: [box()] });

/** The one row the Space draws for Gmail, whatever state it is in. */
function gmailRow(response: MailboxesResponse) {
  const rows = connectionsSpace(response, READY, null).blocks.find((b) => b.id === "sources");
  if (rows?.type !== "rows") throw new Error("expected rows");
  return rows.rows.find((r) => r.id === "gmail")!;
}

const runList = (over: Partial<RunListResponse> = {}): RunListResponse =>
  runListResponseSchema.parse({
    organization: { id: ORG, name: "Acme" },
    filter: "all",
    label: "All",
    generatedAt: "2026-08-20T09:00:00.000Z",
    groups: [
      {
        key: "stopped",
        title: "ignored",
        items: [
          {
            run: {
              id: RUN,
              organization_id: ORG,
              work_item_id: ITEM,
              title: "Read the schedule",
              status: "could_not_finish",
              next_step: "The document has no readable text.",
              started_by: null,
              boot_token: null,
              started_at: "2026-08-20T08:00:00.000Z",
              ended_at: "2026-08-20T08:04:00.000Z",
              created_at: "2026-08-20T08:00:00.000Z",
              updated_at: "2026-08-20T08:04:00.000Z",
            },
            group: "stopped",
            progress: 40,
            lastEvent: "Could not read page 2",
            waitingFor: null,
            needsPerson: true,
            work: { id: ITEM, title: "Confirm the sum insured" },
            client: { id: "20000000-0000-4000-8000-000000000001", name: "A client" },
            period: null,
          },
        ],
      },
    ],
    counts: { all: 1, working: 0, stopped: 1, finished: 0 },
    visible: 1,
    returned: 1,
    cap: 50,
    degraded: [],
    ...over,
  });

describe("the Connections Space", () => {
  it("never says connected when no row says so", () => {
    const space = connectionsSpace(mailboxes(), READY, null);
    expect(space.status.label).toBe("0 connected");
    const rows = space.blocks.find((b) => b.id === "sources");
    if (rows?.type !== "rows") throw new Error("expected rows");
    const gmail = rows.rows.find((r) => r.id === "gmail")!;
    expect(gmail.badge).toBe("Not connected");
    expect(gmail.note).toMatch(/Nothing is read until a person authorises it/);
  });

  it("says connected, and says plainly that nothing has been read", () => {
    expect(connectionsSpace(connected(), READY, null).status.label).toBe("1 connected");
    const gmail = gmailRow(connected());
    expect(gmail.badge).toBe("Connected");
    expect(gmail.note).toMatch(/Reading has not started/);
    expect(gmail.actions.some((a) => a.label === "Disconnect")).toBe(true);
  });

  /* §34: shown disabled with the reason, never hidden. A missing button teaches the wrong lesson. */
  it("shows a provider this deployment cannot connect, disabled, with the reason", () => {
    const space = connectionsSpace(mailboxes(), READY, null);
    const rows = space.blocks.find((b) => b.id === "sources");
    if (rows?.type !== "rows") throw new Error("expected rows");
    const microsoft = rows.rows.find((r) => r.id === "microsoft")!;
    expect(microsoft.actions[0]?.disabledReason).toMatch(/no Microsoft credentials/);
  });

  it("offers reauthorising, by name, when the connection has lapsed", () => {
    const gmail = gmailRow(
      mailboxes({
        mailboxes: [
          box({ status: "needs_reauthorisation", statusReason: "The provider withdrew the permission." }),
        ],
      }),
    );
    expect(gmail.badge).toBe("Needs authorising again");
    expect(gmail.note).toMatch(/withdrew the permission/);
    expect(gmail.actions.some((a) => a.label === "Authorise again")).toBe(true);
  });

  /*
   * "Syncing" is not banned — it is *earned*. These six cases are the whole rule: the word appears
   * when the server says a run is active, and never because a client inferred it. Each state is
   * asserted against what the backend reported, so the day the reader lands nothing here has to be
   * rewritten: the fixtures simply start reporting a different state.
   */
  describe("reading state, and only what the server confirms", () => {
    it("says reading has not started, for a connected mailbox with no reader", () => {
      const gmail = gmailRow(connected());
      expect(gmail.badge).toBe("Connected");
      expect(gmail.note).toMatch(/Reading has not started/);
      // And the control is offered, disabled, with the server's reason — never hidden (§34).
      const start = gmail.actions.find((a) => a.stepId === `sync:${MAILBOX}`)!;
      expect(start.disabledReason).toBe("Nothing reads a mailbox in this deployment yet.");
    });

    it("never says Syncing unless the server reports a run", () => {
      expect(JSON.stringify(connectionsSpace(connected(), READY, null))).not.toContain("Syncing");
    });

    it("says Syncing while the server reports a run genuinely active", () => {
      const gmail = gmailRow(
        mailboxes({
          mailboxes: [
            box({}, { state: "syncing", runId: "50000000-0000-4000-8000-000000000009", canStart: false, cannotStartReason: "A read is already running." }),
          ],
        }),
      );
      expect(gmail.badge).toBe("Syncing");
      expect(gmail.badgeTone).toBe("active");
      expect(gmail.note).toMatch(/Reading messages now/);
    });

    it("shows the real error and a retry when a sync failed", () => {
      const gmail = gmailRow(
        mailboxes({
          mailboxes: [
            box({}, {
              state: "failed",
              error: "Google refused the request: insufficient scope.",
              canStart: true,
              cannotStartReason: null,
            }),
          ],
        }),
      );
      expect(gmail.badge).toBe("Sync stopped");
      expect(gmail.note).toContain("Google refused the request: insufficient scope.");
      const retry = gmail.actions.find((a) => a.stepId === `sync:${MAILBOX}`)!;
      expect(retry.label).toBe("Try reading again");
      expect(retry.disabledReason).toBeNull();
    });

    it("says when it last synced, once one has genuinely finished", () => {
      const gmail = gmailRow(
        mailboxes({
          mailboxes: [
            box({ lastSyncedAt: "2026-08-20T09:00:00.000Z" }, {
              state: "idle",
              lastSyncedAt: "2026-08-20T09:00:00.000Z",
              canStart: true,
              cannotStartReason: null,
            }),
          ],
        }),
      );
      expect(gmail.badge).toBe("Connected");
      expect(gmail.note).toMatch(/Last synced/);
    });

    it("never lets a disconnected mailbox look connected, or look like it is reading", () => {
      const gmail = gmailRow(
        mailboxes({
          mailboxes: [box({ status: "disconnected" }, { state: "syncing", runId: "50000000-0000-4000-8000-000000000009" })],
        }),
      );
      /*
       * Disconnected outranks everything, including a sync row that still says "syncing": the
       * mailbox is not a live connection, so the provider reads as not connected, nothing offers
       * to read it, and the word "Syncing" does not appear anywhere.
       */
      expect(gmail.badge).toBe("Not connected");
      expect(gmail.actions.some((a) => a.stepId === `sync:${MAILBOX}`)).toBe(false);
      const space = connectionsSpace(
        mailboxes({
          mailboxes: [box({ status: "disconnected" }, { state: "syncing", runId: "50000000-0000-4000-8000-000000000009" })],
        }),
        READY,
        null,
      );
      expect(JSON.stringify(space)).not.toContain("Syncing");
      expect(space.status.label).toBe("0 connected");
    });

    /* The honest gap, while it is real — and it disappears on its own when a reader exists. */
    it("names the missing reader only while the server says nothing can read", () => {
      const withoutReader = connectionsSpace(connected(), READY, null);
      expect(withoutReader.blocks.some((b) => b.id === "sync-unavailable")).toBe(true);

      const withReader = connectionsSpace(
        mailboxes({ mailboxes: [box({}, { state: "idle", canStart: true, cannotStartReason: null })] }),
        READY,
        null,
      );
      expect(withReader.blocks.some((b) => b.id === "sync-unavailable")).toBe(false);
    });
  });

  it("passes on what a failed connect attempt said, in the server's words", () => {
    const space = connectionsSpace(mailboxes(), READY, "No Gmail client is configured here.");
    const note = space.blocks.find((b) => b.id === "not-configured");
    expect(note?.type === "note" ? note.text : "").toBe("No Gmail client is configured here.");
  });

  it("draws loading and error states of its own", () => {
    expect(connectionsSpace(undefined, { loading: true, error: null }, null).state).toBe("loading");
    expect(connectionsSpace(undefined, { loading: false, error: "No." }, null).state).toBe("error");
  });
});

describe("the Activity Space", () => {
  it("leads with the promise that makes it ignorable", () => {
    const space = activitySpace(runList(), READY, JOB_FILTERS, "all");
    expect(space.blocks[0]?.id).toBe("observation");
    expect(space.blocks[0]?.type).toBe("note");
    const note = space.blocks[0];
    expect(note?.type === "note" ? note.title : "").toBe("Nothing important lives only here");
  });

  /* The run's own vocabulary, not Work's, and none of the banned words. */
  it("uses the run vocabulary and never Work's", () => {
    const space = activitySpace(runList(), READY, JOB_FILTERS, "all");
    const text = JSON.stringify(space);
    expect(text).not.toMatch(/Needs you/);
    expect(text).not.toMatch(/"Waiting"/);
    expect(text).not.toMatch(/"Completed"/);
    const rows = space.blocks.find((b) => b.id === "group-stopped");
    if (rows?.type !== "rows") throw new Error("expected rows");
    expect(rows.label).toBe("Stopped");
    expect(rows.rows[0]?.badge).toBe("Stopped");
  });

  /* The promise, enforced: a stopped run leads to the work a person owns, first. */
  it("sends a stopped run to the work a person owns", () => {
    const space = activitySpace(runList(), READY, JOB_FILTERS, "all");
    const rows = space.blocks.find((b) => b.id === "group-stopped");
    if (rows?.type !== "rows") throw new Error("expected rows");
    const actions = rows.rows[0]!.actions;
    expect(actions[0]?.label).toBe("Open the work →");
    expect(actions[0]?.to?.path).toBe(`/r/${ITEM}`);
    expect(actions[0]?.to?.spaceKind).toBe("work_item");
  });

  /*
   * The whole rule, in one test: a run has exactly three words, and "waiting" is not one of them.
   * A run that cannot continue until an outside party answers is still open, so it reads Working,
   * and who must respond is supporting text — never the status.
   */
  it("gives a run waiting on an outside party the Working status, and names who must respond", () => {
    const waiting = runList({
      groups: [
        {
          key: "working",
          title: "ignored",
          items: [
            {
              ...runList().groups[0]!.items[0]!,
              run: { ...runList().groups[0]!.items[0]!.run, status: "paused", ended_at: null },
              group: "working",
              needsPerson: false,
              waitingFor: "Jubilee must respond before this continues.",
            },
          ],
        },
      ],
      counts: { all: 1, working: 1, stopped: 0, finished: 0 },
    });
    const space = activitySpace(waiting, READY, JOB_FILTERS, "all");
    const rows = space.blocks.find((b) => b.id === "group-working");
    if (rows?.type !== "rows") throw new Error("expected rows");
    expect(rows.label).toBe("Working");
    expect(rows.rows[0]?.badge).toBe("Working");
    expect(rows.rows[0]?.note).toContain("Jubilee must respond before this continues.");
  });

  it("uses exactly three words for a run, and never a party as a status", () => {
    const every = JSON.stringify([
      activitySpace(runList(), READY, JOB_FILTERS, "all"),
      activitySpace(runList({ groups: [] }), READY, JOB_FILTERS, "all"),
    ]);
    for (const banned of ["Waiting on someone else", "Stopped for a person", "Paused", "Couldn't finish", "Running"]) {
      expect(every, banned).not.toContain(banned);
    }
    expect(JOB_FILTERS.map((f) => f.label)).toEqual(["All", "Working", "Stopped", "Finished"]);
  });

  it("states a run's derived progress in words rather than drawing a bar", () => {
    const space = activitySpace(runList(), READY, JOB_FILTERS, "all");
    const rows = space.blocks.find((b) => b.id === "group-stopped");
    if (rows?.type !== "rows") throw new Error("expected rows");
    expect(rows.rows[0]?.note).toMatch(/40% of its steps/);
  });

  it("offers the five job filters, with counts from the same read", () => {
    const space = activitySpace(runList(), READY, JOB_FILTERS, "stopped");
    // Exactly three words, plus "everything still open".
    expect(space.filters.map((f) => f.label)).toEqual(["All", "Working", "Stopped", "Finished"]);
    expect(space.filters.find((f) => f.id === "stopped")?.active).toBe(true);
    expect(space.filters.find((f) => f.id === "all")?.count).toBe(1);
  });

  it("keeps the promise in view even when nothing has run", () => {
    const space = activitySpace(runList({ groups: [] }), READY, JOB_FILTERS, "all");
    expect(space.status.label).toBe("Nothing running");
    expect(space.blocks.map((b) => b.id)).toEqual(["observation"]);
  });

  it("says the read failed, and where the work still is", () => {
    const space = activitySpace(undefined, { loading: false, error: "No." }, JOB_FILTERS, "all");
    expect(space.state).toBe("error");
    expect(space.emptyState?.body).toMatch(/anything needing a person is in Work/);
  });
});

describe("one run", () => {
  const detail = runDetailResponseSchema.parse({
    run: runList().groups[0]!.items[0]!.run,
    events: [
      { id: 1, run_id: RUN, seq: 1, kind: "step", message: "Opened the document", created_at: "2026-08-20T08:01:00.000Z" },
      { id: 2, run_id: RUN, seq: 2, kind: "error", message: "Page 2 has no readable text", created_at: "2026-08-20T08:04:00.000Z" },
    ],
    relatedWork: { id: ITEM, title: "Confirm the sum insured", taskStatus: "needs_you", nowStep: "Confirm the sum insured" },
    evidence: [{ label: "Uploaded file", reference: "schedule.pdf", recordedBy: "Amina Yusuf", recordedAt: null }],
    waitingFor: null,
    recovery: [
      { kind: "open_work", label: "Open the work", disabledReason: null },
      { kind: "retry", label: "Read it again", disabledReason: null },
    ],
  });

  it("is its own Space, keyed by the run", () => {
    const space = runSpace(detail, { loading: false, error: null, missing: false }, RUN);
    expect(space.self.recordType).toBe("run");
    expect(space.self.recordId).toBe(RUN);
    expect(space.status.label).toBe("Stopped");
  });

  it("shows what ASAP did, step by step, in its own words", () => {
    const space = runSpace(detail, { loading: false, error: null, missing: false }, RUN);
    const timeline = space.blocks.find((b) => b.id === "what-happened");
    if (timeline?.type !== "timeline") throw new Error("expected timeline");
    expect(timeline.events.map((e) => e.text)).toEqual([
      "Opened the document",
      "Page 2 has no readable text",
    ]);
    expect(timeline.events[1]?.tone).toBe("attention");
  });

  it("carries the run's evidence, and the work a person owns", () => {
    const space = runSpace(detail, { loading: false, error: null, missing: false }, RUN);
    expect(space.evidence[0]?.reference).toBe("schedule.pdf");
    expect(space.related[0]?.path).toBe(`/r/${ITEM}`);
  });

  it("says a missing run is missing, and where the work still is", () => {
    const space = runSpace(undefined, { loading: false, error: null, missing: true }, RUN);
    expect(space.state).toBe("error");
    expect(space.emptyState?.body).toMatch(/is in Work/);
  });

  /*
   * §34 again: offered, disabled, with the reason. A vanished control teaches a person the
   * capability does not exist when in fact it has not been built.
   */
  it("offers recovery, and says plainly which parts nothing performs yet", () => {
    const space = runSpace(detail, { loading: false, error: null, missing: false }, RUN);
    const gate = space.blocks.find((b) => b.id === "recovery");
    if (gate?.type !== "approval_gate") throw new Error("expected approval_gate");
    const open = gate.actions.find((a) => a.verb === "open")!;
    expect(open.to?.path).toBe(`/r/${ITEM}`);
    expect(open.disabledReason).toBeNull();
    const retry = gate.actions.find((a) => a.stepId === "retry")!;
    expect(retry.disabledReason).toMatch(/Nothing performs this yet/);
  });

  it("has no progress figure anywhere", () => {
    const space = runSpace(detail, { loading: false, error: null, missing: false }, RUN);
    expect(JSON.stringify(space)).not.toMatch(/progress/i);
  });
});

describe("on screen", () => {
  it("renders Activity with its promise and its rows", async () => {
    await renderInRouter(<SpaceFrameView space={activitySpace(runList(), READY, JOB_FILTERS, "all")} />);
    expect(screen.getByRole("heading", { level: 1, name: "What ASAP has been doing" })).toBeInTheDocument();
    expect(screen.getByText("Nothing important lives only here")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the work →" })).toHaveAttribute("href", `/r/${ITEM}`);
  });

  it("renders Connections without ever claiming a connection", async () => {
    await renderInRouter(<SpaceFrameView space={connectionsSpace(mailboxes(), READY, null)} />);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    // Two providers, two buttons: the one this deployment can use, and the one it cannot.
    const [gmail, microsoft] = screen.getAllByRole("button", { name: "Connect" });
    expect(gmail).toBeEnabled();
    expect(microsoft).toBeDisabled();
    expect(screen.getByText(/no Microsoft credentials/)).toBeInTheDocument();
  });
});
