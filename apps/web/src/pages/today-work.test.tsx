import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attentionResponseSchema,
  workListResponseSchema,
  type AttentionResponse,
  type WorkItemRow,
  type WorkListResponse,
} from "@asap/schema";
import { todaySpace, workSpace, holderLabel } from "../live/space-adapters.js";

/**
 * Today and Work, from the real API shapes.
 *
 * The fixtures below are parsed with the endpoints' own Zod schemas before they are used, so a
 * test cannot pass against a response the API could not produce. That is the point: these prove
 * the *mapping*, and the API proves the rows (`apps/api/test/attention.test.ts`).
 *
 * The vocabulary rules are asserted here rather than left to review. "Needs you" is never written
 * and "Waiting" never appears alone: a row held by an outside party names the party and the date.
 */

const ORG = "10000000-0000-4000-8000-00000000000a";
const CLIENT = "20000000-0000-4000-8000-000000000001";
const OWNER = "30000000-0000-4000-8000-0000000000aa";
const NOW = new Date("2026-08-20T09:00:00.000Z");

function item(over: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    organization_id: ORG,
    title: "Confirm cover with CIC",
    kind: "placement",
    client_id: CLIENT,
    policy_period_id: null,
    insurer_id: null,
    class_of_business: null,
    owner_id: OWNER,
    task_status: "needs_you",
    task_party: null,
    task_since: "2026-08-12T00:00:00.000Z",
    task_next_check: null,
    cover_status: null,
    cover_inception_at: null,
    money_status: null,
    reason: "No confirmation is recorded against the request sent on 12 Aug.",
    steps: [],
    exception: null,
    version: 1,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-12T00:00:00.000Z",
    completed_at: null,
    deleted_at: null,
    ...over,
  } as WorkItemRow;
}

function attention(rows: WorkItemRow[], over: Partial<AttentionResponse> = {}): AttentionResponse {
  return attentionResponseSchema.parse({
    organization: { id: ORG, name: "Acme Insurance Brokers" },
    generatedAt: NOW.toISOString(),
    items: rows.map((row, i) => ({
      section: row.task_status === "with_party" ? "checks_due" : "needs_you",
      rank: i + 1,
      score: 48,
      item: row,
      reason: row.reason,
      signals: [
        {
          id: "cover_uncertain",
          because: "Cover was requested and no confirmation is recorded.",
          points: 48,
        },
      ],
      nowStep: null,
      client: { id: CLIENT, name: "Acme Manufacturing Ltd" },
      owner: { id: OWNER, name: "Amina Yusuf" },
      priority: "high",
      period: null,
      facts: [
        {
          label: "Insurer confirmation",
          condition: "missing",
          reference: null,
          recordedBy: null,
          recordedAt: null,
          derivedFrom: null,
        },
      ],
      runFailure: null,
      links: { work: row.source_type === "placement" ? `/placements/${row.source_id}` : `/r/${row.id}`, client: `/files/${CLIENT}`, policy: null, ask: row.title },
    })),
    sections: [
      { key: "needs_you", label: "What matters now", visible: rows.length, returned: rows.length },
      { key: "checks_due", label: "Checks due", visible: 0, returned: 0 },
    ],
    orphanRuns: [],
    degraded: [],
    cap: 12,
    book: { clients: 4, policies: 6, work: rows.length },
    ...over,
  });
}

function workList(rows: WorkItemRow[], over: Partial<WorkListResponse> = {}): WorkListResponse {
  return workListResponseSchema.parse({
    organization: { id: ORG, name: "Acme Insurance Brokers" },
    view: "needs",
    label: "Your work",
    generatedAt: NOW.toISOString(),
    items: rows.map((row, i) => ({
      rank: i + 1,
      item: row,
      reason: row.reason,
      nowStep: { id: "confirm", label: "Confirm cover", actor: "insurer" },
      runFailure: null,
      client: { id: CLIENT, name: "Acme Manufacturing Ltd" },
      period: null,
      owner: { id: OWNER, name: "Amina Yusuf" },
      priority: "high",
      links: { work: row.source_type === "placement" ? `/placements/${row.source_id}` : `/r/${row.id}`, client: `/files/${CLIENT}`, policy: null, ask: row.title },
      facts: [],
      signals: [
        {
          id: "cover_uncertain",
          because: "Cover was requested and no confirmation is recorded.",
          points: 48,
        },
      ],
    })),
    visible: rows.length,
    returned: rows.length,
    cap: 50,
    counts: { needs: rows.length, with: 2, progress: 1, review: 0, recent: 3, done: 5 },
    degraded: [],
    ...over,
  });
}

