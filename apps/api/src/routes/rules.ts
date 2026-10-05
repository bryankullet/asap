import {
  AUTONOMY_CAP,
  AUTONOMY_LEVELS,
  autonomyRuleSchema,
  renewalWindowRuleSchema,
  chaseRuleSchema,
  companyRulesResponseSchema,
  recommendationRuleSchema,
  setCompanyRuleRequestSchema,
  validityThresholdRuleSchema,
  type CompanyRuleKey,
  type CompanyRulesResponse,
} from "@asap/schema";
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { mapDatabaseError, sendError } from "../errors.js";
import { DEFAULT_EXPIRING_SOON_BASIS, DEFAULT_EXPIRING_SOON_DAYS } from "../rules.js";
import { parseBody } from "./_parse.js";

/**
 * The brokerage's own rules.
 *
 * Every value here is one ASAP must not hold an opinion about: when it may name a recommended
 * quote, what "expiring soon" means. Each is stored with where it came from and when somebody
 * last checked it, because a rule whose provenance nobody remembers is a hard-coded number one
 * layer further down.
 *
 * The values are validated per key before they are stored. A rule that does not parse would be
 * ignored at the point of use — silently, and in favour of abstaining — so it is refused here
 * where a person can see why.
 */

/** What applies where a brokerage has set nothing. Said out loud rather than assumed. */
const DEFAULTS: { key: CompanyRuleKey; summary: string; basis: string }[] = [
  {
    key: "quote.recommendation",
    summary: "ASAP states the differences between quotes and does not name a recommended one.",
    basis:
      "There is no ASAP default for this. Which insurer a client should be advised to take is a judgement for the broker, so ASAP makes none until a brokerage says when it may.",
  },
  {
    key: "quote.validity",
    summary: `A quote is "expiring soon" within ${DEFAULT_EXPIRING_SOON_DAYS} days of its expiry.`,
    basis: DEFAULT_EXPIRING_SOON_BASIS,
  },
  {
    key: "renewal.window",
    summary: "ASAP starts renewal work 60 days before expiry, follows up 5 days after the insurer request is delivered, and escalates 14 days before expiry.",
    basis: "ASAP's default (D-130) until this brokerage sets its own.",
  },
  {
    key: "quote.chase",
    summary: "ASAP chases each insurer 3 days after the quotation request reaches them, expects answers within 10 days, and escalates 2 days before.",
    basis: "ASAP's default (D-141) until this brokerage sets its own. Measure your insurers' real response times and set it.",
  },
  {
    key: "workflow.autonomy",
    summary: "ASAP starts and prepares renewals and follows up on its own; every external message waits for a person's approval; it never names a recommended quote; new work goes to the client file's owner.",
    basis: "ASAP's default (D-131) until this brokerage sets its own. Binding cover, client instructions, money and claims decisions are never automatic, whatever is set.",
  },
];

function validate(key: CompanyRuleKey, value: unknown): string | null {
  if (key === "renewal.window") {
    return renewalWindowRuleSchema.safeParse(value).success
      ? null
      : "A renewal window is {leadDays 7–180, followUpDays 1–30, escalateDaysBeforeExpiry 1–60}, each a whole number of days.";
  }
  if (key === "quote.chase") {
    return chaseRuleSchema.safeParse(value).success
      ? null
      : "A chase rule is {followUpDays 1–30, deadlineDays 1–120, escalateDaysBefore 0–60}, each a whole number of days.";
  }
  if (key === "workflow.autonomy") {
    const r = autonomyRuleSchema.safeParse(value);
    if (!r.success) return "An autonomy rule gives each action a level on the ladder, an approver and an assignment rule.";
    // External messages always wait for a person; a quote recommendation is never acted on.
    for (const [action, level] of Object.entries(r.data.actions) as [keyof typeof AUTONOMY_CAP, (typeof AUTONOMY_LEVELS)[number]][]) {
      if (AUTONOMY_LEVELS.indexOf(level) > AUTONOMY_LEVELS.indexOf(AUTONOMY_CAP[action])) {
        return action === "external_messages"
          ? "Messages to clients and insurers always wait for a person's approval — they cannot be set above “Act after approval”."
          : `“${action.replaceAll("_", " ")}” cannot be set above “${AUTONOMY_CAP[action].replaceAll("_", " ")}”.`;
      }
    }
    return null;
  }
  const result =
    key === "quote.recommendation"
      ? recommendationRuleSchema.safeParse(value)
      : validityThresholdRuleSchema.safeParse(value);
  if (!result.success) {
    return key === "quote.recommendation"
      ? 'A recommendation rule is either {"mode":"abstain"} or {"mode":"cheapest_when_like_for_like","minimumGapPercent":N}.'
      : 'A validity rule is {"expiringSoonDays":N}, where N is a whole number of days.';
  }
  if (
    key === "quote.recommendation" &&
    result.data !== null &&
    typeof result.data === "object" &&
    "mode" in result.data &&
    result.data.mode === "cheapest_when_like_for_like" &&
    (result.data as { minimumGapPercent?: number }).minimumGapPercent === undefined
  ) {
    return "Say how wide the premium gap must be before ASAP names the cheaper quote.";
  }
  return null;
}

