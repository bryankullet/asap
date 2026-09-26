import {
  recommendationRuleSchema,
  validityThresholdRuleSchema,
  type RecommendationRule,
  type ValidityThresholdRule,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A brokerage's own rules, read where a decision needs one (0052).
 *
 * The rule this file exists for: **with nothing configured, ASAP does not decide.** 4B-3 shipped
 * a 5% premium gap that named a recommended insurer for every brokerage in Kenya; it came from
 * nowhere and it decided something no constant is entitled to decide. So the absence of a rule is
 * an answer here, not a gap to fill with a default.
 *
 * The one place a default is allowed is the validity threshold, because "expiring soon" must mean
 * *something* to be shown at all — and it is a documented product default that travels with its
 * own basis to the screen, not a number hidden in React.
 */

export type ResolvedRule<T> = {
  value: T;
  /** Null when this is the product default rather than the brokerage's own. */
  configured: { source: string; verifiedAt: string } | null;
};

/** What "expiring soon" means where a brokerage has not said. Shown with this wording. */
export const DEFAULT_EXPIRING_SOON_DAYS = 14;
export const DEFAULT_EXPIRING_SOON_BASIS =
  "ASAP's default of 14 days, because no rule has been set for this brokerage.";

async function readRule(
  db: SupabaseClient,
  organizationId: string,
  key: string,
): Promise<{ value: unknown; source: string; verifiedAt: string } | null> {
  const { data } = await db
    .from("company_rules")
    .select("value, source, verified_at")
    .eq("organization_id", organizationId)
    .eq("key", key)
    .maybeSingle();
  if (!data) return null;
  const row = data as { value: unknown; source: string; verified_at: string };
  return { value: row.value, source: row.source, verifiedAt: row.verified_at };
}

/**
 * When this brokerage allows ASAP to name a recommended quote.
 *
 * No rule, or a rule that does not parse, means abstain. A malformed rule is not a licence to
 * fall back on a number of ASAP's own choosing.
 */
export async function recommendationRule(
  db: SupabaseClient,
  organizationId: string,
): Promise<ResolvedRule<RecommendationRule>> {
  const row = await readRule(db, organizationId, "quote.recommendation");
  if (row === null) return { value: { mode: "abstain" }, configured: null };
  const parsed = recommendationRuleSchema.safeParse(row.value);
  if (!parsed.success) return { value: { mode: "abstain" }, configured: null };
  return { value: parsed.data, configured: { source: row.source, verifiedAt: row.verifiedAt } };
}

export async function validityRule(
  db: SupabaseClient,
  organizationId: string,
): Promise<ResolvedRule<ValidityThresholdRule>> {
  const row = await readRule(db, organizationId, "quote.validity");
  if (row === null) {
    return { value: { expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS }, configured: null };
  }
  const parsed = validityThresholdRuleSchema.safeParse(row.value);
  if (!parsed.success) {
    return { value: { expiringSoonDays: DEFAULT_EXPIRING_SOON_DAYS }, configured: null };
  }
  return { value: parsed.data, configured: { source: row.source, verifiedAt: row.verifiedAt } };
}
