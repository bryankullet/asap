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
 * The authentication boundary.
 *
 * There is one application and it is the brokerage's own: every destination sits behind a live
 * session and a resolved membership. This drives the *real* route tree — the one the browser gets
 * — so it fails if any destination ever becomes reachable without signing in.
 *
 * It replaces the demo-entry suite: the public fixture-only demonstration was removed, and with it
 * the branch above the guards that made it possible.
 */
async function visit(path: string) {
  vi.resetModules();
  const [{ createAppRouter }, { AuthProvider }] = await Promise.all([
    import("../router.js"),
    import("../lib/auth.js"),
  ]);
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        {/* The app's typed router registration does not apply to a test-built instance. */}
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
        <RouterProvider router={router as any} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router };
}

beforeAll(async () => {
  await Promise.all([import("../router.js"), import("../lib/auth.js")]);
}, TIMEOUT);

afterEach(() => {
  sessionStorage.clear();
});

/** Every destination inside the shell. None of them is reachable without a session. */
const GUARDED_ROUTES = [
  "/",
  "/discover",
  "/ask",
  "/work",
  "/work?view=waiting",
  "/jobs",
  "/automations",
  "/search",
  "/new",
  "/email",
  "/documents",
  "/audit",
  "/settings/connections",
];

describe("every destination requires authentication", () => {
  for (const path of GUARDED_ROUTES) {
    it(`${path} sends an unauthenticated visitor to sign-in`, { timeout: TIMEOUT }, async () => {
      const { router } = await visit(path);
      await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
      // The shell only mounts past both guards, so it must not be on the page.
      expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    });
  }

  it("remembers where an unauthenticated visitor was going", { timeout: TIMEOUT }, async () => {
    const { router } = await visit("/discover");
    await waitFor(() => expect(router.state.location.pathname).toBe("/sign-in"));
    expect(router.state.location.search).toMatchObject({ next: "/discover" });
  });
});

describe("the ways in are the only public routes", () => {
  for (const path of ["/sign-in", "/sign-up", "/forgot-password", "/reset-password"]) {
    it(`${path} opens without a session`, { timeout: TIMEOUT }, async () => {
      const { router } = await visit(path);
      await waitFor(() => expect(router.state.location.pathname).toBe(path));
      expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
    });
  }
});
