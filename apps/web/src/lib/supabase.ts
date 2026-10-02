import { createClient } from "@supabase/supabase-js";
import { env } from "../env.js";

/**
 * Browser client. Holds the anon key only (§45 rule 4) and the user's session.
 * Business reads and writes go through the API, which re-resolves organization and role from the
 * session on every request; the browser never sends an organization id as a claim of authority.
 */
export const supabase = createClient(
  env.VITE_PUBLIC_SUPABASE_URL,
  env.VITE_PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: "pkce",
    },
  },
);

/**
 * The Supabase host this bundle was built against — hostname only, never the key. Shown in
 * network-failure messages so "Failed to fetch" names where the browser was trying to reach.
 */
export const supabaseHost: string = new URL(env.VITE_PUBLIC_SUPABASE_URL).hostname;

// Startup diagnostic: `document.documentElement.dataset.supabaseHost` in the console shows which
// project the deployed bundle targets, without a log line on every page load.
if (typeof document !== "undefined") document.documentElement.dataset["supabaseHost"] = supabaseHost;
