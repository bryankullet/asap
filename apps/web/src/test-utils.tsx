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
import { vi } from "vitest";
import type { ReactNode } from "react";
import type { AttentionResponse, RunRow, WorkItemRow } from "@asap/schema";

/**
 * Renders a component inside a memory router with the shell's routes registered (so <Link to>
 * resolves) but no data layer. Views under test are pure and take fixtures as props.
 */
export async function renderInRouter(ui: ReactNode, initialPath = "/today") {
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
    "/settings/connections",
    "/audit",
    "/ask",
    "/jobs",
    "/new",
    "/email",
    "/documents",
    "/import",
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
  const document = createRoute({
    getParentRoute: () => root,
    path: "/documents/$documentId",
    component: page,
  });
  const router = createRouter({
    routeTree: root.addChildren([...routes, record, file, agreement, document]),
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
 * The production `Shell`, mounted with the session and queries it reads.
 *
 * This exercises the component that ships rather than a copy of it, which is the point: the shell
 * is where the prototype's geometry, its tab strip and its Ask panel live, and a test against a
 * stand-in would pass while the real one was broken.
 *
 * `fetch` is stubbed rather than mocked per call. Every endpoint the shell touches answers with an
 * empty, well-shaped body, so what is under test is the shell's own behaviour and not a fixture's.
 * Nothing here is production data and nothing is persisted beyond the interface preferences the
 * shell itself writes.
 */
export async function renderShell(initialPath = "/today") {
  const { Shell } = await import("./shell/Shell.js");
  vi.stubGlobal("fetch", async (url: RequestInfo | URL) => {
    const u = String(url);
    const json = (v: unknown) =>
      new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
    if (u.includes("/me")) {
      return json({
        user: { id: "u1", email: "amina@acme.test", display_name: "Amina Yusuf", full_name: null },
        memberships: [
          {
            organization: { id: "o1", name: "Acme Insurance Brokers" },
            role: { id: "r1", name: "Operations manager" },
          },
        ],
        active_organization: {
          id: "o1",
          name: "Acme Insurance Brokers",
          country: "KE",
          currency: "KES",
          timezone: "Africa/Nairobi",
        },
        permissions: [],
      });
    }
    if (u.includes("/work")) return json({ items: [], counts: { needs: 0 } });
    if (u.includes("/runs")) return json({ runs: [] });
    return json({});
  });

  const root = createRootRoute({
    component: () => (
      <Shell />
    ),
  });
  const shellRoutes = [
    "/today",
    "/work",
    "/automations",
    "/new",
    "/search",
    "/jobs",
    "/ask",
    "/documents",
  ].map((path) =>
    createRoute({
      getParentRoute: () => root,
      path,
      component: () => <div data-testid="routed" />,
    }),
  );
  const router = createRouter({
    routeTree: root.addChildren(shellRoutes),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  await router.load();
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <RouterProvider router={router as any} />
    </QueryClientProvider>,
  );
  await utils.findByRole("navigation", { name: "Main" });  // the sidebar, not the bottom bar
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
      { key: "needs_you", label: "What matters now", visible: needsYou.length, returned: needsYou.length },
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
    book: { clients: items.length, policies: 0, work: items.length },
  };
}