const READY = { loading: false, error: false };
const PERMS = { canAssign: true, people: [] };

beforeEach(() => {
  globalThis.localStorage?.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.localStorage?.clear();
});

describe("Today, from GET /attention", () => {
  it("is titled with the prototype's own question and counts what is open", () => {
    const space = todaySpace(attention([item()]), READY);
    expect(space.title).toBe("What matters now");
    expect(space.self.label).toBe("TODAY");
    expect(space.status.label).toBe("1 open");
  });

  it("builds a row from the real response, naming the client, the kind and the owner", () => {
    const space = todaySpace(attention([item()]), READY);
    const rows = space.blocks.find((b) => b.id === "prioritised");
    expect(rows?.type).toBe("rows");
    const row = rows?.type === "rows" ? rows.rows[0]! : null;
    expect(row?.title).toBe("Confirm cover with CIC");
    expect(row?.note).toContain("Acme Manufacturing Ltd");
    expect(row?.note).toContain("Amina Yusuf");
    expect(row?.badge).toBe("High");
  });

  /* The engine's own reason, plus the named signals. Never composed here and never by a model. */
  it("carries the recorded reason as the answer to 'Why is this here?'", () => {
    const space = todaySpace(attention([item()]), READY);
    const rows = space.blocks.find((b) => b.id === "prioritised");
    const row = rows?.type === "rows" ? rows.rows[0]! : null;
    expect(row?.why).toContain("No confirmation is recorded against the request sent on 12 Aug.");
    expect(row?.why).toContain("Cover was requested and no confirmation is recorded.");
  });

  it("opens the record-specific Space the server named, with the right identity", () => {
    const space = todaySpace(attention([item()]), READY);
    const rows = space.blocks.find((b) => b.id === "prioritised");
    const row = rows?.type === "rows" ? rows.rows[0]! : null;
    expect(row?.related?.path).toBe("/r/00000000-0000-4000-8000-000000000001");
    expect(row?.related?.spaceKind).toBe("placement");
    expect(row?.related?.recordType).toBe("work_item");
    expect(row?.related?.recordId).toBe("00000000-0000-4000-8000-000000000001");
    expect(row?.actions[0]?.verb).toBe("open");
  });

  it("carries an observation from ASAP, and it asks nothing of anyone", () => {
    const space = todaySpace(attention([item()]), READY);
    const note = space.blocks.find((b) => b.id === "observation");
    expect(note?.type).toBe("note");
    expect(note?.actions).toEqual([]);
  });

  it("offers the prototype's quick actions, all to routes the app serves", () => {
    const space = todaySpace(attention([item()]), READY);
    const quick = space.blocks.find((b) => b.id === "quick");
    const paths =
      quick?.type === "rows" ? quick.rows.flatMap((r) => r.actions.map((a) => a.to?.path)) : [];
    expect(paths).toEqual(["/ask", "/import", "/email", "/new", "/work"]);
  });

  it("is not a dashboard: no block is a metric or a chart", () => {
    const space = todaySpace(attention([item()]), READY);
    for (const block of space.blocks) {
      expect(["rows", "note"]).toContain(block.type);
    }
  });

  /*
   * D-068: "nothing needs you" and "you have not put anything in yet" are different facts, and a
   * new brokerage deserves the second one.
   */
  it("tells a brand-new brokerage it is new, rather than congratulating it", () => {
    const space = todaySpace(attention([], { book: { clients: 0, policies: 0, work: 0 } }), READY);
    expect(space.state).toBe("empty");
    expect(space.emptyState?.heading).toBe("There is nothing on file yet.");
    expect(space.emptyState?.actions.map((a) => a.to?.path)).toEqual(["/import", "/email"]);
  });

  it("tells a brokerage with a book that nothing needs a person, and where the rest is", () => {
    const space = todaySpace(
      attention([], { book: { clients: 12, policies: 20, work: 7 } }),
      READY,
    );
    expect(space.state).toBe("empty");
    expect(space.emptyState?.heading).toBe("Nothing needs a person right now.");
    expect(space.emptyState?.body).toContain("7 items are on file");
  });

  it("draws a loading state rather than an empty screen", () => {
    expect(todaySpace(undefined, { loading: true, error: false }).state).toBe("loading");
  });

  it("says the read failed, and that nothing was changed", () => {
    const space = todaySpace(undefined, { loading: false, error: true });
    expect(space.state).toBe("error");
    expect(space.emptyState?.body).toContain("Nothing has been changed");
  });

  /* Partial success (§36): what could not be read is said, not passed off as an empty result. */
  it("passes on what the server could not read", () => {
    const space = todaySpace(
      attention([item()], {
        degraded: [{ what: "Client names", because: "The client rows could not be read." }],
      }),
      READY,
    );
    expect(space.degraded).toHaveLength(1);
    expect(space.degraded[0]?.what).toBe("Client names");
  });

  it("cites the facts behind a row where the server recorded a reference", () => {
    const withRef = attention([item()]);
    withRef.items[0]!.facts = [
      {
        label: "Insurer confirmation",
        condition: "known",
        reference: "CIC email, 12 Aug",
        recordedBy: "Amina Yusuf",
        recordedAt: null,
        derivedFrom: null,
      },
    ];
    const space = todaySpace(withRef, READY);
    const rows = space.blocks.find((b) => b.id === "prioritised");
    const row = rows?.type === "rows" ? rows.rows[0]! : null;
    expect(row?.evidence[0]?.reference).toBe("CIC email, 12 Aug");
  });
});

