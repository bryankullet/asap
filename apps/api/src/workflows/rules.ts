import type { SupabaseClient } from "@supabase/supabase-js";
import type { ZodType } from "zod";

/**
 * A brokerage's rule, or ASAP's stated default (D-141) — the pattern `renewalWindow` set: read at the
 * point of use, validated, and always carrying the basis a person can read ("this brokerage's rule:
 * <source>" or "ASAP's default, because…"). Never a constant in a step.
 */
export async function ruleOr<T>(db: SupabaseClient, organizationId: string, key: string, schema: ZodType<T>, fallback: T, defaultBasis: string): Promise<T & { basis: string; configured: boolean }> {
  const { data } = await db.from("company_rules").select("value, source, verified_at").eq("organization_id", organizationId).eq("key", key).maybeSingle();
  const row = data as { value: unknown; source: string; verified_at: string } | null;
  const parsed = row ? schema.safeParse(row.value) : null;
  if (row && parsed?.success) return { ...(parsed.data as T), basis: `This brokerage's rule: ${row.source} (checked ${row.verified_at}).`, configured: true };
  return { ...fallback, basis: defaultBasis, configured: false };
}

const DAY = 86_400_000;
/** When the next follow-up to one party is due: every `everyDays` after the request reached them. */
export const nextFollowUpAt = (deliveredAt: string, followUpsSoFar: number, everyDays: number) => new Date(new Date(deliveredAt).getTime() + (followUpsSoFar + 1) * everyDays * DAY);
