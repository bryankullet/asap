import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Three clients, three trust levels.
 *  - anon:    no session. Used only for the invitation preview (the token is the credential).
 *  - forUser: the caller's access token. RLS applies. Every tenant read and write in the API.
 *  - service: bypasses RLS. Confined to server-side admin paths (storage signed URLs later).
 *             Never used to read tenant data on a user's behalf.
 * Injected into createApp so tests can substitute fakes.
 */
export type SupabaseFactory = {
  anon(): SupabaseClient;
  forUser(accessToken: string): SupabaseClient;
  service(): SupabaseClient;
};

export function createSupabaseFactory(config: {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
}): SupabaseFactory {
  const base = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  };
  return {
    anon: () => createClient(config.url, config.anonKey, base),
    forUser: (accessToken) =>
      createClient(config.url, config.anonKey, {
        ...base,
        global: { headers: { Authorization: `Bearer ${accessToken}` } },
      }),
    service: () => createClient(config.url, config.serviceRoleKey, base),
  };
}
