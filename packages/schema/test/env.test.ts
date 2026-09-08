import { describe, expect, it } from "vitest";
import { EnvValidationError, loadPublicEnv } from "../src/env/index.js";
import { loadServerEnv } from "../src/env/server.js";
import { loadWorkerEnv } from "../src/env/worker.js";

const KEY = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="; // 32 zero bytes, base64

const validServer = {
  APP_ENV: "local",
  API_BASE_URL: "http://localhost:8787",
  WEB_BASE_URL: "http://localhost:5173",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SUPABASE_JWT_SECRET: "jwt",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  ENCRYPTION_KEY: KEY,
  API_INTERNAL_KEY: "test-internal-key-with-thirty-two-characters",
};

describe("loadServerEnv", () => {
  it("parses a minimal local configuration and applies defaults", () => {
    const env = loadServerEnv(validServer);
    expect(env.API_PORT).toBe(8787);
    expect(env.SIGNED_URL_TTL_SECONDS).toBe(300);
    expect(env.FEATURE_EXTERNAL_SEND_ENABLED).toBe(false);
  });

  it("names every missing required variable and never echoes values", () => {
    const { SUPABASE_SERVICE_ROLE_KEY: _drop, ...raw } = validServer;
    let caught: unknown;
    try {
      loadServerEnv({ ...raw, ENCRYPTION_KEY: "too-short-secret-value" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(EnvValidationError);
    const err = caught as EnvValidationError;
    const vars = err.issues.map((i) => i.variable);
    expect(vars).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(vars).toContain("ENCRYPTION_KEY");
    expect(err.message).not.toContain("too-short-secret-value");
  });

  it("caps SIGNED_URL_TTL_SECONDS at one hour", () => {
    expect(() => loadServerEnv({ ...validServer, SIGNED_URL_TTL_SECONDS: "86400" })).toThrow(
      /SIGNED_URL_TTL_SECONDS/,
    );
  });

  it('treats the string "false" as false for feature flags', () => {
    expect(loadServerEnv({ ...validServer, FEATURE_AI_ENABLED: "false" }).FEATURE_AI_ENABLED).toBe(
      false,
    );
  });

  it("requires Sentry and Postmark outside local", () => {
    expect(() => loadServerEnv({ ...validServer, APP_ENV: "staging" })).toThrow(
      /SENTRY_DSN[\s\S]*POSTMARK_SERVER_TOKEN/,
    );
  });

  it("rejects a password minimum below 12", () => {
    expect(() => loadServerEnv({ ...validServer, PASSWORD_MIN_LENGTH: "8" })).toThrow(
      /PASSWORD_MIN_LENGTH/,
    );
  });
});

describe("loadWorkerEnv", () => {
  it("refuses a worker connection string that logs in as postgres", () => {
    expect(() =>
      loadWorkerEnv({
        APP_ENV: "local",
        WORKER_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
        ENCRYPTION_KEY: KEY,
      }),
    ).toThrow(/asap_worker/);
  });

  it("accepts asap_worker", () => {
    const env = loadWorkerEnv({
      APP_ENV: "local",
      WORKER_DATABASE_URL: "postgresql://asap_worker:pw@127.0.0.1:54322/postgres",
      ENCRYPTION_KEY: KEY,
  API_INTERNAL_KEY: "test-internal-key-with-thirty-two-characters",
    });
    expect(env.LOG_LEVEL).toBe("info");
  });
});

describe("loadPublicEnv", () => {
  it("accepts only VITE_PUBLIC_ variables and ignores the rest", () => {
    const env = loadPublicEnv({
      VITE_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      VITE_PUBLIC_SUPABASE_ANON_KEY: "anon",
      VITE_PUBLIC_API_BASE_URL: "http://localhost:8787",
      VITE_PUBLIC_APP_ENV: "local",
      SUPABASE_SERVICE_ROLE_KEY: "must-not-appear",
    });
    expect(Object.keys(env)).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });
});
