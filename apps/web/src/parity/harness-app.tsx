import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  Outlet,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Connections } from "../pages/Connections.js";
import { JobDetail, Jobs } from "../pages/Jobs.js";
import { Search } from "../pages/Search.js";
import { OpenNewSheet, StartWork } from "../pages/StartWork.js";
import { Today } from "../pages/Today.js";
import { Work } from "../pages/Work.js";
import { Shell } from "../shell/Shell.js";
import "../styles/index.css";
import { Onboarding } from "../pages/Onboarding.js";
import { ClientSpace } from "../pages/ClientSpace.js";
import { ComparisonSpace } from "../pages/ComparisonSpace.js";
import { QuotationReading } from "../pages/QuotationReading.js";
import { OpportunitySpace, QuoteSpace } from "../pages/OpportunitySpace.js";

/**
 * The harness's application: the shipping shell and the shipping boards, over the stubbed
 * responses installed by `shell-harness.tsx` before this module was imported.
 *
 * Development only. `index.html` is the only Rollup input, so none of this reaches `dist/`.
 */
if (import.meta.env.PROD) throw new Error("the parity harness is a development tool");

/*
 * Onboarding is the one screen that is not inside the shell: in the application it sits under the
 * session guard but before a brokerage exists, so there is no sidebar to draw. The harness has to
 * mirror that, or the captures would show a shell the real screen never has.
 */
const outsideShell = (new URLSearchParams(location.search).get("at") ?? "").startsWith("/onboarding");
const root = createRootRoute({ component: () => (outsideShell ? <Outlet /> : <Shell />) });
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
const extra = [
  createRoute({ getParentRoute: () => root, path: "/settings/connections", component: Connections }),
  createRoute({
    getParentRoute: () => root,
    path: "/jobs",
    component: Jobs,
    validateSearch: (s: Record<string, unknown>) => ({ filter: (s["filter"] as string | undefined) ?? "all" }),
  }),
  createRoute({ getParentRoute: () => root, path: "/jobs/$jobId", component: JobDetail }),
  createRoute({ getParentRoute: () => root, path: "/new/$kind", component: StartWork }),
  /* `/new` is how the sheet is opened, in the harness exactly as in the application. */
  createRoute({ getParentRoute: () => root, path: "/new", component: OpenNewSheet }),
];
const clientSpace = createRoute({ getParentRoute: () => root, path: "/clients/$clientId", component: ClientSpace });
const opportunity = createRoute({ getParentRoute: () => root, path: "/opportunities/$opportunityId", component: OpportunitySpace });
const quoteTerms = createRoute({ getParentRoute: () => root, path: "/opportunities/$opportunityId/insurers/$opportunityInsurerId", component: QuoteSpace });
const comparison = createRoute({ getParentRoute: () => root, path: "/opportunities/$opportunityId/comparison", component: ComparisonSpace });
const quotationReading = createRoute({ getParentRoute: () => root, path: "/documents/$documentId/quotation", component: QuotationReading });
const onboarding = createRoute({ getParentRoute: () => root, path: "/onboarding", component: Onboarding });
const routes = ["/automations", "/ask", "/import", "/email", "/clients", "/documents", "/files"].map(
  (path) => createRoute({ getParentRoute: () => root, path, component: () => <div /> }),
);
const record = createRoute({
  getParentRoute: () => root,
  path: "/r/$recordId",
  component: () => <div />,
});
const initial = new URLSearchParams(location.search).get("at") ?? "/today";
const router = createRouter({
  routeTree: root.addChildren([onboarding, clientSpace, opportunity, quoteTerms, comparison, quotationReading, ...boards, search, ...extra, ...routes, record]),
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
