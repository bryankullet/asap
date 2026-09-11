import type { ApiError } from "@asap/schema";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "HttpError";
  }
}

/** Shape of the error object supabase-js returns from .rpc() / .from() calls. */
export type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
};

/**
 * The 0014 functions raise with a stable message token (e.g. 'invitation_expired') and an
 * SQLSTATE that groups them. Map both to HTTP without leaking database internals.
 */
export function mapDatabaseError(err: PostgrestErrorLike): HttpError {
  const token = (err.message ?? "").trim().split(/\s/)[0] ?? "";
  switch (err.code) {
    case "28000": // not_authenticated
      return new HttpError(401, "not_authenticated");
    case "42501": // permission_denied, not_a_member, invitation_email_mismatch, RLS violations
      return new HttpError(403, token || "permission_denied");
    case "23514": // check constraints: client_must_land_not_started, vocabulary violations
      return new HttpError(422, token && !token.includes(" ") ? token : "invalid_request");
    case "P0002": // not_found
      return new HttpError(404, "not_found");
    case "23505": // already_a_member, unique violations
      return new HttpError(409, token && !token.includes(" ") ? token : "conflict");
    case "22023": // validation tokens: terms_not_accepted, invalid_country, invitation_expired, ...
      return new HttpError(422, token || "invalid_request");
    case "42P01": // undefined_table
    case "42703": // undefined_column
      /*
       * The database is behind the code: a migration this build needs has not been applied. It is
       * not the caller's fault and it is not a generic fault either — saying so is what turns a
       * mystifying "we could not load your account" into an action somebody can take.
       */
      return new HttpError(503, "schema_behind");
    case "42883": // undefined_function — a migration adding an RPC has not been applied
      return new HttpError(503, "schema_behind");
    case "PGRST301": // JWT expired / invalid
    case "PGRST302":
      return new HttpError(401, "invalid_session");
    default:
      return new HttpError(500, "database_error");
  }
}

export function errorBody(code: string, message?: string, details?: unknown): ApiError {
  return {
    error: code,
    ...(message ? { message } : {}),
    ...(details !== undefined ? { details } : {}),
  };
}

export function sendError(c: Context, err: HttpError, details?: unknown) {
  return c.json(
    errorBody(err.code, err.message !== err.code ? err.message : undefined, details),
    err.status,
  );
}
