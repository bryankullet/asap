import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) throw new Error("#root not found");

/**
 * A white page is never an acceptable outcome.
 *
 * `env.ts` validates the public environment at module load, so a deploy missing a variable used to
 * throw before React existed: `#root` stayed empty and the only trace was a console error nobody
 * opens. `scripts/check-env.mjs` now stops that build, but a build gate cannot cover every startup
 * failure — so the imports below are dynamic and anything they throw is painted on the page.
 *
 * The message is deliberately plain and carries no configuration detail: a visitor learns the app
 * could not start, not which variable is missing or what it points at (§45 rule 4).
 */
function paintStartupFailure(detail: string): void {
  const el = root as HTMLElement;
  el.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.setAttribute("role", "alert");
  wrap.style.cssText =
    "min-height:100vh;display:grid;place-items:center;padding:24px;font-family:Figtree,system-ui,sans-serif;background:#f6f8f9;color:#102a43";
  const card = document.createElement("div");
  card.style.cssText =
    "max-width:32rem;background:#fff;border:1px solid #dfe6ea;border-radius:18px;padding:24px";
  const h = document.createElement("h1");
  h.textContent = "ASAP could not start";
  h.style.cssText = "margin:0 0 8px;font-size:1.125rem;font-weight:600";
  const p = document.createElement("p");
  p.textContent =
    "This deployment is not configured correctly, so the application cannot load. Nothing you did caused this, and no data has been affected. Please tell whoever administers this deployment.";
  p.style.cssText = "margin:0;color:#334e68;line-height:1.5";
  const small = document.createElement("p");
  small.textContent = detail;
  small.style.cssText = "margin:12px 0 0;color:#66788a;font-size:0.8125rem";
  card.append(h, p, small);
  wrap.append(card);
  el.append(wrap);
}

async function start(): Promise<void> {
  // Dynamic so a throw inside any of them is catchable rather than a blank module-evaluation error.
  const [{ AuthProvider }, { router }] = await Promise.all([
    import("./lib/auth.js"),
    import("./router.js"),
    import("./styles/index.css"),
  ]);

  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
  });

  createRoot(root as HTMLElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
}

start().catch((err: unknown) => {
  // On the page: the failure class only — an env validation error lists variable names, which are
  // configuration (§45 rule 4). In the console: the whole thing, because whoever administers the
  // deployment has to be able to find out what actually broke without rebuilding it.
  if (err instanceof Error) console.error("ASAP failed to start", err);
  paintStartupFailure(err instanceof Error ? err.name : "Unknown startup error");
});
