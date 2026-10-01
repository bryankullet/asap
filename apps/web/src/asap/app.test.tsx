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
    sessionStorage.clear();
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

  it("draws the automation form with fields a person can type into", async () => {
    localStorage.clear();
    sessionStorage.clear();
    const { default: Component } = await import("./generated/logic.gen.js");
    const { renderTemplate } = await import("./generated/template.gen.js");
    const { loadDemoAdapters } = await import("./demo.js");
    type Logic = { props: object; renderVals(): object; openRef(ref: object): void };
    const C = Component as unknown as { prototype: { render(this: Logic): unknown } } & React.ComponentType<{ loadAdapters: () => Promise<unknown> }>;
    C.prototype.render = function (this: Logic) {
      return renderTemplate({ ...this.props, ...this.renderVals() });
    };
    render(<C loadAdapters={() => loadDemoAdapters({ switchToLive: () => {} })} />);
    await screen.findByRole("heading", { level: 1, name: "What matters now" });
    fireEvent.click(screen.getAllByText("New")[0]!);
    fireEvent.click(await screen.findByText("Automation"));
    for (const placeholder of ["Prepare renewals 30 days before expiry", "A policy is 30 days from expiry", "Prepare renewal work and assign it to the policy owner"]) {
      const input = await screen.findByPlaceholderText(placeholder);
      fireEvent.change(input, { target: { value: "typed " + placeholder } });
      expect((input as HTMLInputElement).value).toBe("typed " + placeholder);
    }
    expect(screen.getByRole("button", { name: "Save automation" })).toBeTruthy();
  });

  it("puts Ask in the centre and the Space on its right (D-118)", async () => {
    localStorage.clear();
    sessionStorage.clear();
    const { default: Component } = await import("./generated/logic.gen.js");
    const { renderTemplate } = await import("./generated/template.gen.js");
    const { loadDemoAdapters } = await import("./demo.js");
    type Logic = { props: object; renderVals(): object };
    const C = Component as unknown as { prototype: { render(this: Logic): unknown } } & React.ComponentType<{ loadAdapters: () => Promise<unknown> }>;
    C.prototype.render = function (this: Logic) {
      return renderTemplate({ ...this.props, ...this.renderVals() });
    };
    const { container } = render(<C loadAdapters={() => loadDemoAdapters({ switchToLive: () => {} })} />);
    await screen.findByRole("heading", { level: 1, name: "What matters now" });
    const body = container.querySelector(".asap-body") as HTMLElement;
    const ask = container.querySelector(".asap-ask") as HTMLElement;
    expect(body.style.gridTemplateColumns).toMatch(/^minmax\(360px, ?560px\) minmax\(0(px)?, ?1fr\)$/);
    expect(ask.style.order).toBe("-1");
    expect(body.getAttribute("data-view")).toBe("ask");
  });
});