describe("Work, from GET /work", () => {
  it("offers the five main views, in order, with counts from the same read", () => {
    const space = workSpace(workList([item()]), READY, PERMS);
    expect(space.filters.map((f) => f.label)).toEqual([
      "Your work",
      "With others",
      "In progress",
      "Done",
      "Recent",
    ]);
    expect(space.filters.map((f) => f.count)).toEqual([1, 2, 1, 5, 3]);
  });

  /* Filters are links, so a filter changes what the server returns rather than hiding rows. */
  it("makes every view a route rather than a browser-side filter", () => {
    const space = workSpace(workList([item()]), READY, PERMS);
    expect(space.filters.map((f) => f.to)).toEqual([
      "/work?view=needs",
      "/work?view=with",
      "/work?view=progress",
      "/work?view=done",
      "/work?view=recent",
    ]);
  });

  it("marks the active view and no other", () => {
    const space = workSpace(
      workList([item()], { view: "with", label: "With others" }),
      READY,
      PERMS,
    );
    expect(space.filters.filter((f) => f.active).map((f) => f.id)).toEqual(["with"]);
  });

  /* "For review" is contextual, never the name for all human work. */
  it("does not put For review among the main views", () => {
    const space = workSpace(workList([item()]), READY, PERMS);
    expect(space.filters.map((f) => f.id)).not.toContain("review");
  });

  it("shows a placement's Work from structured server fields, and opens the placement itself", () => {
    const row = firstRow(
      workSpace(
        workList([
          item({
            title: "Acme motor fleet placement — 2027: cover confirmation requested",
            kind: "placement",
            task_status: "with_party",
            task_party: "Jubilee",
            task_since: "2026-08-12T00:00:00.000Z",
            reason: "The request was sent and the insurer has not answered.",
            source_type: "placement",
            source_id: "40000000-0000-4000-8000-00000000000a",
            reason_code: "awaiting_insurer",
            required_action: "Record the insurer's answer when it arrives, with its evidence.",
            evidence_needed: "The insurer's confirmation, decline or query.",
            outcome_after: "The confirmation is checked against what the client accepted.",
          }),
        ]),
        READY,
        PERMS,
      ),
    );
    expect(row.title).toBe("Acme motor fleet placement — 2027: cover confirmation requested");
    expect(row.note).toMatch(/With Jubilee since/);
    expect(row.why).toContain("The request was sent and the insurer has not answered.");
    expect(row.why).toContain("To do: Record the insurer's answer when it arrives, with its evidence.");
    expect(row.why).toContain("Evidence needed: The insurer's confirmation, decline or query.");
    expect(row.why).toContain("Then: The confirmation is checked against what the client accepted.");
    expect(row.related?.path).toBe("/placements/40000000-0000-4000-8000-00000000000a");
    for (const banned of [/Needs you/, /^Waiting$/, /Active cover/]) {
      expect(`${row.title} ${row.note} ${row.badge ?? ""}`).not.toMatch(banned);
    }
  });

  it("builds a row with owner, holder, next check, priority, reason and where it opens", () => {
    const row = firstRow(
      workSpace(workList([item({ task_next_check: "2026-08-25T00:00:00.000Z" })]), READY, PERMS),
    );
    expect(row.note).toContain("Amina Yusuf");
    expect(row.note).toContain("Your work");
    expect(row.note).toContain("next check");
    expect(row.badge).toBe("High");
    expect(row.why).toContain("No confirmation is recorded");
    expect(row.related?.path).toBe("/r/00000000-0000-4000-8000-000000000001");
    expect(row.actions.map((a) => a.verb)).toEqual(["assign", "open"]);
  });

  it("says unassigned rather than leaving the owner blank", () => {
    const rows = workList([item({ owner_id: null })]);
    rows.items[0]!.owner = null;
    expect(firstRow(workSpace(rows, READY, PERMS)).note).toContain("unassigned");
  });

  /* The mandate: name the party and the date. Never a bare "Waiting". */
  it("names the outside party and the date it went to them", () => {
    const row = firstRow(
      workSpace(
        workList([
          item({
            task_status: "with_party",
            task_party: "CIC",
            task_since: "2026-08-12T00:00:00.000Z",
          }),
        ]),
        READY,
        PERMS,
      ),
    );
    expect(row.note).toContain("With CIC since 12 Aug");
    expect(row.note).not.toMatch(/\bWaiting\b/);
  });

  it("names each of the three parties the contract calls out", () => {
    const cases: [string, string][] = [
      ["CIC", "With CIC since 12 Aug"],
      ["client", "With client since 14 Aug"],
      ["assessor", "With assessor since 16 Aug"],
    ];
    const dates = [
      "2026-08-12T00:00:00.000Z",
      "2026-08-14T00:00:00.000Z",
      "2026-08-16T00:00:00.000Z",
    ];
    cases.forEach(([party, expected], i) => {
      expect(
        holderLabel(item({ task_status: "with_party", task_party: party, task_since: dates[i]! })),
      ).toBe(expected);
    });
  });

  /*
   * A `with_party` row that arrives without both is a defect upstream, not a state to draw. It is
   * shown as the brokerage's own work rather than labelled with a word that means nothing.
   */
  it("refuses to render a party label it cannot complete", () => {
    expect(
      holderLabel({
        ...item({ task_status: "with_party" }),
        task_party: null,
        task_since: null,
      } as WorkItemRow),
    ).toBe("Your work");
  });

  /*
   * A completed item has nothing pulling at it, so it has no signals — which is why the Work
   * contract allows an empty list where Discover's does not. The row must still render, and must
   * not be given an invented reason.
   */
  it("renders a row with no signals at all", () => {
    const rows = workList(
      [item({ task_status: "done", completed_at: "2026-08-19T00:00:00.000Z" })],
      { view: "done" },
    );
    rows.items[0]!.signals = [];
    rows.items[0]!.priority = "low";
    const row = firstRow(workSpace(rows, READY, PERMS));
    expect(row.badge).toBe("Done");
    expect(row.why).toBe(rows.items[0]!.reason);
  });

  it("shows a completed item as done rather than giving it a priority", () => {
    const rows = workList(
      [item({ task_status: "done", completed_at: "2026-08-19T00:00:00.000Z" })],
      { view: "done" },
    );
    const row = firstRow(workSpace(rows, READY, PERMS));
    expect(row.badge).toBe("Done");
    expect(row.badgeTone).toBe("done");
  });

  it("says plainly what is not permitted, rather than hiding the control", () => {
    const row = firstRow(workSpace(workList([item()]), READY, { canAssign: false, people: [] }));
    const assign = row.actions.find((a) => a.verb === "assign");
    expect(assign?.notPermittedReason).toContain("not change who owns it");
    const space = workSpace(workList([item()]), READY, { canAssign: false, people: [] });
    expect(space.permission.canAssign).toBe(false);
    expect(space.permission.note).toContain("not change who owns it");
  });

  it("gives every empty view its own words", () => {
    const headings = (["needs", "with", "progress", "done", "recent"] as const).map(
      (view) =>
        workSpace(
          workList([], {
            view,
            counts: { needs: 0, with: 0, progress: 0, review: 0, recent: 0, done: 0 },
          }),
          READY,
          PERMS,
        ).emptyState?.heading,
    );
    expect(new Set(headings).size).toBe(5);
    expect(headings[1]).toBe("No item is with an outside party.");
    for (const h of headings) expect(h).not.toMatch(/\bWaiting\b|Needs you/);
  });

  it("draws loading and error states of its own", () => {
    expect(workSpace(undefined, { loading: true, error: false }, PERMS).state).toBe("loading");
    const failed = workSpace(undefined, { loading: false, error: true }, PERMS);
    expect(failed.state).toBe("error");
    expect(failed.emptyState?.body).toContain("other views may still work");
  });

  it("keeps its filters while loading, so a view can still be chosen", () => {
    expect(workSpace(undefined, { loading: true, error: false }, PERMS).filters).toHaveLength(5);
  });
});

