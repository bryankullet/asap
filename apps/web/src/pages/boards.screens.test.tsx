import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attentionResponseSchema, workListResponseSchema, type WorkItemRow } from "@asap/schema";
import { resetWorkspaceTabs } from "../shell/workspace-tabs.js";
import { renderBoards } from "../test-utils.js";

/**
 * A signed-in person. `api.ts` refuses to call anything without a token — which is the point of
 * it — so a screen test has to be one, or every request fails before it reaches the stub and the
 * board renders its loading state forever.
 */
vi.mock("../lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signOut: async () => ({ error: null }),
    },
  },
}));

/**
 * Today and Work as a person meets them: through the real shell, the real route tree and a real
 * API response shape.
 *
 * What these prove that the adapter tests cannot: that the legacy page frame is gone, that there
 * is exactly one heading on the screen, that a tab appears for each board and Ask follows it, and
 * that a filter is a link that changes the request rather than hiding rows already in the browser.
 */

const ORG = "10000000-0000-4000-8000-00000000000a";
const CLIENT = "20000000-0000-4000-8000-000000000001";
const OWNER = "30000000-0000-4000-8000-0000000000aa";
const ID1 = "00000000-0000-4000-8000-000000000001";
const ID2 = "00000000-0000-4000-8000-000000000002";
const NOW = "2026-08-20T09:00:00.000Z";
const ORGANIZATION = {
  id: ORG,
  name: "Acme Insurance Brokers",
  country: "KE",
  currency: "KES",
  timezone: "Africa/Nairobi",
};

function item(over: Partial<WorkItemRow> = {}): WorkItemRow {
  return {
    id: ID1,
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

const signal = {
  id: "cover_uncertain",
  because: "Cover was requested and no confirmation is recorded.",
  points: 48,
};

const attention = (rows: WorkItemRow[], book = { clients: 4, policies: 6, work: rows.length }) =>
  attentionResponseSchema.parse({
    organization: { id: ORG, name: "Acme Insurance Brokers" },
    generatedAt: NOW,
    items: rows.map((row, i) => ({
      section: "needs_you",
      rank: i + 1,
      score: 48,
      item: row,
      reason: row.reason,
      signals: [signal],
      nowStep: null,
      client: { id: CLIENT, name: "Acme Manufacturing Ltd" },
      owner: { id: OWNER, name: "Amina Yusuf" },
      priority: "high",
      period: null,
      facts: [],
      runFailure: null,
      links: { work: `/r/${row.id}`, client: `/files/${CLIENT}`, policy: null, ask: row.title },
    })),
    sections: [
      { key: "needs_you", label: "What matters now", visible: rows.length, returned: rows.length },
      { key: "checks_due", label: "Checks due", visible: 0, returned: 0 },
    ],
    orphanRuns: [],
    degraded: [],
    cap: 12,
    book,
  });

const work = (view: string, rows: WorkItemRow[]) =>
  workListResponseSchema.parse({
    organization: { id: ORG, name: "Acme Insurance Brokers" },
    view,
    label: view,
    generatedAt: NOW,
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
      links: { work: `/r/${row.id}`, client: `/files/${CLIENT}`, policy: null, ask: row.title },
      facts: [],
      signals: [signal],
    })),
    visible: rows.length,
    returned: rows.length,
    cap: 50,
    counts: { needs: 1, with: 2, progress: 1, review: 0, recent: 3, done: 5 },
    degraded: [],
  });

/** Rows per view, so a view change has to reach the server to change what is on screen. */
const VIEWS: Record<string, WorkItemRow[]> = {
  needs: [item()],
  with: [
    item({
      id: ID2,
      title: "Chase CIC for the endorsement",
      task_status: "with_party",
      task_party: "CIC",
      task_since: "2026-08-12T00:00:00.000Z",
    }),
  ],
  progress: [item({ id: ID2, title: "Draft the renewal terms", task_status: "in_progress" })],
  done: [
    item({ id: ID2, title: "Issued the certificate", task_status: "done", completed_at: NOW }),
  ],
  recent: [item()],
};

beforeEach(() => {
  globalThis.localStorage?.clear();
  resetWorkspaceTabs();
});
afterEach(() => {
  vi.unstubAllGlobals();
  globalThis.localStorage?.clear();
  resetWorkspaceTabs();
});

