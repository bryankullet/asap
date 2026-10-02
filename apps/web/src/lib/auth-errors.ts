import { env } from "../env.js";

/**
 * Telling a sign-in that could not reach Supabase apart from one Supabase refused.
 *
 * "Failed to fetch" means the browser never got an answer — DNS, TLS, a dropped connection, a
 * blocked request. A wrong password is an answer (400 invalid_credentials). Reporting both as "That
 * email and password do not match" sent people to reset passwords for a network fault.
 */
export type AuthFailure =
  | { kind: "network"; host: string; at: string }
  | { kind: "credentials" }
  | { kind: "unconfirmed" }
  | { kind: "already_registered" }
  | { kind: "other"; message: string; status: number | null };

export const supabaseHost = (() => {
  try {
    return new URL(env.VITE_PUBLIC_SUPABASE_URL).hostname;
  } catch {
    return "the sign-in service";
  }
})();

export function classifyAuthError(error: { message?: string | undefined; status?: number | undefined; name?: string | undefined; code?: string | undefined } | null | undefined): AuthFailure | null {
  if (!error) return null;
  const message = error.message ?? "";
  const status = typeof error.status === "number" ? error.status : null;
  // supabase-js reports "no answer" as AuthRetryableFetchError with status 0, or rethrows TypeError.
  if (!status || error.name === "AuthRetryableFetchError" || /failed to fetch|networkerror|load failed|network request failed/i.test(message))
    return { kind: "network", host: supabaseHost, at: new Date().toISOString().slice(0, 19) + "Z" };
  if (error.code === "invalid_credentials" || /invalid login credentials/i.test(message)) return { kind: "credentials" };
  if (error.code === "email_not_confirmed" || /confirm/i.test(message)) return { kind: "unconfirmed" };
  if (error.code === "user_already_exists" || /already registered/i.test(message)) return { kind: "already_registered" };
  return { kind: "other", message, status };
}

/**
 * After a network failure: does an ordinary, credential-free request to the same host get an
 * answer? Distinguishes "this host is unreachable from this browser" (DNS, TLS, a blocking proxy or
 * extension) from "the sign-in call alone failed". Sends the public anon key only.
 */
export async function probeSupabase(): Promise<"reachable" | "unreachable"> {
  try {
    const res = await fetch(new URL("/auth/v1/health", env.VITE_PUBLIC_SUPABASE_URL), {
      headers: { apikey: env.VITE_PUBLIC_SUPABASE_ANON_KEY },
      cache: "no-store",
    });
    return res.ok || res.status < 500 ? "reachable" : "unreachable";
  } catch {
    return "unreachable";
  }
}

/** The words for a network failure, with what the probe found and a UTC time to match the logs. */
export function networkMessage(f: { host: string; at: string }, probe: "reachable" | "unreachable"): string {
  return probe === "unreachable"
    ? `This browser cannot reach the sign-in service (${f.host}) at all — no answer at ${f.at} UTC. Nothing about your account was checked or changed. Something between this browser and ${f.host} is stopping the connection: the network, a VPN or proxy, DNS, or a blocking extension. Try another network or browser.`
    : `The sign-in request did not get an answer at ${f.at} UTC, although ${f.host} is reachable. Nothing about your account was checked or changed — try again.`;
}
