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

/**
 * The brokerage every fixture belongs to.
 *
 * A real uuid, and not a detail: `api.ts` validates every response against its Zod schema, so a
 * stub with `"o1"` in it fails `uuidSchema`, `/me` resolves to nothing, and every query that
 * depends on an organization id stays disabled — a screen that renders its loading state forever
 * and a test that says nothing.
 */
export const BOARD_ORG = "10000000-0000-4000-8000-00000000000a";

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
  /* The creation Spaces behind "+ New": `/new/client`, `/new/claim`, and the rest. */
  const creation = createRoute({ getParentRoute: () => root, path: "/new/$kind", component: page });
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
  const client = createRoute({
    getParentRoute: () => root,
    path: "/clients/$clientId",
    component: page,
  });
  const opportunity = createRoute({
    getParentRoute: () => root,
    path: "/opportunities/$opportunityId",
    component: page,
  });
  const quote = createRoute({
    getParentRoute: () => root,
    path: "/opportunities/$opportunityId/insurers/$opportunityInsurerId",
    component: page,
  });
  const placement = createRoute({
    getParentRoute: () => root,
    path: "/placements/$placementId",
    component: page,
  });
  const quotationReading = createRoute({
    getParentRoute: () => root,
    path: "/documents/$documentId/quotation",
    component: page,
  });
  const comparison = createRoute({
    getParentRoute: () => root,
    path: "/opportunities/$opportunityId/comparison",
    component: page,
  });
  const conversation = createRoute({
    getParentRoute: () => root,
    path: "/email/$threadId",
    component: page,
  });
  const policy = createRoute({ getParentRoute: () => root, path: "/policies/$policyId", component: () => <div data-testid="routed">policy space</div> });
  const router = createRouter({
    routeTree: root.addChildren([...routes, creation, record, file, agreement, document, conversation, client, opportunity, quote, comparison, quotationReading, placement, policy]),
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

