import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/**
 * The browser's Supabase client: the anon key and the person's session, nothing else (§45 rule 4).
 * Business reads and writes go through the API, which resolves the brokerage, role and permissions
 * from the session on every request — the browser never asserts any of them.
 */
const direct = new URL(env.VITE_PUBLIC_SUPABASE_URL);
const base = env.VITE_PUBLIC_SUPABASE_PROXY_PATH && typeof window !== "undefined" ? window.location.origin + env.VITE_PUBLIC_SUPABASE_PROXY_PATH : direct.origin;

export const supabase = createClient(base, env.VITE_PUBLIC_SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    flowType: "pkce",
    // The same key as the current app, so a person signed in there is signed in here.
    storageKey: `sb-${direct.hostname.split(".")[0]}-auth-token`,
  },
});

export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
