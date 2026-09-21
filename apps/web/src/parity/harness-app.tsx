import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Search } from "../pages/Search.js";
import { Today } from "../pages/Today.js";
import { Work } from "../pages/Work.js";
import { Shell } from "../shell/Shell.js";
import "../styles/index.css";

/**
 * The harness's application: the shipping shell and the shipping boards, over the stubbed
 * responses installed by `shell-harness.tsx` before this module was imported.
 *
 * Development only. `index.html` is the only Rollup input, so none of this reaches `dist/`.
 */
if (import.meta.env.PROD) throw new Error("the parity harness is a development tool");

const root = createRootRoute({ component: () => <Shell /> });
const boards = [
  createRoute({ getParentRoute: () => root, path: "/today", component: Today }),
  createRoute({
    getParentRoute: () => root,
    path: "/work",
    component: Work,
    validateSearch: (s: Record<string, unknown>) => ({ view: s["view"] as string | undefined }),
  }),
];
const search = createRoute({
  getParentRoute: () => root,
  path: "/search",
  component: Search,
  validateSearch: (s: Record<string, unknown>) => ({ q: (s["q"] as string | undefined) ?? "" }),
});
const routes = ["/automations", "/new", "/jobs", "/ask", "/import", "/email", "/clients"].map(
  (path) => createRoute({ getParentRoute: () => root, path, component: () => <div /> }),
);
const record = createRoute({
  getParentRoute: () => root,
  path: "/r/$recordId",
  component: () => <div />,
});
const initial = new URLSearchParams(location.search).get("at") ?? "/today";
const router = createRouter({
  routeTree: root.addChildren([...boards, search, ...routes, record]),
  history: createMemoryHistory({ initialEntries: [initial] }),
});

const el = document.getElementById("root");
if (!el) throw new Error("#root not found");
createRoot(el).render(
  <StrictMode>
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
