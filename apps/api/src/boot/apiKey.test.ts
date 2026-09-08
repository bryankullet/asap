import type { SupabaseClient } from "@supabase/supabase-js";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { hashApiKey, registerApiKey } from "./apiKey.js";

/** Mirrors 0025: one active hash at a time. */
function fakeService() {
  const active = new Set<string>();
  const revoked: string[] = [];
  const calls: unknown[] = [];
  const service = {
    rpc: async (name: string, args: { p_key_hash: string }) => {
      calls.push([name, args]);
      if (active.has(args.p_key_hash)) return { data: false, error: null };
      revoked.push(...active);
      active.clear();
      active.add(args.p_key_hash);
      return { data: true, error: null };
    },
  } as unknown as SupabaseClient;
  return { service, active, revoked, calls };
}

const KEY_A = "a".repeat(40);
const KEY_B = "b".repeat(40);
const log = pino({ level: "silent" });

describe("api key self-registration on boot", () => {
  it("two boots with the same key register once", async () => {
    const f = fakeService();
    expect(await registerApiKey(f.service, KEY_A, log)).toBe("registered");
    expect(await registerApiKey(f.service, KEY_A, log)).toBe("already_active");
    expect(f.active.size).toBe(1);
    expect(f.revoked).toEqual([]);
  });

  it("a boot with a new key revokes the old", async () => {
    const f = fakeService();
    await registerApiKey(f.service, KEY_A, log);
    expect(await registerApiKey(f.service, KEY_B, log)).toBe("registered");
    expect(f.revoked).toEqual([hashApiKey(KEY_A)]);
    expect([...f.active]).toEqual([hashApiKey(KEY_B)]);
  });

  it("only the hash leaves the process", async () => {
    const f = fakeService();
    await registerApiKey(f.service, KEY_A, log);
    expect(JSON.stringify(f.calls)).not.toContain(KEY_A);
    expect(hashApiKey(KEY_A)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a failure is reported, not thrown", async () => {
    const service = {
      rpc: async () => ({ data: null, error: { code: "42501", message: "denied" } }),
    } as unknown as SupabaseClient;
    expect(await registerApiKey(service, KEY_A, log)).toBe("failed");
  });
});
