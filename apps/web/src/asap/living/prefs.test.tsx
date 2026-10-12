import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_PREFS, useSurfacePrefs } from "./prefs.js";

/*
 * The race behind the intermittent "keeps what the person arranged" failure (D-170): a person
 * arranges a block in the moment between the surface rendering and its saved arrangement being
 * asked for. What they did must win over the late, empty read — and be saved.
 */
describe("useSurfacePrefs", () => {
  it("keeps an arrangement made before the surface's key arrived, and saves it", async () => {
    const put = vi.fn(async () => {});
    const store = { get: vi.fn(async () => EMPTY_PREFS), put };
    const { result, rerender } = renderHook(({ k }: { k: string | null }) => useSurfacePrefs(store, k), { initialProps: { k: null as string | null } });
    act(() => result.current.update((p) => ({ ...p, collapsed: ["quotes"] })));
    rerender({ k: "renewal:1" });
    await waitFor(() => expect(store.get).toHaveBeenCalledWith("renewal:1"));
    await waitFor(() => expect(put).toHaveBeenCalled());
    expect(result.current.prefs.collapsed).toEqual(["quotes"]);
    expect((put.mock.calls.at(-1) as unknown as [string, { collapsed: string[] }])[1].collapsed).toEqual(["quotes"]);
  });

  it("starts afresh on a different surface", async () => {
    const store = { get: vi.fn(async () => EMPTY_PREFS), put: vi.fn(async () => {}) };
    const { result, rerender } = renderHook(({ k }: { k: string | null }) => useSurfacePrefs(store, k), { initialProps: { k: "renewal:1" as string | null } });
    await waitFor(() => expect(store.put).toHaveBeenCalled());
    act(() => result.current.update((p) => ({ ...p, pinned: ["quotes"] })));
    rerender({ k: "claim:2" });
    await waitFor(() => expect(store.get).toHaveBeenCalledWith("claim:2"));
    await waitFor(() => expect(result.current.prefs.pinned).toEqual([]));
  });
});
