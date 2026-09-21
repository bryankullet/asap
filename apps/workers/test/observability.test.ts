import { describe, expect, it, vi } from "vitest";
import { loadWorkerEnv } from "@asap/schema/env/worker";
import { initObservability } from "../src/observability.js";

/**
 * Sentry is optional, and the worker says which error path is live.
 *
 * The failure this locks out is not a crash — it is the opposite. A worker that refused to start
 * without a DSN took the whole tier down to protect error reporting, and a worker that claimed
 * Sentry was on when no client was installed would be worse: nobody checks a log line they
 * believe is redundant.
 */

const STAGING = {
  APP_ENV: "staging",
  WORKER_DATABASE_URL: "postgresql://asap_worker:pw@db.example.com:5432/postgres",
  ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef0123456789ab",
  API_BASE_URL: "https://asap-api.example.com",
  API_INTERNAL_KEY: "0123456789abcdef0123",
} as const;

/** A DSN of the shape the Sentry client requires. Not a real project. */
const DSN = "https://0123456789abcdef0123456789abcdef@o123456.ingest.sentry.io/4507";

function fakeLogger() {
  const lines: { level: string; msg: string }[] = [];
  const record = (level: string) => (a: unknown, b?: unknown) =>
    lines.push({ level, msg: typeof a === "string" ? a : String(b) });
  return {
    lines,
    logger: { info: record("info"), warn: record("warn"), error: record("error") },
  };
}

describe("the worker starts without Sentry", () => {
  it("loads a staging environment with no SENTRY_DSN at all", () => {
    const env = loadWorkerEnv({ ...STAGING });
    expect(env.SENTRY_DSN).toBeUndefined();
    expect(env.APP_ENV).toBe("staging");
  });

  it("loads a production environment with no SENTRY_DSN either", () => {
    const env = loadWorkerEnv({ ...STAGING, APP_ENV: "production" });
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it("treats an empty SENTRY_DSN as absent rather than as a malformed one", () => {
    const env = loadWorkerEnv({ ...STAGING, SENTRY_DSN: "   " });
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it("says so in one clear line, and does not pretend reporting is on", () => {
    const { lines, logger } = fakeLogger();
    const state = initObservability({ APP_ENV: "staging" }, logger as never);
    expect(state).toEqual({ reporting: "none", reason: "no_dsn" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      level: "info",
      msg: "Sentry is not configured; errors will be available in Render logs.",
    });
  });
});

describe("the worker uses a DSN when one is supplied", () => {
  it("accepts a valid DSN and keeps it on the parsed environment", () => {
    const env = loadWorkerEnv({ ...STAGING, SENTRY_DSN: DSN });
    expect(env.SENTRY_DSN).toBe(DSN);
  });

  it("initialises the client with that DSN and the environment name", () => {
    const { logger } = fakeLogger();
    const install = vi.fn();
    const state = initObservability(
      { APP_ENV: "staging", SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "staging-eu" },
      logger as never,
      install,
    );
    expect(install).toHaveBeenCalledTimes(1);
    expect(install).toHaveBeenCalledWith({ dsn: DSN, environment: "staging-eu" });
    expect(state).toEqual({ reporting: "sentry" });
  });

  it("falls back to APP_ENV when SENTRY_ENVIRONMENT is not set", () => {
    const { logger } = fakeLogger();
    const install = vi.fn();
    initObservability({ APP_ENV: "production", SENTRY_DSN: DSN }, logger as never, install);
    expect(install).toHaveBeenCalledWith({ dsn: DSN, environment: "production" });
  });

  /*
   * The state this repository is actually in: a DSN can be configured, but no Sentry SDK is
   * installed, so there is no client to hand it to. The worker must still start, and must not
   * claim reporting it does not have.
   */
  it("starts anyway when a DSN is given but no client is installed, and says which it is", () => {
    const { lines, logger } = fakeLogger();
    const state = initObservability({ APP_ENV: "staging", SENTRY_DSN: DSN }, logger as never);
    expect(state).toMatchObject({ reporting: "none", reason: "client_not_installed" });
    expect(lines[0]?.level).toBe("warn");
    expect(lines[0]?.msg).toMatch(/no Sentry client is installed/);
  });

  it("never writes the DSN into the log", () => {
    const { lines, logger } = fakeLogger();
    initObservability({ APP_ENV: "staging", SENTRY_DSN: DSN }, logger as never);
    initObservability({ APP_ENV: "staging", SENTRY_DSN: DSN }, logger as never, vi.fn());
    for (const line of lines) expect(line.msg).not.toContain(DSN);
  });
});

describe("a supplied DSN must be a DSN", () => {
  const rejected: [string, string][] = [
    ["not a URL at all", "o123456.ingest.sentry.io/4507"],
    ["no public key", "https://o123456.ingest.sentry.io/4507"],
    ["no project id", "https://0123456789abcdef@o123456.ingest.sentry.io"],
    ["a non-numeric project id", "https://0123456789abcdef@o123456.ingest.sentry.io/my-project"],
    ["a secret key as well as a public one", "https://public:secret@o123456.ingest.sentry.io/4507"],
    ["the dashboard URL pasted by mistake", "https://sentry.io/organizations/acme/projects/asap-worker/"],
  ];

  for (const [why, value] of rejected) {
    it(`refuses ${why}`, () => {
      expect(() => loadWorkerEnv({ ...STAGING, SENTRY_DSN: value })).toThrow(/SENTRY_DSN/);
    });
  }
});

describe("making Sentry optional loosened nothing else", () => {
  const required = [
    "WORKER_DATABASE_URL",
    "ENCRYPTION_KEY",
    "API_BASE_URL",
    "API_INTERNAL_KEY",
    "APP_ENV",
  ] as const;

  for (const key of required) {
    it(`still requires ${key}`, () => {
      const raw: Record<string, string | undefined> = { ...STAGING };
      delete raw[key];
      expect(() => loadWorkerEnv(raw)).toThrow(new RegExp(key));
    });
  }

  it("still refuses a connection string that authenticates as postgres", () => {
    expect(() =>
      loadWorkerEnv({
        ...STAGING,
        WORKER_DATABASE_URL: "postgresql://postgres:pw@db.example.com:5432/postgres",
      }),
    ).toThrow(/asap_worker/);
  });

  it("still refuses an internal key too short to be one", () => {
    expect(() => loadWorkerEnv({ ...STAGING, API_INTERNAL_KEY: "short" })).toThrow(
      /API_INTERNAL_KEY/,
    );
  });

  it("still refuses a poll interval outside the allowed range", () => {
    expect(() => loadWorkerEnv({ ...STAGING, EVENT_POLL_MS: "10" })).toThrow(/EVENT_POLL_MS/);
  });
});