describe("Today, on screen", () => {
  it("leads with the prototype's question and the count, in the Space frame's own positions", async () => {
    const { container } = await renderBoards("/today", { attention: attention([item()]) });
    // The heading is the same in the loading state, so the row is what says the response arrived.
    await screen.findByText("Confirm cover with CIC");
    expect(screen.getByRole("heading", { level: 1, name: "What matters now" })).toBeInTheDocument();
    expect(container.querySelector(".sp-eyebrow")?.textContent).toBe("TODAY");
    expect(container.querySelector(".sp-status")?.textContent).toBe("1 open");
  });

  /* A new shell around an old page design is not parity. */
  it("renders no legacy page frame and exactly one heading", async () => {
    const { container } = await renderBoards("/today", { attention: attention([item()]) });
    await screen.findByRole("heading", { level: 1, name: "What matters now" });
    expect(container.querySelectorAll(".screen-title, .page-head, .page-body")).toHaveLength(0);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
    expect(screen.queryByText("Discover")).toBeNull();
  });

  it("shows the row from the response and opens its own record", async () => {
    await renderBoards("/today", { attention: attention([item()]) });
    const row = await screen.findByText("Confirm cover with CIC");
    expect(row).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open →" })).toHaveAttribute("href", `/r/${ID1}`);
  });

  it("answers why a row is there, on one click, from the recorded reason", async () => {
    await renderBoards("/today", { attention: attention([item()]) });
    await screen.findByText("Confirm cover with CIC");
    await userEvent.click(screen.getByRole("button", { name: "Why is this here?" }));
    expect(
      screen.getByText(/No confirmation is recorded against the request sent on 12 Aug/),
    ).toBeInTheDocument();
  });

  it("shows the quick actions as links to routes the app serves", async () => {
    await renderBoards("/today", { attention: attention([item()]) });
    await screen.findByText("Ask about this brokerage");
    expect(screen.getByRole("link", { name: "Open Ask" })).toHaveAttribute("href", "/ask");
    expect(screen.getByRole("link", { name: "Open import" })).toHaveAttribute("href", "/import");
  });

  it("tells a brand-new brokerage it is new", async () => {
    await renderBoards("/today", {
      attention: attention([], { clients: 0, policies: 0, work: 0 }),
    });
    expect(await screen.findByText("There is nothing on file yet.")).toBeInTheDocument();
    expect(screen.queryByText(/up to date|Nothing needs a person/i)).toBeNull();
  });

  it("tells a brokerage with a book that nothing needs a person", async () => {
    await renderBoards("/today", {
      attention: attention([], { clients: 9, policies: 12, work: 4 }),
    });
    expect(await screen.findByText("Nothing needs a person right now.")).toBeInTheDocument();
  });

  it("says the read failed rather than showing an empty board", async () => {
    await renderBoards("/today", { status: 503 });
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be read/i);
    expect(screen.queryByText(/Nothing needs a person/)).toBeNull();
  });
});

describe("Work, on screen", () => {
  it("renders the five views as links, with their counts", async () => {
    await renderBoards("/work", { work: (v) => work(v, VIEWS[v] ?? []) });
    await screen.findByText("Confirm cover with CIC");
    const views = screen.getByRole("navigation", { name: "Views" });
    expect(
      within(views)
        .getAllByRole("link")
        .map((a) => a.textContent?.replace(/\s+/g, " ").trim()),
    ).toEqual(["Your work 1", "With others 2", "In progress 1", "Done 5", "Recent 3"]);
  });

  it("renders no legacy page frame and exactly one heading", async () => {
    const { container } = await renderBoards("/work", { work: (v) => work(v, VIEWS[v] ?? []) });
    await screen.findByRole("heading", { level: 1, name: "All work" });
    expect(container.querySelectorAll(".screen-title, .page-head, .page-body")).toHaveLength(0);
    expect(container.querySelectorAll("h1")).toHaveLength(1);
  });

  /*
   * The filter has to reach the server: these rows differ per view, so a browser-side filter would
   * show the wrong ones. This also proves the view survives in the URL.
   */
  it("changes what the server returns when a view is chosen", async () => {
    const { router } = await renderBoards("/work", { work: (v) => work(v, VIEWS[v] ?? []) });
    expect(await screen.findByText("Confirm cover with CIC")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: /With others/ }));
    expect(await screen.findByText("Chase CIC for the endorsement")).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ view: "with" });
    expect(screen.queryByText("Confirm cover with CIC")).toBeNull();
  });

  it("names the outside party and the date, never a bare Waiting", async () => {
    await renderBoards("/work?view=with", { work: (v) => work(v, VIEWS[v] ?? []) });
    expect(await screen.findByText(/With CIC since 12 Aug/)).toBeInTheDocument();
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/Needs you/i);
    expect(body).not.toMatch(/Waiting(?! for verification)/);
  });

  it("renders each of the five views from its own response", async () => {
    for (const [view, expected] of [
      ["needs", "Confirm cover with CIC"],
      ["with", "Chase CIC for the endorsement"],
      ["progress", "Draft the renewal terms"],
      ["done", "Issued the certificate"],
      ["recent", "Confirm cover with CIC"],
    ] as const) {
      const { unmount } = await renderBoards(`/work?view=${view}`, {
        work: (v) => work(v, VIEWS[v] ?? []),
      });
      expect(await screen.findByText(expected), view).toBeInTheDocument();
      unmount();
    }
  });

  it("offers Assign to a role that may, and refuses it with a reason to one that may not", async () => {
    const both = { work: (v: string) => work(v, VIEWS[v] ?? []) };
    const allowed = await renderBoards("/work", both);
    await screen.findByText("Confirm cover with CIC");
    expect(screen.getByRole("button", { name: "Assign" })).toBeEnabled();
    allowed.unmount();

    await renderBoards("/work", {
      ...both,
      // The same person, with a role that may read work and not reassign it.
      me: {
        user: {
          id: "90000000-0000-4000-8000-000000000002",
          email: "reader@acme.test",
          display_name: "Reader",
          full_name: null,
        },
        memberships: [
          {
            id: "80000000-0000-4000-8000-000000000002",
            organization: ORGANIZATION,
            role: {
              id: "70000000-0000-4000-8000-000000000002",
              key: "read_only",
              name: "Read only",
              description: null,
              is_system: true,
            },
            is_owner: false,
            status: "active",
            joined_at: "2026-01-04T00:00:00.000Z",
          },
        ],
        active_organization: ORGANIZATION,
        permissions: [],
      },
    });
    await screen.findByText("Confirm cover with CIC");
    expect(screen.getByRole("button", { name: "Assign" })).toBeDisabled();
    expect(screen.getAllByText(/not change who owns it/).length).toBeGreaterThan(0);
  });

  it("says a view is empty in its own words", async () => {
    await renderBoards("/work?view=with", {
      work: (v) => work(v, []),
    });
    expect(await screen.findByText("No item is with an outside party.")).toBeInTheDocument();
  });
});

