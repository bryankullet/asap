import { emptyUiState, validateExperienceSpec } from "@asap/schema";
import { describe, expect, it, vi } from "vitest";
import { reconcile, RequestSequencer } from "../experience/composition/CompositionReconciler.js";
import { ContinuityStore } from "../experience/continuity/ContinuityStore.js";
import { comp, dockSpec, formSpec, spec, tableSpec } from "./fixtures.js";

describe("fixtures are valid compositions", () => {
  it.each([["form", formSpec()], ["table", tableSpec()], ["dock", dockSpec()]])("%s", (_n, s) => {
    expect(validateExperienceSpec(s).ok).toBe(true);
  });
});

describe("reconcile", () => {
  it("never lets an older revision replace a newer one", () => {
    const r = reconcile(formSpec(3), formSpec(2));
    expect(r.stale).toBe(true);
    expect(r.spec.revision).toBe(3);
  });

  it("keeps unchanged instances, marks changed and added ones, and lists removed ones", () => {
    const prev = spec({ components: [comp("a", "Answer", { question: null, text: "A", items: [], source: "records", refused: false }), comp("b", "Answer", { question: null, text: "B", items: [], source: "records", refused: false })] });
    const next = spec({
      revision: 2,
      components: [comp("a", "Answer", { question: null, text: "A", items: [], source: "records", refused: false }), comp("b", "Answer", { question: null, text: "B2", items: [], source: "records", refused: false }, { hash: "b-2" }), comp("c", "Answer", { question: null, text: "C", items: [], source: "records", refused: false })],
    });
    const r = reconcile(prev, next);
    expect([...r.changed]).toEqual(["b"]);
    expect([...r.added]).toEqual(["c"]);
    expect(r.removed).toEqual([]);
    const gone = reconcile(next, spec({ revision: 3 }));
    expect(gone.removed).toEqual(["b", "c"]);
  });

  it("reports a pending action the new composition withdrew, with its reason", () => {
    const prev = formSpec(1);
    const next = { ...formSpec(2), actions: [], withdrawn: [{ action: "save", reason: "Your role changed: you can no longer add clients." }] };
    next.components = next.components.map((c) => ({ ...c, actions: [], props: { ...c.props, submit: "save" } }));
    const r = reconcile(prev, next, new Set(["save"]));
    expect(r.withdrawnPending).toEqual([{ action: "save", reason: "Your role changed: you can no longer add clients." }]);
  });

  it("treats another experience as a fresh composition", () => {
    const r = reconcile(formSpec(5), { ...tableSpec(), experienceId: "55555555-5555-4555-8555-555555555555", revision: 1 });
    expect(r.stale).toBe(false);
    expect(r.added.size).toBe(0);
  });
});

describe("RequestSequencer", () => {
  it("drops a response that arrives after a later one was applied", () => {
    const s = new RequestSequencer();
    const first = s.ticket();
    const second = s.ticket();
    expect(s.accept(second)).toBe(true);
    expect(s.accept(first)).toBe(false);
    expect(s.pending).toBe(0);
  });
});

describe("ContinuityStore", () => {
  it("debounces saves and sends the version it was based on", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async (base: number, ui: ReturnType<typeof emptyUiState>) => ({ uiVersion: base + 1, ui, conflict: false }));
    const store = new ContinuityStore("x", emptyUiState(), 4, save, 100);
    store.setDraft("client", "name", "Ac");
    store.setDraft("client", "name", "Acme");
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![0]).toBe(4);
    expect(save.mock.calls[0]![1].drafts["client"]!["name"]).toBe("Acme");
    expect(store.uiVersion).toBe(5);
    vi.useRealTimers();
  });

  it("merges on conflict: the other tab's state, with this tab's unsaved typing on top", async () => {
    const other = { ...emptyUiState(), revealed: ["s-detail"], drafts: { client: { name: "Old" } } };
    const save = vi
      .fn()
      .mockResolvedValueOnce({ uiVersion: 7, ui: other, conflict: true })
      .mockImplementation(async (base: number, ui: unknown) => ({ uiVersion: base + 1, ui, conflict: false }));
    const store = new ContinuityStore("x", emptyUiState(), 6, save, 10_000);
    store.setDraft("client", "name", "Acme Motors");
    await store.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0]).toBe(7);
    expect(store.state.revealed).toEqual(["s-detail"]);
    expect(store.state.drafts["client"]!["name"]).toBe("Acme Motors");
    expect(store.uiVersion).toBe(8);
  });

  it("replays unsaved edits over a server response, so recomposition never erases typing", () => {
    const store = new ContinuityStore("x", emptyUiState(), 1, vi.fn(), 10_000);
    store.setDraft("client", "name", "Half typed");
    store.adopt({ ...emptyUiState(), revealed: ["more"] }, 2);
    expect(store.state.drafts["client"]!["name"]).toBe("Half typed");
    expect(store.state.revealed).toEqual(["more"]);
    store.adopt(emptyUiState(), 1);
    expect(store.uiVersion).toBe(2);
  });

  it("keeps edits when saving fails, to retry later", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("offline")).mockImplementation(async (base: number, ui: unknown) => ({ uiVersion: base + 1, ui, conflict: false }));
    const store = new ContinuityStore("x", emptyUiState(), 0, save, 10_000);
    store.setAsk("compare the quotes");
    await store.flush();
    expect(store.hasUnsaved).toBe(true);
    await store.flush();
    expect(store.hasUnsaved).toBe(false);
  });
});
