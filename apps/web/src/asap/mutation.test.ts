import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MUTATION_TIMEOUT_MS, REFRESH_WAIT_MS, createRefresher, lifecycleOf, runMutation } from "./mutation.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const never = () => new Promise<never>(() => {});

describe("runMutation — every write settles", () => {
  it("succeeds as soon as the server answers", async () => {
    const res = await runMutation(() => Promise.resolve({ ok: true, text: "Saved" }));
    expect(res).toMatchObject({ ok: true, status: "succeeded", text: "Saved" });
  });

  it("a write that never answers fails at the deadline, and says the retry is safe", async () => {
    const p = runMutation(never);
    await vi.advanceTimersByTimeAsync(MUTATION_TIMEOUT_MS + 1);
    const res = await p;
    expect(res).toMatchObject({ ok: false, timeout: true, status: "failed" });
    expect(res.error).toMatch(/retrying is safe/);
  });

  it("a thrown write is a failure with the reason, never an unhandled pending state", async () => {
    const res = await runMutation(() => Promise.reject(new Error("The policy is already renewed")), { describe: (e) => (e as Error).message });
    expect(res).toMatchObject({ ok: false, status: "failed" });
    expect(res.error).toBe("The policy is already renewed. Nothing was changed — you can retry.");
  });

  it("a refusal is blocked, not failed", () => {
    expect(lifecycleOf({ ok: false, denied: true })).toBe("blocked");
    expect(lifecycleOf({ ok: false, blocked: true })).toBe("blocked");
    expect(lifecycleOf(undefined)).toBe("failed");
  });
});

describe("createRefresher — the re-read never holds a write", () => {
  it("a slow re-read releases the write after the wait, then applies and notifies when it lands", async () => {
    let finish: (v: string) => void = () => {};
    const apply = vi.fn();
    const r = createRefresher(() => new Promise<string>((res) => (finish = res)), apply);
    const seen = vi.fn();
    r.onChange(seen);

    let released = false;
    void r.refresh().then(() => (released = true));
    await vi.advanceTimersByTimeAsync(REFRESH_WAIT_MS + 1);
    expect(released).toBe(true);
    expect(apply).not.toHaveBeenCalled();

    finish("fresh");
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).toHaveBeenCalledWith("fresh");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(r.status.stale).toBe(false);
  });

  it("a failed re-read keeps what is on screen, marks it stale, and never rejects", async () => {
    const apply = vi.fn();
    const r = createRefresher(() => Promise.reject(new Error("offline")), apply);
    await expect(r.refresh()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(0);
    expect(apply).not.toHaveBeenCalled();
    expect(r.status).toMatchObject({ stale: true, lastError: "offline" });
  });

  it("writes during a re-read coalesce into one more re-read, not one each", async () => {
    let calls = 0;
    const resolvers: Array<() => void> = [];
    const r = createRefresher(() => { calls += 1; return new Promise<void>((res) => resolvers.push(res)); }, () => {});
    void r.refresh();
    void r.refresh();
    void r.refresh();
    expect(calls).toBe(1);
    resolvers[0]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
    resolvers[1]!();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toBe(2);
  });
});