describe("the vocabulary, in what these adapters produce", () => {
  const everything = () => {
    const parties = item({
      task_status: "with_party",
      task_party: "CIC",
      task_since: "2026-08-12T00:00:00.000Z",
    });
    return JSON.stringify([
      todaySpace(attention([item(), parties]), READY),
      todaySpace(attention([]), READY),
      todaySpace(attention([], { book: { clients: 0, policies: 0, work: 0 } }), READY),
      todaySpace(undefined, { loading: true, error: false }),
      todaySpace(undefined, { loading: false, error: true }),
      ...(["needs", "with", "progress", "done", "recent"] as const).map((view) =>
        workSpace(workList([item(), parties], { view }), READY, PERMS),
      ),
      workSpace(workList([], { view: "with" }), READY, PERMS),
      workSpace(undefined, { loading: false, error: true }, PERMS),
    ]);
  };

  it("never writes 'Needs you'", () => {
    expect(everything()).not.toMatch(/Needs you/i);
  });

  /* A bare "Waiting" is banned; "Waiting for verification" beside a fact is a different word. */
  it("never uses 'Waiting' as a state on its own", () => {
    const text = everything();
    const bare = [...text.matchAll(/Waiting(?! for verification)/g)];
    expect(bare).toEqual([]);
  });

  it("calls the views what D-075 calls them", () => {
    const labels = workSpace(workList([item()]), READY, PERMS).filters.map((f) => f.label);
    expect(labels).toEqual(["Your work", "With others", "In progress", "Done", "Recent"]);
  });

  it("never calls a Space a Space on screen", () => {
    expect(everything()).not.toMatch(/\bSpace\b/);
  });
});

function firstRow(space: ReturnType<typeof workSpace>) {
  const block = space.blocks.find((b) => b.id === "work");
  if (block?.type !== "rows") throw new Error("expected a rows block");
  return block.rows[0]!;
}
