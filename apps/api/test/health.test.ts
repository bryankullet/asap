import { healthResponseSchema } from "@asap/schema";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { fakeFactory } from "./_fake-supabase.js";

const app = createApp({
  logger: pino({ level: "silent" }),
  build: { version: "0.1.0-test", commit: "abc123def456" },
  supabase: fakeFactory({ tables: {}, rpc: {}, users: {}, inserts: [] }),
  mailer: { sendInvitation: async () => {} },
  webBaseUrl: "http://localhost:5173",
  invitationTtlHours: 168,
  exposeAcceptUrl: false,
  executor: () => async () => {},
  bootToken: "test-boot",
});

describe("GET /health", () => {
  it("answers with the shared HealthResponse contract", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(await res.json());
    expect(body).toEqual({ status: "ok", version: "0.1.0-test", commit: "abc123def456" });
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
