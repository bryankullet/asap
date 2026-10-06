import { Outlet, RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, useRef } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase.js", () => ({ supabase: { auth: { signOut: async () => ({}) } }, throughSupabaseBase: (u: string) => u }));

/*
 * The approved interface in the adaptive shell (D-155), whole, over its demo records: Home without a
 * transcript, a named conversation from Home, full-width Work and Spaces with chat closed, "Ask about
 * this" as a drawer, and no tab strip anywhere.
 */
async function mount(path: string) {
  localStorage.clear();
  sessionStorage.clear();
  const [{ default: Component }, { AdaptiveShell }, { loadDemoAdapters }] = await Promise.all([import("./logic.js"), import("./shell/AdaptiveShell.js"), import("./demo.js")]);
  type L = { props: { shell: unknown }; renderVals(): object };
  const C = Component as unknown as { prototype: { render(this: L): unknown } } & React.ComponentType<{ loadAdapters: () => Promise<unknown>; shell: unknown; orgKey: string }>;
  C.prototype.render = function (this: L) {
    return createElement(AdaptiveShell as never, { logic: this, v: { ...this.props, ...this.renderVals() }, controller: this.props.shell, orgKey: "demo" } as never);
  };
  function Harness() {
    const controller = useRef({ open: () => {}, home: () => {}, search: () => {}, ensureConversation: async () => null }).current;
    return <C loadAdapters={() => loadDemoAdapters({ switchToLive: () => {} })} shell={controller} orgKey="demo" />;
  }
  const root = createRootRoute({ component: () => <><Harness /><Outlet /></> });
  const any = createRoute({ getParentRoute: () => root, path: "$", component: () => null });
  const index = createRoute({ getParentRoute: () => root, path: "/", component: () => null });
  const router = createRouter({ routeTree: root.addChildren([index, any]), history: createMemoryHistory({ initialEntries: [path] }) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const utils = render(<RouterProvider router={router as any} />);
  return { ...utils, router };
}

describe("the adaptive shell", () => {
  it("Home loads full width with no conversation transcript and no tab strip", async () => {
    const { container } = await mount("/");
    await screen.findByRole("heading", { level: 1, name: "What would you like ASAP to handle?" });
    expect(container.querySelector(".asap-ask")).toBeNull();
    expect(container.querySelector(".asap-tabs")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeTruthy();
    for (const label of ["Home", "Work", "Automations", "Activity", "Search", "New"]) expect(screen.getAllByRole("button", { name: new RegExp(`^.?\\s*${label}$`) }).length).toBeGreaterThan(0);
  });

  it("a request from Home becomes a named conversation at its own address", async () => {
    const { router } = await mount("/");
    const box = await screen.findByLabelText("What would you like ASAP to handle?");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(box, { target: { value: "Is KDN 482Q covered right now?" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    vi.useRealTimers();
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/ask\/[0-9a-f-]{36}$/));
    expect(await screen.findByRole("heading", { level: 2, name: "Is KDN 482Q covered right now" })).toBeTruthy();
    await waitFor(() => expect(document.querySelector(".asap-ask")).not.toBeNull());
  });

  it("Work opens full width with chat closed", async () => {
    const { container } = await mount("/work");
    await screen.findByRole("tablist", { name: "Work views" });
    expect(screen.getByRole("tab", { name: /Needs me/ })).toBeTruthy();
    expect(container.querySelector(".asap-ask")).toBeNull();
  });

  it("a Space opens full width; Ask about this opens a scoped drawer at its own address", async () => {
    const { container, router } = await mount("/s/clients");
    await waitFor(() => expect(container.querySelector(".asap-pane")).not.toBeNull());
    expect(container.querySelector(".asap-ask")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ask about this/ }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ ask: "new" }));
    await waitFor(() => expect(container.querySelector(".sh-drawer .asap-ask")).not.toBeNull());
  });

  it("draws the automation form with fields a person can type into", async () => {
    await mount("/s/automation?create=1");
    for (const placeholder of ["Prepare renewals 30 days before expiry", "A policy is 30 days from expiry", "Prepare renewal work and assign it to the policy owner"]) {
      const input = await screen.findByPlaceholderText(placeholder);
      fireEvent.change(input, { target: { value: "typed " + placeholder } });
      expect((input as HTMLInputElement).value).toBe("typed " + placeholder);
    }
    expect(screen.getByRole("button", { name: "Save automation" })).toBeTruthy();
  });
});