describe("tabs and Ask context", () => {
  it("opens Today as its own tab", async () => {
    await renderBoards("/today", { attention: attention([item()]) });
    await screen.findByText("Confirm cover with CIC");
    const tabs = screen.getByRole("tablist", { name: "Open workspaces" });
    expect(await within(tabs).findByText("What matters now")).toBeInTheDocument();
  });

  it("opens Work as its own tab, beside Today's", async () => {
    await renderBoards("/today", {
      attention: attention([item()]),
      work: (v) => work(v, VIEWS[v] ?? []),
    });
    await screen.findByText("Confirm cover with CIC");
    const tabs = screen.getByRole("tablist", { name: "Open workspaces" });
    await within(tabs).findByText("What matters now");

    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: /Work/ }),
    );
    expect(await within(tabs).findByText("All work")).toBeInTheDocument();
    expect(within(tabs).getByText("What matters now")).toBeInTheDocument();
  });

  /* Ask is told what it is looking at, and it changes when the active Space does. */
  it("gives Ask the active Space's context, and changes it with the tab", async () => {
    const { container } = await renderBoards("/today", {
      attention: attention([item()]),
      work: (v) => work(v, VIEWS[v] ?? []),
    });
    await screen.findByText("Confirm cover with CIC");
    expect(container.querySelector(".shell-ask-context")?.textContent).toBe(
      "TODAY · What matters now",
    );

    await userEvent.click(
      within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: /Work/ }),
    );
    await screen.findByRole("heading", { level: 1, name: "All work" });
    expect(container.querySelector(".shell-ask-context")?.textContent).toBe("WORK · All work");
  });

  /*
   * Closing a tab is an interface act. It makes no request at all, which is the strongest form the
   * promise can take: there is no call for the server to refuse.
   */
  it("closes a tab without touching the record", async () => {
    await renderBoards("/today", { attention: attention([item()]) });
    await screen.findByText("Confirm cover with CIC");
    const tabs = screen.getByRole("tablist", { name: "Open workspaces" });
    await within(tabs).findByText("What matters now");
    const calls =
      (globalThis.fetch as unknown as { mock?: { calls: unknown[] } }).mock?.calls.length ?? 0;

    await userEvent.click(
      screen.getByRole("button", {
        name: /Close the What matters now tab — the record is not changed/,
      }),
    );
    expect(within(tabs).queryByText("What matters now")).toBeNull();
    const after =
      (globalThis.fetch as unknown as { mock?: { calls: unknown[] } }).mock?.calls.length ?? 0;
    expect(after).toBe(calls);
  });

  it("records the opened Space in Recent", async () => {
    await renderBoards("/today", { attention: attention([item()]) });
    await screen.findByText("Confirm cover with CIC");
    await userEvent.click(screen.getByRole("button", { name: "Recent" }));
    const recent = screen.getByRole("menu", { name: "Recent workspaces" });
    expect(within(recent).getByText("What matters now")).toBeInTheDocument();
  });
});

describe("the layout at a phone's width", () => {
  it("has no horizontal overflow and keeps the row's controls reachable", async () => {
    const { container } = await renderBoards("/work", { work: (v) => work(v, VIEWS[v] ?? []) });
    await screen.findByText("Confirm cover with CIC");
    /*
     * jsdom does no layout, so overflow is measured for real in `scripts/visual/capture.mjs` at
     * 390x844. What is provable here is the structure that makes it possible: the block column is
     * capped rather than the pane, and nothing sets a fixed width wider than a phone.
     */
    expect(container.querySelector(".sp-blocks")).toBeTruthy();
    const fixedWide = [...container.querySelectorAll<HTMLElement>("[style]")].filter((el) => {
      const w = el.style.width || el.style.minWidth;
      return /^\d{3,}px$/.test(w) && Number.parseInt(w, 10) > 360;
    });
    expect(fixedWide).toEqual([]);
  });
});
