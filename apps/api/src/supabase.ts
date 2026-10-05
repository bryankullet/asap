import { createHmac } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Three clients, three trust levels.
 *  - anon:    no session. Used only for the invitation preview (the token is the credential).
 *  - forUser: the caller's access token. RLS applies. Every tenant read and write in the API.
 *  - service: bypasses RLS. Confined to server-side admin paths (storage signed URLs later).
 *             Never used to read tenant data on a user's behalf.
 *  - forEngine: the engine reading ONE brokerage under RLS (D-149): a five-minute worker-role
 *             token naming the organization, signed with the project's JWT secret. Read-only use;
 *             null when no secret is configured.
 * Injected into createApp so tests can substitute fakes.
 */
export type SupabaseFactory = {
  anon(): SupabaseClient;
  forUser(accessToken: string): SupabaseClient;
  service(): SupabaseClient;
  forEngine?(organizationId: string): SupabaseClient | null;
};

const b64url = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
/** HS256, the project's legacy JWT secret: what PostgREST verifies a worker-role token with. */
export function engineToken(secret: string, organizationId: string, now = Date.now()): string {
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url({ role: "asap_worker", organization_id: organizationId, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 300 });
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

export function createSupabaseFactory(config: {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  /** Sent as x-asap-api-key; 0023's engine functions refuse writes without it. Server-only. */
  apiInternalKey: string;
  /** The project's JWT secret, for the engine's one-brokerage reads (D-149). Optional. */
  jwtSecret?: string;
  /**
   * The transport. Production leaves it unset. The connected lifecycle test passes one that sends
   * `/rest/v1` to a local PostgREST and answers `/auth/v1/user` from its signed test token.
   */
  fetch?: typeof fetch;
}): SupabaseFactory {
  const base = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(config.fetch === undefined ? {} : { global: { fetch: config.fetch } }),
  };
  return {
    anon: () => createClient(config.url, config.anonKey, base),
    forUser: (accessToken) =>
      createClient(config.url, config.anonKey, {
        ...base,
        global: {
          ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "x-asap-api-key": config.apiInternalKey,
          },
        },
      }),
    service: () => createClient(config.url, config.serviceRoleKey, base),
    forEngine: (organizationId) =>
      config.jwtSecret
        ? createClient(config.url, config.anonKey, {
            ...base,
            global: { ...(config.fetch === undefined ? {} : { fetch: config.fetch }), headers: { Authorization: `Bearer ${engineToken(config.jwtSecret, organizationId)}` } },
          })
        : null,
  };
}
