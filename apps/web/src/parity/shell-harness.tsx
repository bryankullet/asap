/**
 * A measuring harness for the permanent shell. Development only.
 *
 * Geometry parity needs a real browser: jsdom cannot tell you a sidebar is 228px wide. The
 * authenticated application cannot be reached from a measuring script without a real session, so
 * this page mounts the **shipping** `Shell` and the **shipping** stylesheets over a stubbed `/me`
 * and empty board responses, and measures that.
 *
 * What it proves: the shell's geometry, typography, colour and responsive behaviour are the
 * prototype's. What it does not prove, and must never be read as proving: authentication, RLS,
 * permissions, or that any business value is real — every value here is empty or a placeholder.
 *
 * It is not part of the production build. `index.html` is the only Rollup input, so nothing here
 * is emitted into `dist/`, and `scripts/check-bundle.mjs` would see it if that changed.
 */
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
import { Shell } from "../shell/Shell.js";
import "../styles/index.css";

if (import.meta.env.PROD) throw new Error("the parity harness is a development tool");

const json = (v: unknown) =>
  new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });

/*
 * A stand-in session, so the shell renders its signed-in state. The name is obviously a stand-in:
 * no fictional brokerage, client or policy belongs in this codebase, and a plausible-looking one
 * here would end up quoted as if it were real.
 */
globalThis.fetch = (async (url: RequestInfo | URL) => {
  const u = String(url);
  if (u.includes("/me")) {
    return json({
      user: {
        id: "harness",
        email: "harness@example.invalid",
        display_name: "Parity Harness",
        full_name: null,
      },
      memberships: [
        {
          organization: { id: "harness-org", name: "Parity harness" },
          role: { id: "harness-role", name: "Operations manager" },
        },
      ],
      active_organization: {
        id: "harness-org",
        name: "Parity harness",
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
}) as typeof fetch;

const root = createRootRoute({ component: () => <Shell /> });
const routes = ["/today", "/work", "/automations", "/new", "/search", "/jobs", "/ask"].map((path) =>
  createRoute({ getParentRoute: () => root, path, component: () => <div /> }),
);
const initial = new URLSearchParams(location.search).get("at") ?? "/today";
const router = createRouter({
  routeTree: root.addChildren(routes),
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
