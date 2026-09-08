import type { SupabaseClient } from "@supabase/supabase-js";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { newBootToken, recoverOrphanedRuns } from "./recovery.js";

describe("run recovery on boot", () => {
  it("asks the database to end every run started under another boot token", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const service = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        return { data: ["40000000-0000-4000-8000-000000000001"], error: null };
      },
    } as unknown as SupabaseClient;
    const token = newBootToken();
    const ids = await recoverOrphanedRuns(service, token, pino({ level: "silent" }));
    expect(calls).toEqual([{ name: "runs_recover", args: { p_boot_token: token } }]);
    expect(ids).toEqual(["40000000-0000-4000-8000-000000000001"]);
  });

  it("boot tokens are unique per process start", () => {
    expect(newBootToken()).not.toBe(newBootToken());
    expect(newBootToken()).toMatch(new RegExp(`^${process.pid}-`));
  });

  it("a failed recovery is logged, not thrown, so the API still boots", async () => {
    const service = {
      rpc: async () => ({ data: null, error: { message: "boom" } }),
    } as unknown as SupabaseClient;
    await expect(recoverOrphanedRuns(service, "t", pino({ level: "silent" }))).resolves.toEqual([]);
  });
});
