import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeResponse } from "@asap/schema";
import { api } from "./api.js";
import { DEMO_MODE } from "../demo/mode.js";

export const ME_KEY = ["me"] as const;

/**
 * The server-resolved identity: memberships, active brokerage, permissions.
 *
 * Never requested in demo mode. The demonstration has no session to resolve one from, and asking
 * would mean a public page waiting on a 401 before it could render anything (D-065). Components
 * read the fixture person instead; `me.data` is simply undefined there.
 */
export function useMe(enabled = true) {
  return useQuery<MeResponse>({
    queryKey: ME_KEY,
    queryFn: api.me,
    enabled: enabled && !DEMO_MODE,
    retry: false,
  });
}

export function useInvalidateMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ME_KEY });
}

export function can(me: MeResponse | undefined, objectType: string, verb: string): boolean {
  return me?.permissions.includes(`${objectType}:${verb}`) ?? false;
}
