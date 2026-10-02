import { createClient } from "@supabase/supabase-js";
import { env } from "../env.js";

/**
 * Browser client. Holds the anon key only (§45 rule 4) and the user's session.
 * Business reads and writes go through the API, which re-resolves organization and role from the
 * session on every request; the browser never sends an organization id as a claim of authority.
 */
const directUrl = new URL(env.VITE_PUBLIC_SUPABASE_URL);

/**
 * Where the browser actually sends Supabase requests: the project itself, or the app's own origin
 * when the static site proxies it (VITE_PUBLIC_SUPABASE_PROXY_PATH).
 */
export const supabaseBaseUrl: string =
  env.VITE_PUBLIC_SUPABASE_PROXY_PATH && typeof window !== "undefined"
    ? window.location.origin + env.VITE_PUBLIC_SUPABASE_PROXY_PATH
    : directUrl.origin;

/** A URL the API minted on the Supabase host (signed download/upload), sent the same way. */
export function throughSupabaseBase(url: string): string {
  return url.startsWith(directUrl.origin + "/") ? supabaseBaseUrl + url.slice(directUrl.origin.length) : url;
}

export const supabase = createClient(
  supabaseBaseUrl,
  env.VITE_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
      // Keyed to the project, not the request host, so switching the proxy on keeps people signed in.
      storageKey: `sb-${directUrl.hostname.split(".")[0]}-auth-token`,
    },
  },
);

/**
 * The Supabase host this bundle was built against — hostname only, never the key. Shown in
 * network-failure messages so "Failed to fetch" names where the browser was trying to reach.
 */
export const supabaseHost: string = new URL(supabaseBaseUrl).host;

// Startup diagnostic: `document.documentElement.dataset.supabaseHost` in the console shows which
// project the deployed bundle targets, without a log line on every page load.
if (typeof document !== "undefined") document.documentElement.dataset["supabaseHost"] = supabaseHost;
