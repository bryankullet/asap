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