export function ruleRoutes(deps: { logger: Logger }) {
  const app = new Hono();

  app.get("/rules", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    return c.json(companyRulesResponseSchema.parse(await load(db, ctx, org.id)));
  });

  app.put("/rules", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const input = await parseBody(c, setCompanyRuleRequestSchema);

    /* A rule decides what ASAP will say about a client's cover. Not everyone may set one. */
    if (!hasPermission(ctx, "organization", "edit")) {
      return c.json({ outcome: "blocked", reason: "You may not change this brokerage's rules." }, 403);
    }

    const complaint = validate(input.key, input.value);
    if (complaint !== null) return c.json({ outcome: "blocked", reason: complaint }, 422);

    const now = new Date().toISOString();
    const existing = await db
      .from("company_rules")
      .select("id, value")
      .eq("organization_id", org.id)
      .eq("key", input.key)
      .maybeSingle();
    const previous = existing.data as { id: string; value: unknown } | null;

    const written = previous
      ? await db
          .from("company_rules")
          .update({
            value: input.value,
            source: input.source,
            verified_at: input.verifiedAt,
            note: input.note ?? null,
            set_by: user.id,
            updated_at: now,
          })
          .eq("organization_id", org.id)
          .eq("id", previous.id)
          .select("id")
          .maybeSingle()
      : await db
          .from("company_rules")
          .insert({
            organization_id: org.id,
            key: input.key,
            value: input.value,
            source: input.source,
            verified_at: input.verifiedAt,
            note: input.note ?? null,
            set_by: user.id,
          })
          .select("id")
          .maybeSingle();
    if (written.error) return sendError(c, mapDatabaseError(written.error));

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "organization.rule_set",
      objectType: "organization",
      objectId: org.id,
      result: "success",
      /* The rule and its provenance. No client information passes through here. */
      previousState: previous === null ? null : { key: input.key, value: previous.value },
      newState: { key: input.key, value: input.value, source: input.source, verifiedAt: input.verifiedAt },
    });

    return c.json({ outcome: "done", rules: await load(db, ctx, org.id) });
  });

  return app;
}

export async function load(
  db: SupabaseClient,
  ctx: Awaited<ReturnType<typeof resolveContext>>,
  organizationId: string,
): Promise<CompanyRulesResponse> {
  const { data, error } = await db
    .from("company_rules")
    .select("key, value, source, verified_at, note, set_by, updated_at")
    .eq("organization_id", organizationId)
    .order("key", { ascending: true });
  if (error) throw mapDatabaseError(error);
  const rows = (data ?? []) as {
    key: string;
    value: unknown;
    source: string;
    verified_at: string;
    note: string | null;
    set_by: string;
    updated_at: string;
  }[];

  const names = new Map<string, string>();
  if (rows.length > 0) {
    const { data: people } = await db
      .from("users")
      .select("id, full_name")
      .in("id", [...new Set(rows.map((r) => r.set_by))]);
    for (const p of (people ?? []) as { id: string; full_name: string | null }[]) {
      if (p.full_name) names.set(p.id, p.full_name);
    }
  }

  // The version in force: how many values the rule has held (company_rule_versions, 0052).
  const versions = new Map<string, number>();
  if (rows.length > 0) {
    const { data: vs } = await db.from("company_rule_versions").select("key").eq("organization_id", organizationId);
    for (const v of (vs ?? []) as { key: string }[]) versions.set(v.key, (versions.get(v.key) ?? 0) + 1);
  }
  const known = new Set(DEFAULTS.map((d) => d.key as string));
  return {
    rules: rows
      .filter((r) => known.has(r.key))
      .map((r) => ({
        key: r.key as CompanyRuleKey,
        value: r.value,
        source: r.source,
        verifiedAt: r.verified_at,
        note: r.note,
        setByName: names.get(r.set_by) ?? null,
        updatedAt: r.updated_at,
        version: versions.get(r.key) ?? null,
      })),
    /* Only the ones nobody has set. A default shown beside the rule replacing it is noise. */
    defaults: DEFAULTS.filter((d) => !rows.some((r) => r.key === d.key)),
    permissions: { canEdit: hasPermission(ctx, "organization", "edit") },
  };
}
