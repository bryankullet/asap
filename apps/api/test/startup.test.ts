import { describe, expect, it } from "vitest";
import { EnvValidationError } from "@asap/schema";
import { loadServerEnv } from "@asap/schema/env/server";

/**
 * Work item 2 acceptance: starting apps/api with a missing required variable fails
 * immediately with a message naming the variable. server.ts calls loadServerEnv() before
 * anything else, so this is the behaviour under test.
 */
describe("api startup", () => {
  it("refuses to start without SUPABASE_JWT_SECRET and names it", () => {
    expect(() =>
      loadServerEnv({
        APP_ENV: "local",
        API_BASE_URL: "http://localhost:8787",
        WEB_BASE_URL: "http://localhost:5173",
        SUPABASE_URL: "http://127.0.0.1:54321",
        SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
        DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        API_INTERNAL_KEY: "test-internal-key-with-thirty-two-characters",
      }),
    ).toThrow(EnvValidationError);
    try {
      loadServerEnv({ APP_ENV: "local" });
    } catch (e) {
      expect((e as Error).message).toMatch(/SUPABASE_JWT_SECRET: missing/);
    }
  });
});
