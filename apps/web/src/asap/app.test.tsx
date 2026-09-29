import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase.js", () => ({ supabase: { auth: { signOut: async () => ({}) } } }));

/*
 * The compiled approved interface, rendered whole over its demo records: it boots, draws Today,
 * answers Ask, and opens a workspace — the path a broken compile or a missing adapter would break.
 */
describe("the approved interface", () => {
  it("boots, answers Ask and opens the workspace it names", async () => {
    localStorage.clear();
    const { default: Component } = await import("./generated/logic.gen.js");
    const { renderTemplate } = await import("./generated/template.gen.js");
    const { loadDemoAdapters } = await import("./demo.js");
    type Logic = { props: object; renderVals(): object };
    const C = Component as unknown as { prototype: { render(this: Logic): unknown } } & React.ComponentType<{ loadAdapters: () => Promise<unknown> }>;
    C.prototype.render = function (this: Logic) {
      return renderTemplate({ ...this.props, ...this.renderVals() });
    };
    render(<C loadAdapters={() => loadDemoAdapters({ switchToLive: () => {} })} />);

    await screen.findByRole("heading", { level: 1, name: "What matters now" });
    expect(screen.getAllByText("Today").length).toBeGreaterThan(0);

    const composer = screen.getByPlaceholderText("Tell ASAP what you need");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(composer, { target: { value: "Is KDN 482Q covered right now?" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/KDN 482Q/));
  });
});
