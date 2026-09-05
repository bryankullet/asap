import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeResponse } from "@asap/schema";
import { api } from "./api.js";

export const ME_KEY = ["me"] as const;

/** The server-resolved identity: memberships, active brokerage, permissions. */
export function useMe(enabled = true) {
  return useQuery<MeResponse>({ queryKey: ME_KEY, queryFn: api.me, enabled, retry: false });
}

export function useInvalidateMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ME_KEY });
}

export function can(me: MeResponse | undefined, objectType: string, verb: string): boolean {
  return me?.permissions.includes(`${objectType}:${verb}`) ?? false;
}
