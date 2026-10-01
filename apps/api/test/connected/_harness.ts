/**
 * The connected harness: the real API, through the production Supabase factory, to a real
 * PostgREST in front of a disposable database built from the migrations. Shared by every connected
 * test so each meets exactly the same wiring. See placement-lifecycle.test.ts for the reasoning.
 *
 * The one stand-in is Supabase Auth's token lookup (`GET /auth/v1/user`), answered from the same
 * HS256 token PostgREST verifies. No service-role key is used anywhere.
 */
import { createHmac, randomUUID } from "node:crypto";
import pino from "pino";
import { fakeProvider, type FakeScript } from "../../src/ai/providers/fake.js";
import { createApp } from "../../src/app.js";
import type { Mailer } from "../../src/mail/index.js";
import { createSupabaseFactory } from "../../src/supabase.js";

export const REST = process.env["CONNECTED_POSTGREST_URL"]!;
const SECRET = process.env["CONNECTED_JWT_SECRET"]!;
export const OWNER = process.env["CONNECTED_OWNER_URL"]!;

export const ORG_A = "10000000-0000-4000-8000-00000000000a";
export const ORG_B = "10000000-0000-4000-8000-00000000000b";
export type Person = { id: string; email: string };
export const AMINA: Person = { id: "a0000000-0000-4000-8000-000000000001", email: "amina@connected.test" }; // administrator, A
export const KAMAU: Person = { id: "a0000000-0000-4000-8000-000000000002", email: "kamau@connected.test" }; // account executive, A
export const BETA: Person = { id: "b0000000-0000-4000-8000-000000000001", email: "beta@connected.test" }; // administrator, B
export const READER: Person = { id: "c0000000-0000-4000-8000-000000000001", email: "reader@connected.test" }; // read-only, A
export const ACME = "70000000-0000-4000-8000-00000000000a";
export const JUBILEE = "60000000-0000-4000-8000-00000000000a";
export const CIC = "60000000-0000-4000-8000-00000000000b";
const SUPABASE = "http://supabase.connected.test";

const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
export function jwt(claims: Record<string, unknown>): string {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
  return `${head}.${body}.${createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url")}`;
}
export const token = (u: Person) => jwt({ sub: u.id, email: u.email, role: "authenticated", aud: "authenticated" });

/** `/rest/v1/*` goes to PostgREST; `/auth/v1/user` is answered from the verified token. */
const transport: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  if (url.startsWith(`${SUPABASE}/auth/v1/user`)) {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const [head, body, sig] = auth.replace(/^Bearer\s+/i, "").split(".");
    const valid = sig !== undefined && createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url") === sig;
    if (!valid) return new Response(JSON.stringify({ msg: "invalid token" }), { status: 401 });
    const claims = JSON.parse(Buffer.from(body!, "base64url").toString()) as { sub: string; email: string };
    return new Response(
      JSON.stringify({ id: claims.sub, email: claims.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" }),
      { headers: { "content-type": "application/json" } },
    );
  }
  if (url.startsWith(`${SUPABASE}/rest/v1`)) return fetch(url.replace(`${SUPABASE}/rest/v1`, REST), init);
  throw new Error(`connected test: unexpected request to ${url}`);
};

/** A fresh server-held key for one test file; the caller registers its hash as the owner. */
export const newApiKey = () => `connected-internal-key-${randomUUID()}`;

const silentMailer = { send: async () => ({ ok: true as const }), sendInvitation: async () => {} } as unknown as Mailer;
export const buildApp = (apiKey: string, askScript: FakeScript = [], webBaseUrl = "http://localhost:5173") =>
  createApp({
    logger: pino({ level: process.env["CONNECTED_LOG"] ?? "silent" }),
    build: { version: "connected", commit: "connected" },
    supabase: createSupabaseFactory({
      url: SUPABASE,
      anonKey: jwt({ role: "anon" }),
      serviceRoleKey: "not-a-key: the connected test never uses the service role",
      apiInternalKey: apiKey,
      fetch: transport,
    }),
    mailer: silentMailer,
    webBaseUrl,
    invitationTtlHours: 168,
    exposeAcceptUrl: false,
    executor: () => async () => {},
    bootToken: "connected",
    aiProvider: fakeProvider(askScript),
  });

// Test-only: bodies are asserted field by field against the contracts.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
export function caller(getApp: () => ReturnType<typeof createApp>) {
  return async (who: Person, method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> => {
    const res = await getApp().request(path, {
      method,
      headers: { Authorization: `Bearer ${token(who)}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text === "" ? null : JSON.parse(text) };
  };
}

/** Straight to PostgREST with a person's own session: what a browser holding the anon key can do. */
export async function browser(who: Person | "anon", method: string, path: string, body?: unknown) {
  const res = await fetch(`${REST}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${who === "anon" ? jwt({ role: "anon" }) : token(who)}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text === "" ? null : (JSON.parse(text) as Json) };
}
