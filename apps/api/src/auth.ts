import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { MiddlewareHandler } from "hono";
import { HttpError, sendError } from "./errors.js";
import type { SupabaseFactory } from "./supabase.js";

export type AuthState = {
  user: User;
  accessToken: string;
  /** supabase-js client bound to the caller's session. RLS applies. */
  db: SupabaseClient;
};

declare module "hono" {
  interface ContextVariableMap {
    auth: AuthState;
  }
}

/**
 * Requires `Authorization: Bearer <supabase access token>`. Validates the token with Supabase Auth
 * (server round-trip rather than local verification: a revoked or signed-out session must fail
 * immediately, and new projects sign with rotating asymmetric keys).
 */
export function requireUser(supabase: SupabaseFactory): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match?.[1]) return sendError(c, new HttpError(401, "missing_bearer_token"));

    const accessToken = match[1];
    const db = supabase.forUser(accessToken);
    const { data, error } = await db.auth.getUser(accessToken);
    if (error || !data.user) return sendError(c, new HttpError(401, "invalid_session"));

    c.set("auth", { user: data.user, accessToken, db });
    await next();
  };
}
