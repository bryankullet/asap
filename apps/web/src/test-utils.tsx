import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { AttentionResponse, RunRow, WorkItemRow } from "@asap/schema";

/**
 * Renders a component inside a memory router with the shell's routes registered (so <Link to>
 * resolves) but no data layer. Views under test are pure and take fixtures as props.
 */
export async function renderInRouter(ui: ReactNode, initialPath = "/discover") {
  const root = createRootRoute({ component: () => <Outlet /> });
  const page = () => <div data-testid="routed">{ui}</div>;
  const routes = [
    "/discover",
    "/today",
    "/work",
    "/automations",
    "/settings/members",
    "/files",
    "/settings/agreements",
    "/onboarding/create",
    "/onboarding",
  ].map((path) => createRoute({ getParentRoute: () => root, path, component: page }));
  const record = createRoute({ getParentRoute: () => root, path: "/r/$recordId", component: page });
  const file = createRoute({
    getParentRoute: () => root,
    path: "/files/$clientId",
    component: page,
  });
  const agreement = createRoute({
    getParentRoute: () => root,
    path: "/settings/agreements/$agreementId",
    component: page,
  });
  const router = createRouter({
    routeTree: root.addChildren([...routes, record, file, agreement]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  // Test-only router; the app's typed router registration does not apply here.
  await router.load();
  // A query client, because components that read their own small piece of state (the pin marker,
  // for one) use one. Retries off and no network: a view under test still takes its fixtures as
  // props, and anything that would fetch resolves to its own error or empty state instead.
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );
  await utils.findByTestId("routed");
  return { ...utils, router };
}

/**
 * The `GET /attention` body for a set of rows, as the API would return it.
 *
 * View tests need the endpoint's *shape*; whether the endpoint puts the right rows in it is
 * proven where that logic now lives — `apps/api/test/attention.test.ts`, against Amina's five
 * cards from `docs/click-through.md`. This helper mirrors the endpoint's two rules (section, then
 * recency) so a view fixture stays as readable as the rows it came from.
 */
export function attentionFixture(
  items: WorkItemRow[],
  runs: RunRow[],
  orgName = "Acme Insurance Brokers",
  now = new Date(),
): AttentionResponse {
  const stuck = runs.filter(
    (r) => r.status === "paused" || r.status === "could_not_finish" || r.status === "stopped",
  );
  const byItem = new Map(stuck.filter((r) => r.work_item_id).map((r) => [r.work_item_id!, r]));
  const fail = (r: RunRow) => ({
    id: r.id,
    title: r.title,
    status: r.status as "paused" | "could_not_finish" | "stopped",
    nextStep: r.next_step,
  });
  const step = (i: WorkItemRow) => {
    const s = i.steps.find((x) => x.state === "now" || x.state === "blocked");
    return s ? { id: s.id, label: s.label, actor: s.actor } : null;
  };
  const rows = (list: WorkItemRow[], section: "needs_you" | "checks_due") =>
    list.map((item, i) => ({
      section,
      rank: i + 1,
      // A view fixture does not re-implement the signal table; it carries one honest signal so the
      // shape is real. The scoring itself is proven in apps/api/test/attention.test.ts.
      score: 24,
      item,
      reason: item.reason ?? `${step(item)?.label ?? "This item"} is the step waiting.`,
      signals: [
        {
          id: "evidence_missing" as const,
          because: `${step(item)?.label ?? "This item"} is the step waiting on a person.`,
          points: 24,
        },
      ],
      nowStep: step(item),
      client: null,
      period: null,
      facts: [],
      runFailure: byItem.get(item.id) ? fail(byItem.get(item.id)!) : null,
      links: {
        work: `/r/${item.id}`,
        client: item.client_id ? `/files/${item.client_id}` : null,
        policy: null,
        ask: item.title,
      },
    }));
  const needsYou = items.filter((i) => i.task_status === "needs_you");
  const checksDue = items.filter(
    (i) =>
      i.task_status === "with_party" &&
      i.task_next_check !== null &&
      new Date(i.task_next_check) <= now,
  );
  const needsYouIds = new Set(needsYou.map((i) => i.id));
  return {
    organization: { id: "10000000-0000-4000-8000-00000000000a", name: orgName },
    generatedAt: now.toISOString(),
    items: [...rows(needsYou, "needs_you"), ...rows(checksDue, "checks_due")],
    sections: [
      { key: "needs_you", label: "Needs you", visible: needsYou.length, returned: needsYou.length },
      {
        key: "checks_due",
        label: "Checks due",
        visible: checksDue.length,
        returned: checksDue.length,
      },
    ],
    orphanRuns: stuck
      .filter((r) => !r.work_item_id || !needsYouIds.has(r.work_item_id))
      .map(fail),
    degraded: [],
    cap: 12,
  };
}
