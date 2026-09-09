import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";

/**
 * Renders a component inside a memory router with the shell's routes registered (so <Link to>
 * resolves) but no data layer. Views under test are pure and take fixtures as props.
 */
export async function renderInRouter(ui: ReactNode, initialPath = "/today") {
  const root = createRootRoute({ component: () => <Outlet /> });
  const page = () => <div data-testid="routed">{ui}</div>;
  const routes = [
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const utils = render(<RouterProvider router={router as any} />);
  await utils.findByTestId("routed");
  return { ...utils, router };
}
