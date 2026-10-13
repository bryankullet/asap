import { EXPERIENCE_COMPONENTS, emptyUiState, type ASAPExperienceSpec } from "@asap/schema";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { reconcile } from "../experience/composition/CompositionReconciler.js";
import { ExperienceProvider, type ExperienceCtx } from "../experience/context/ExperienceContext.js";
import { ContinuityStore } from "../experience/continuity/ContinuityStore.js";
import { REGISTRY } from "../experience/registry/ComponentRegistry.js";
import { ExperienceRenderer } from "../experience/renderer/ExperienceRenderer.js";
import { comp, dockSpec, formSpec, slot, spec, tableSpec } from "./fixtures.js";

function mount(s: ASAPExperienceSpec, opts: { narrow?: boolean; run?: ExperienceCtx["run"]; store?: ContinuityStore } = {}) {
  const store = opts.store ?? new ContinuityStore(s.experienceId, emptyUiState(), 0, vi.fn(async (b, ui) => ({ uiVersion: b + 1, ui, conflict: false })), 10_000);
  const run = opts.run ?? vi.fn(async () => {});
  const ctx = (sp: ASAPExperienceSpec, prev: ASAPExperienceSpec | null = null): ExperienceCtx => {
    const r = reconcile(prev, sp);
    return { spec: r.spec, store, run, pending: new Set(), formResults: {}, changed: r.changed, added: r.added, narrow: opts.narrow ?? false };
  };
  const view = render(
    <ExperienceProvider value={ctx(s)}>
      <ExperienceRenderer />
    </ExperienceProvider>,
  );
  return {
    ...view,
    store,
    run,
    rerenderWith: (next: ASAPExperienceSpec) =>
      view.rerender(
        <ExperienceProvider value={ctx(next, s)}>
          <ExperienceRenderer />
        </ExperienceProvider>,
      ),
  };
}

describe("registry", () => {
  it("has exactly one view for every registered component", () => {
    expect(Object.keys(REGISTRY).sort()).toEqual(Object.keys(EXPERIENCE_COMPONENTS).sort());
  });
});

describe("three intentions render three different structures from one renderer", () => {
  it("client creation is a guided flow around a progressive form", () => {
    const { container } = mount(formSpec());
    expect(container.querySelector("[data-node=root].x-l-flow")).not.toBeNull();
    expect(screen.getByText("Who they are")).toBeTruthy();
    expect(screen.getByLabelText(/Client name/)).toBeTruthy();
    // The contact waits until asked for.
    expect(screen.queryByLabelText(/Contact's full name/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Add the primary contact now/ }));
    expect(screen.getByLabelText(/Contact's full name/)).toBeTruthy();
  });

  it("exploration is a table with filters and a detail region", () => {
    const { container } = mount(tableSpec());
    expect(container.querySelector("[data-node=root].x-l-table")).not.toBeNull();
    const table = screen.getByRole("table");
    expect(within(table).getByText("Acme Motors")).toBeTruthy();
    expect(within(table).getByText("KES 1,850,000.00")).toBeTruthy();
    expect(screen.getByText("Ending in October 2026")).toBeTruthy();
  });

  it("renewal work is a docked, multi-component working context", () => {
    const { container } = mount(dockSpec());
    expect(container.querySelector("[data-node=root].x-l-dock")).not.toBeNull();
    expect(screen.getByText("Acme Motors · Commercial motor")).toBeTruthy();
    expect(screen.getByRole("complementary", { name: "Context" })).toBeTruthy();
    expect(screen.getByText(/With Jubilee since/)).toBeTruthy();
  });
});

describe("safety in rendering", () => {
  it("an unregistered component renders as an error state, never as content", () => {
    const s = spec({ components: [{ ...comp("a", "Answer", {}), component: "HtmlBlock" as never }] });
    mount(s);
    expect(screen.getByRole("alert").textContent).toMatch(/could not be shown safely/);
  });

  it("props outside the component's contract are refused at render too", () => {
    mount(spec({ components: [comp("a", "Answer", { question: null, text: "Hi", items: [], source: "records", refused: false, html: "<b>x</b>" })] }));
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.queryByText("Hi")).toBeNull();
  });

  it("an unavailable action shows its reason instead of disappearing", () => {
    const s = formSpec();
    s.actions[0] = { ...s.actions[0]!, disabledReason: "Your role cannot add clients." };
    mount(s);
    expect(screen.getAllByText("Your role cannot add clients.").length).toBeGreaterThan(0);
  });

  it("a protected action asks for confirmation, listing what will happen, before it runs", async () => {
    const run = vi.fn(async () => {});
    const s = spec({
      components: [comp("start", "GovernedAction", { heading: "No renewal is open", explanation: "Starting opens the renewal.", effects: ["Opens the renewal as Work"], action: "start" }, { actions: ["start"] })],
      layout: { type: "stack", id: "root", gap: "normal", priority: "primary", responsive: { narrow: "keep" }, children: [slot("start")] },
      actions: [{ id: "start", label: "Start the renewal", class: "mutate", payload: { kind: "renewal.start", policyPeriodId: "44444444-4444-4444-8444-444444444444" }, primary: true, confirm: { heading: "Start the renewal?", effects: ["Nothing is sent until approved."] }, disabledReason: null }],
    });
    mount(s, { run });
    fireEvent.click(screen.getByRole("button", { name: "Start the renewal" }));
    expect(run).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Nothing is sent until approved.")).toBeTruthy();
    await act(async () => fireEvent.click(within(dialog).getByRole("button", { name: "Start the renewal" })));
    expect(run).toHaveBeenCalledWith("start", { instance: "start" });
  });
});

describe("continuity through recomposition", () => {
  it("typed input survives a newer composition of the same instance", () => {
    const view = mount(formSpec(1, "f-1"));
    fireEvent.change(screen.getByLabelText(/Client name/), { target: { value: "Wanjiru Holdings" } });
    view.rerenderWith(formSpec(2, "f-2"));
    expect((screen.getByLabelText(/Client name/) as HTMLInputElement).value).toBe("Wanjiru Holdings");
    expect(view.store.state.drafts["client"]!["name"]).toBe("Wanjiru Holdings");
  });

  it("a changed instance is marked Updated without moving focus", () => {
    const view = mount(formSpec(1, "f-1"));
    const input = screen.getByLabelText(/Client name/);
    input.focus();
    view.rerenderWith(formSpec(2, "f-2"));
    expect(screen.getByText("Updated")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText(/Client name/));
  });

  it("selecting a row dispatches the composed select action", async () => {
    const s = tableSpec();
    s.actions = [{ id: "pick", label: "Select", class: "interface", payload: { kind: "ui.select", target: "policies", ref: { type: "policy_period", id: "44444444-4444-4444-8444-444444444444", label: "Acme" } }, primary: false, confirm: null, disabledReason: null }];
    s.components[1] = { ...s.components[1]!, actions: ["pick"] };
    const run = vi.fn(async () => {});
    mount(s, { run });
    await act(async () => fireEvent.keyDown(screen.getByText("Acme Motors").closest("tr")!, { key: "Enter" }));
    expect(run).toHaveBeenCalledWith("pick", { ref: expect.objectContaining({ id: "44444444-4444-4444-8444-444444444444" }) });
  });
});

describe("responsive composition", () => {
  it("secondary content collapses behind a disclosure on a narrow screen", () => {
    const { container } = mount(dockSpec(), { narrow: true });
    const details = container.querySelector("details.x-collapsible");
    expect(details).not.toBeNull();
    expect(details!.hasAttribute("open")).toBe(false);
  });
});
