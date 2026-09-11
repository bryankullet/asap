import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * Each case builds the real route tree, which means importing every page in the application. That
 * is slow the first time and slower on a loaded machine, so the imports are warmed once and the
 * per-test budget is generous: a timeout here would be a machine measurement, not a defect.
 */
const TIMEOUT = 30_000;

/**
 * The demo-mode entry boundary (D-065).
 *
 * The live failure this locks shut: a visitor opened `/discover` on the public demonstration, was
 * sent to `/sign-in?next=%2Fdiscover`, signed in, came back, and got "We could not load your
 * account." The demo had been built as the production application with fixtures inside it, so
 * every guard in front of the shell still ran.
 *
 * These tests drive the *real* route tree — the one the browser gets — with a memory history, so
 * they fail if a guard is ever reintroduced above the shell in demo mode, and equally if
 * production ever stops requiring a session.
 */

/** Mount the real application at `path`, with demo mode on or off. */
async function visit(path: string, demoMode: "on" | "off") {
  vi.resetModules();
  vi.stubEnv("VITE_PUBLIC_DEMO_MODE", demoMode);
  const [{ createAppRouter }, { DemoProvider }, { AuthProvider }] = await Promise.all([
    import("../router.js"),
    import("./state.js"),
    import("../lib/auth.js"),
  ]);
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <DemoProvider>
          {/* The app's typed router registration does not apply to a test-built instance. */}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <RouterProvider router={router as any} />
        </DemoProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router };
}

beforeAll(async () => {
  await Promise.all([import("../router.js"), import("./state.js"), import("../lib/auth.js")]);
}, TIMEOUT);

afterEach(() => {
  vi.unstubAllEnvs();
  sessionStorage.clear();
});

/** Every destination the demonstration must open for anyone, with no session at all. */
const PUBLIC_DEMO_ROUTES = [
  "/",
  "/discover",
  "/ask",
  "/work",
  "/work?view=waiting",
  "/jobs",
  "/jobs?filter=all",
  "/automations",
  "/search",
  "/new",
  "/email",
  "/documents",
  "/audit",
  "/settings/connections",
  "/work/w-acme-kdn",
  "/jobs/j-meridian-confirm",
  "/automations/a-servicing",
];

describe("demo mode is a public, fixture-only application", () => {
  for (const path of PUBLIC_DEMO_ROUTES) {
    it(`${path} renders without authentication and never reaches sign-in`, { timeout: TIMEOUT }, async () => {
      const { router } = await visit(path, "on");
      await waitFor(() => {
        expect(router.state.location.pathname).not.toBe("/sign-in");
      });
      // The shell itself, which only mounts past every guard.
      expect(await screen.findByRole("navigation", { name: "Main" })).toBeTruthy();
      // And the presenter bar, which is how a viewer knows this is a demonstration.
      expect(screen.getByText("DEMO MODE")).toBeTruthy();
      expect(router.state.location.pathname).not.toBe("/sign-in");
      expect(router.state.location.search).not.toHaveProperty("next");
    });
  }

  it("the root enters the demonstration at Discover", { timeout: TIMEOUT }, async () => {
    const { router } = await visit("/", "on");
    await waitFor(() => expect(router.state.location.pathname).toBe("/discover"));
  });

  it("no demo route asks the API for anything", { timeout: TIMEOUT }, async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await visit("/discover", "on");
    expect(await screen.findByRole("navigation", { name: "Main" })).toBeTruthy();
    expect(fetchSpy.mock.calls).toEqual([]);
    fetchSpy.mockRestore();
  });
});

describe("production mode still requires authentication", () => {
  it("/discover sends an unauthenticated visitor to sign-in, and remembers where they were going", { timeout: TIMEOUT }, async () => {
    const { router } = await visit("/discover", "off");
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(router.state.location.search).toMatchObject({ next: "/discover" });
  });

  it("no presenter bar and no fictional shell before a session", { timeout: TIMEOUT }, async () => {
    await visit("/work", "off");
    await waitFor(() => expect(screen.queryByText("DEMO MODE")).toBeNull());
    expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  });
});
