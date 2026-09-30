import { loadServerEnv } from "@asap/schema/env/server";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { resolveProvider } from "../src/ai/gateway.js";

/*
 * The production path: the same env parser server.ts calls, then the same provider resolution.
 * What is proved is which provider serves Ask for a given set of variables, and that the safe
 * startup line never carries the key.
 */
const BASE = {
  APP_ENV: "local",
  API_BASE_URL: "http://localhost:8787",
  WEB_BASE_URL: "http://localhost:5173",
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  SUPABASE_JWT_SECRET: "jwt-secret",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  API_INTERNAL_KEY: "test-internal-key-with-thirty-two-characters",
};
// A runtime test value joined from safe fragments, so no key-shaped literal sits in source.
const KEY = ["sk", "ant", "test", "never", "real", "0000"].join("-");

function boot(vars: Record<string, string>) {
  const lines: string[] = [];
  const logger = pino({ level: "info" }, { write: (l: string) => lines.push(l) });
  const provider = resolveProvider(loadServerEnv({ ...BASE, ...vars }), logger);
  return { provider, log: lines.join("") };
}

describe("AI gateway configuration", () => {
  it("the three Anthropic variables produce a configured Anthropic gateway, with a safe startup line", () => {
    const { provider, log } = boot({ AI_DEFAULT_PROVIDER: "anthropic", AI_MODEL: "claude-opus-5", ANTHROPIC_API_KEY: KEY });
    expect(provider).toMatchObject({ id: "anthropic", model: "claude-opus-5" });
    expect(log).toContain("AI gateway: provider=anthropic model=claude-opus-5 configured=true keyPresent=true");
    expect(log).not.toContain(KEY);
    // Anything built from the provider that could reach a browser response carries no key.
    expect(JSON.stringify(provider)).not.toContain(KEY);
  });

  it("a key with a trailing newline or spaces still counts; the model name is kept exactly", () => {
    const { provider } = boot({ AI_DEFAULT_PROVIDER: "anthropic", AI_MODEL: " claude-opus-5\n", ANTHROPIC_API_KEY: KEY + "\n" });
    expect(provider).toMatchObject({ id: "anthropic", model: "claude-opus-5" });
  });

  it("a missing or blank key leaves Ask unconfigured, and says so without the key", () => {
    expect(boot({ AI_DEFAULT_PROVIDER: "anthropic", AI_MODEL: "claude-opus-5" }).provider).toBeNull();
    const blank = boot({ AI_DEFAULT_PROVIDER: "anthropic", AI_MODEL: "claude-opus-5", ANTHROPIC_API_KEY: "   " });
    expect(blank.provider).toBeNull();
    expect(blank.log).toContain("configured=false keyPresent=false");
  });

  it("an unrelated optional provider variable cannot disturb Anthropic", () => {
    const { provider } = boot({ AI_DEFAULT_PROVIDER: "anthropic", AI_MODEL: "claude-opus-5", ANTHROPIC_API_KEY: KEY, OPENAI_API_KEY: "" });
    expect(provider?.id).toBe("anthropic");
  });

  it("without AI_DEFAULT_PROVIDER the default is openai — the state the live service was in", () => {
    const { provider, log } = boot({ AI_MODEL: "claude-opus-5", ANTHROPIC_API_KEY: KEY });
    expect(provider).toBeNull();
    expect(log).toContain("provider=openai");
    expect(log).not.toContain(KEY);
  });
});
