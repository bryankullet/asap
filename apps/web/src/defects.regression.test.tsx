/**
 * One regression test per defect found in ASAP_CURRENT_BUILD_AUDIT.md. Each was confirmed by
 * clicking the real application, so each is pinned here before the Space work begins.
 */
import type { ActRequest, ClaimDetail, RunRow, Step, WorkItemRow } from "@asap/schema";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { renderInRouter } from "./test-utils.js";
import { chipRuns } from "./shell/ActivityChip.js";
import { WorkItemView } from "./views/RecordViews.js";
import { RECORD_ACTIVITY_ID } from "./views/RecordFooter.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const ITEM_ID = "30000000-0000-4000-8000-000000000050";
const iso = () => new Date().toISOString();

const acted: ActRequest[] = [];
/** Every API call the page made, so a test can assert one was never made at all. */
const calls: string[] = [];
/** Queued Ask outcomes: an Error rejects, anything else resolves. */
const askQueue: unknown[] = [];
vi.mock("./lib/api.js", () => ({
  api: {
    act: (_id: string, input: ActRequest) => {
      acted.push(input);
      return Promise.resolve({ outcome: "applied", item: null, run: null, draft: null });
    },
    ask: (q: string) => {
      calls.push(`ask:${q}`);
      const next = askQueue.shift();
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    workItem: (id: string) => {
      calls.push(`workItem:${id}`);
      return Promise.reject(Object.assign(new Error("not found"), { status: 404 }));
    },
    run: (id: string) => {
      calls.push(`run:${id}`);
      return Promise.resolve({
        run: {
          id,
          organization_id: ORG,
          work_item_id: null,
          title: "Mailbox sweep",
          status: "could_not_finish",
          next_step: "Nothing to sweep.",
          started_by: null,
          boot_token: null,
          started_at: iso(),
          ended_at: iso(),
          created_at: iso(),
          updated_at: iso(),
        },
        events: [],
        relatedWork: null,
        evidence: [],
        waitingFor: "Nothing to sweep.",
        recovery: [
          { kind: "retry", label: "Start it again", disabledReason: "This run has no work item, so there is nothing to start again." },
        ],
      });
    },
    policy: (id: string) => {
      calls.push(`policy:${id}`);
      return Promise.resolve({
        policy: {
          id,
          class_of_business: "Motor private",
          policy_number: "MP-4471",
          insurer_id: "80000000-0000-4000-8000-0000000000a1",
        },
        clientName: "Acme Motors",
        insurerName: "Jubilee",
        periods: [],
        versions: [],
      });
    },
    createWorkItem: () => Promise.reject(new Error("not used")),
    createClient: () => Promise.reject(new Error("not used")),
  },
  describeApiError: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock("./lib/queries.js", () => ({
  useRun: () => ({ isPending: false, data: null }),
  useRuns: () => ({ data: [] }),
  useWorkItems: () => ({ data: [] }),
  useWorkItem: () => ({ data: null }),
  useRunsForWorkItem: () => ({ data: [] }),
  workKeys: { list: () => ["work_items"], one: (id: string) => ["work_item", id] },
  runKeys: { list: () => ["runs"], one: (id: string) => ["run", id] },
}));
vi.mock("./lib/runStream.js", () => ({
  useRunStream: () => ({ events: [], ended: true }),
}));
vi.mock("./lib/me.js", () => ({
  useMe: () => ({ data: { memberships: [], active_organization: { id: ORG, name: "Acme" } } }),
}));

const step = (over: Partial<Step> = {}): Step => ({
  id: "match",
  label: "Claim matched to cover",
  actor: "you",
  state: "now",
  guards: ["evidence_present"],
  evidence: [{ kind: "document", label: "What did the client report?" }],
  actions: [
    {
      verb: "record_evidence",
      label: "Register this claim",
      guards: ["evidence_present"],
      disabledReason: null,
    },
  ],
  party: null,
  reason: null,
  recorded: [],
  runId: null,
  ...over,
});

const item = (over: Partial<WorkItemRow> = {}): WorkItemRow => ({
  id: ITEM_ID,
  organization_id: ORG,
  title: "Jane Wanjiku — motor claim",
  kind: "claim",
  client_id: "70000000-0000-4000-8000-00000000000b",
  policy_period_id: null,
  insurer_id: null,
  class_of_business: null,
  owner_id: null,
  task_status: "needs_you",
  task_party: null,
  task_since: null,
  task_next_check: null,
  cover_status: null,
  cover_inception_at: null,
  money_status: null,
  reason: "The claim cannot be registered until the policy period is confirmed.",
  steps: [step()],
  exception: null,
  version: 3,
  created_at: iso(),
  updated_at: iso(),
  completed_at: null,
  deleted_at: null,
  ...over,
});

const run = (over: Partial<RunRow>): RunRow => ({
  id: "40000000-0000-4000-8000-000000000001",
  organization_id: ORG,
  work_item_id: ITEM_ID,
  title: "Renewal pack prepared",
  status: "finished",
  next_step: null,
  started_by: null,
  started_at: "2026-09-01T08:00:00.000Z",
  ended_at: "2026-09-01T08:01:00.000Z",
  boot_token: null,
  created_at: iso(),
  updated_at: iso(),
  ...over,
});

const PERIODS: ClaimDetail["candidatePeriods"] = [
  {
    period: {
      id: "60000000-0000-4000-8000-0000000000a1",
      organization_id: ORG,
      policy_id: "50000000-0000-4000-8000-0000000000a1",
      period_start: "2026-01-01",
      period_end: "2026-12-31",
      created_at: iso(),
      updated_at: iso(),
    } as ClaimDetail["candidatePeriods"][number]["period"],
    policy: {
      id: "50000000-0000-4000-8000-0000000000a1",
      class_of_business: "Motor private",
      policy_number: "MP-4471",
    } as ClaimDetail["candidatePeriods"][number]["policy"],
    insurerName: "Jubilee",
  },
];

describe("defect 1 — the claim policy period reaches the action payload", () => {
  it("sends policyPeriodId when a period is chosen", async () => {
    acted.length = 0;
    const { ActionPanel } = await import("./features/work/ActionPanel.js");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderInRouter(
      <QueryClientProvider client={qc}>
        <ActionPanel
          item={item()}
          step={step()}
          drafts={[]}
          onRunStarted={() => {}}
          candidatePeriods={PERIODS}
        />
      </QueryClientProvider>,
      `/r/${ITEM_ID}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Register this claim" }));
    // One candidate is preselected: the only possible answer is not asked as a question.
    const select = screen.getByLabelText("Policy period") as HTMLSelectElement;
    expect(select.value).toBe(PERIODS[0]!.period.id);
    fireEvent.change(screen.getByLabelText("What did the client report?"), {
      target: { value: "Police abstract OB/12/2026" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() => expect(acted.length).toBe(1));
    // Without this field apply.ts blocks the step and the claim can never be registered.
    expect(acted[0]!.policyPeriodId).toBe(PERIODS[0]!.period.id);
    expect(acted[0]!.verb).toBe("record_evidence");
    expect(acted[0]!.version).toBe(3);
  });

  it("says so rather than offering an empty select when no period contains the incident date", async () => {
    const { ActionPanel } = await import("./features/work/ActionPanel.js");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderInRouter(
      <QueryClientProvider client={qc}>
        <ActionPanel item={item()} step={step()} drafts={[]} onRunStarted={() => {}} />
      </QueryClientProvider>,
      `/r/${ITEM_ID}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Register this claim" }));
    expect(
      screen.getByText("No policy period on file contains the incident date. Add the policy first."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Policy period" })).toBeNull();
  });
});

describe("defect 2 — servicing renders above the record footer", () => {
  it("puts the claim panels before the footer in document order", async () => {
    const { container } = await renderInRouter(
      <WorkItemView
        item={item()}
        runs={[run({})]}
        aside={<h2>Notification clock</h2>}
        drafts={null}
      />,
      `/r/${ITEM_ID}`,
    );
    const headings = [...container.querySelectorAll("h2, footer")].map((el) =>
      el.tagName === "FOOTER" ? "FOOTER" : el.textContent,
    );
    const servicing = headings.indexOf("Notification clock");
    const footer = headings.indexOf("FOOTER");
    expect(servicing).toBeGreaterThan(-1);
    expect(footer).toBeGreaterThan(-1);
    // It rendered after the footer before: the page read as an unrelated second page below it.
    expect(servicing).toBeLessThan(footer);
    expect(servicing).toBeLessThan(headings.indexOf("Every step"));
  });
});

describe("defect 3 — the Activity chip counts runs that need a person", () => {
  const sessionStart = new Date("2026-09-10T09:00:00.000Z");
  it("counts could_not_finish and stopped runs however long ago they ended", () => {
    const runs = [
      run({ id: "r1", status: "could_not_finish", ended_at: "2026-09-01T08:00:00.000Z" }),
      run({ id: "r2", status: "stopped", ended_at: "2026-08-20T08:00:00.000Z" }),
      run({ id: "r3", status: "finished", ended_at: "2026-09-01T08:00:00.000Z" }),
    ];
    // Was 0 with these exact three rows on hosted, so two failures surfaced nowhere in the shell.
    const visible = chipRuns(runs, sessionStart);
    expect(visible.map((r) => r.id)).toEqual(["r1", "r2"]);
  });

  it("still counts live runs and this session's successes, and drops older ones", () => {
    const runs = [
      run({ id: "w", status: "working", ended_at: null }),
      run({ id: "p", status: "paused", ended_at: null }),
      run({ id: "new", status: "finished", ended_at: "2026-09-10T09:30:00.000Z" }),
      run({ id: "old", status: "finished", ended_at: "2026-09-09T09:30:00.000Z" }),
    ];
    expect(chipRuns(runs, sessionStart).map((r) => r.id)).toEqual(["w", "p", "new"]);
  });
});

describe("defect 4 — the record Activity control opens real activity", () => {
  it("renders a control whose target exists in the document", async () => {
    const { container } = await renderInRouter(
      <WorkItemView item={item()} runs={[run({})]} />,
      `/r/${ITEM_ID}`,
    );
    const footer = container.querySelector("footer")!;
    const control = within(footer).getByRole("button", { name: "Activity" });
    expect(control).toBeInTheDocument();
    // The link pointed at #record-activity and no element carried that id.
    const target = container.querySelector(`#${RECORD_ACTIVITY_ID}`);
    expect(target).not.toBeNull();
    expect(within(target as HTMLElement).getByText("What ASAP did")).toBeInTheDocument();
  });

  it("offers no Activity control when the record has no runs", async () => {
    const { container } = await renderInRouter(<WorkItemView item={item()} runs={[]} />);
    const footer = container.querySelector("footer")!;
    expect(within(footer).queryByRole("button", { name: "Activity" })).toBeNull();
    expect(within(footer).getByText("No runs on this record yet")).toBeInTheDocument();
    expect(container.querySelector(`#${RECORD_ACTIVITY_ID}`)).toBeNull();
  });
});

describe("defect 5 — a stale Ask error never sits beside a fresh answer", () => {
  it("clears the previous failure when the next request succeeds", async () => {
    calls.length = 0;
    askQueue.length = 0;
    askQueue.push(new Error("Request failed (database_error)."));
    askQueue.push({
      intent: {
        type: "work_list",
        target: null,
        panel: null,
        view: "summary",
        answer: '4 items match "Acme".',
        suggestions: [],
      },
      results: [],
      source: "search",
    });
    const { AskComposer } = await import("./shell/AskComposer.js");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderInRouter(
      <QueryClientProvider client={qc}>
        <AskComposer />
      </QueryClientProvider>,
    );
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "broken" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() =>
      expect(screen.getByText("Request failed (database_error).")).toBeInTheDocument(),
    );
    fireEvent.change(box, { target: { value: "Acme" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(screen.getByText('4 items match "Acme".')).toBeInTheDocument());
    // Both read together before: "Request failed (database_error). | 4 items match "Acme"".
    expect(screen.queryByText("Request failed (database_error).")).toBeNull();
  });
});

describe("defect 6 — a policy id does not probe /work-items first", () => {
  const POLICY = "50000000-0000-4000-8000-0000000000a1";

  it("goes straight to the policy read when the link says the id is a policy", async () => {
    calls.length = 0;
    const { Record } = await import("./pages/Record.js");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderInRouter(
      <QueryClientProvider client={qc}>
        <Record />
      </QueryClientProvider>,
      `/r/${POLICY}?kind=policy`,
    );
    await waitFor(() => expect(screen.getByText(/MP-4471/)).toBeInTheDocument());
    // Every policy open logged a 404 on /work-items/{policyId} before the fallback succeeded.
    expect(calls).toContain(`policy:${POLICY}`);
    expect(calls.some((c) => c.startsWith("workItem:"))).toBe(false);
  });

  it("still falls back for a pasted url that carries no hint", async () => {
    calls.length = 0;
    const { Record } = await import("./pages/Record.js");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderInRouter(
      <QueryClientProvider client={qc}>
        <Record />
      </QueryClientProvider>,
      `/r/${POLICY}`,
    );
    await waitFor(() => expect(calls).toContain(`policy:${POLICY}`));
    expect(calls).toContain(`workItem:${POLICY}`);
  });
});

describe("a run id opens as a run, not as a failed work-item probe", () => {
  const RUN = "40000000-0000-4000-8000-000000000009";

  it("reads the run directly when the link says the id is a run", async () => {
    calls.length = 0;
    const { Record } = await import("./pages/Record.js");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await renderInRouter(
      <QueryClientProvider client={qc}>
        <Record />
      </QueryClientProvider>,
      `/r/${RUN}?kind=run`,
    );
    await waitFor(() => expect(calls).toContain(`run:${RUN}`));
    // The same rule as the policy hint: no probe, so no 404 on the way to the answer.
    expect(calls.some((c) => c.startsWith("workItem:"))).toBe(false);
  });
});
