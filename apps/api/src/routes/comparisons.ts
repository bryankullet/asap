import {
  comparisonActionResponseSchema,
  comparisonActionSchema,
  comparisonResponseSchema,
  type Comparison,
  type ComparisonCell,
  type ComparisonChange,
  type ComparisonColumn,
  type ComparisonReadiness,
  type ComparisonRecommendation,
  type ComparisonResponse,
  type ComparisonRow,
  type OpportunityInsurer,
  type OpportunityResponse,
  type QuoteTerm,
} from "@asap/schema";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { mapDatabaseError, sendError } from "../errors.js";
import { loadOpportunity } from "./opportunities.js";
import { parseBody } from "./_parse.js";

/**
 * Lining the quotes up beside each other.
 *
 * Two things make this harder than a table. Quotes are rarely like-for-like — one insurer states
 * an excess the other is silent about — and they move: an insurer revises, a person corrects a
 * misread figure. So the comparison records the digest of every row it used (0050), and the
 * database supersedes it the moment any of them change. This file never marks a comparison stale
 * itself; it reads what the database has already noticed.
 *
 * Nothing here recommends the cheapest quote because it is cheapest. A recommendation is made
 * only where the quotes can actually be set against one another, and it says what it weighed and
 * what it could not.
 */

type Ctx = Awaited<ReturnType<typeof resolveContext>>;

/** Terms expiring inside this window are worth saying out loud on the column. */
const VALIDITY_WARNING_DAYS = 14;

/** Below this, two premiums are close enough that the cheaper one is not the point. */
const PREMIUM_MARGIN = 0.05;

export function comparisonRoutes(deps: { logger: Logger }) {
  const app = new Hono();

  app.get("/opportunities/:id/comparison", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    return c.json(
      comparisonResponseSchema.parse(await load(db, ctx, org.id, c.req.param("id"))),
    );
  });

  app.post("/opportunities/:id/comparison/actions", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const id = c.req.param("id");
    const input = await parseBody(c, comparisonActionSchema);

    const blocked = (reason: string) =>
      c.json(comparisonActionResponseSchema.parse({ outcome: "blocked", reason }));
    const done = async (outcome: "done" | "already" = "done") =>
      c.json(
        comparisonActionResponseSchema.parse({
          outcome,
          comparison: await load(db, ctx, org.id, id),
        }),
      );

    if (!hasPermission(ctx, "space", "create")) {
      return blocked("You may not change this quotation work.");
    }

    const view = await load(db, ctx, org.id, id);
    if (view.opportunity.closedAt !== null) {
      return blocked("This quotation work is closed. Nothing more is recorded against it.");
    }

    const now = new Date().toISOString();

    if (input.action === "generate_comparison") {
      if (!view.readiness.ready) {
        return blocked(view.readiness.blockers[0] ?? "There is nothing to compare yet.");
      }
      /* Already current, and nothing has moved: making a second is not a different photograph. */
      if (view.comparison !== null && !view.comparison.stale) return done("already");

      const opp = await loadOpportunity(db, ctx, org.id, id);
      const quoted = opp.insurers.filter((i) => i.removedAt === null && i.response?.outcome === "quoted");

      /* The old one is superseded by hand, because it is a person generating, not a change. */
      if (view.comparison !== null) {
        const stood = await db
          .from("quote_comparisons")
          .update({
            superseded_at: now,
            superseded_reason: "A newer comparison was generated.",
          })
          .eq("organization_id", org.id)
          .eq("id", view.comparison.id)
          .is("superseded_at", null)
          .select("id")
          .maybeSingle();
        if (stood.error) return sendError(c, mapDatabaseError(stood.error));
      }

      const made = await db
        .from("quote_comparisons")
        .insert({ organization_id: org.id, opportunity_id: id, generated_by: user.id, generated_at: now })
        .select("id")
        .maybeSingle();
      /* The one-live-per-opportunity index refuses a race; whoever lost reads what won. */
      if (made.error || !made.data) return done("already");
      const comparisonId = (made.data as { id: string }).id;

      for (const insurer of quoted) {
        const response = insurer.response!;
        const input_ = await db
          .from("quote_comparison_inputs")
          .insert({
            organization_id: org.id,
            comparison_id: comparisonId,
            insurer_response_id: response.id,
            insurer_id: insurer.insurerId,
            response_sha256: responseDigest(response),
          })
          .select("id")
          .maybeSingle();
        if (input_.error || !input_.data) continue;
        const inputId = (input_.data as { id: string }).id;

        for (const term of response.terms) {
          await db.from("quote_comparison_terms").insert({
            organization_id: org.id,
            comparison_input_id: inputId,
            quote_term_id: term.id,
            term_type: term.termType,
            label: term.label,
            term_sha256: termDigest(term),
          });
        }
      }

      await recordAudit(db, deps.logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: "opportunity.comparison_generated",
        objectType: "opportunity",
        objectId: id,
        result: "success",
        newState: { comparisonId, insurers: quoted.length },
      });
      return done();
    }

    /* present_comparison */
    const live = view.comparison;
    if (live === null || live.id !== input.comparisonId) {
      return blocked("That comparison is no longer the current one. Generate it again.");
    }
    if (live.presentedAt !== null) return done("already");
    if (live.stale) {
      return blocked(live.staleReason ?? "This comparison is out of date. Generate it again.");
    }

    const shown = await db
      .from("quote_comparisons")
      .update({ presented_at: now, presented_by: user.id })
      .eq("organization_id", org.id)
      .eq("id", live.id)
      .select("id")
      .maybeSingle();
    if (shown.error) return sendError(c, mapDatabaseError(shown.error));

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "opportunity.comparison_presented",
      objectType: "opportunity",
      objectId: id,
      result: "success",
      newState: { comparisonId: live.id, presentedAt: now },
    });
    return done();
  });

  return app;
}

/* ---- The digests, kept identical to 0050 ----------------------------------------------------
 *
 * These must agree with `app.insurer_response_digest` and `app.quote_term_digest`. A divergence
 * would mean a comparison is born stale, so the pgTAP suite and the API tests both check the
 * shape and the API test recomputes one of each against the database's own function.
 */

const SEPARATOR = "\u001e";

function sha256(parts: (string | null)[]): string {
  return createHash("sha256").update(parts.map((p) => p ?? "").join(SEPARATOR), "utf8").digest("hex");
}

export function responseDigest(response: {
  outcome: string;
  premiumAmount: string | null;
  premiumCurrency: string | null;
  validUntil: string | null;
}): string {
  return sha256([response.outcome, response.premiumAmount, response.premiumCurrency, response.validUntil]);
}

export function termDigest(term: QuoteTerm): string {
  return sha256([
    term.termType,
    term.label,
    term.extractedValue,
    term.correctedValue,
    term.amount,
    term.currency,
    String(term.unclear),
  ]);
}

/* ---- Reading it ------------------------------------------------------------------------------ */

async function load(
  db: SupabaseClient,
  ctx: Ctx,
  organizationId: string,
  id: string,
): Promise<ComparisonResponse> {
  const opp = await loadOpportunity(db, ctx, organizationId, id);

  const comparisonsQ = await db
    .from("quote_comparisons")
    .select("id, generated_by, generated_at, presented_at, presented_by, superseded_at, superseded_reason")
    .eq("organization_id", organizationId)
    .eq("opportunity_id", id)
    .order("generated_at", { ascending: false });
  if (comparisonsQ.error) throw mapDatabaseError(comparisonsQ.error);
  const rows = (comparisonsQ.data ?? []) as ComparisonRowRaw[];

  const live = rows.find((r) => r.superseded_at === null) ?? null;
  const names = await peopleNames(db, rows);

  return {
    opportunity: {
      id: opp.opportunity.id,
      title: opp.opportunity.title,
      classOfBusiness: opp.opportunity.classOfBusiness,
      coverStart: opp.opportunity.coverStart,
      coverEnd: opp.opportunity.coverEnd,
      closedAt: opp.opportunity.closedAt,
    },
    client: opp.client,
    readiness: readiness(opp),
    comparison: live === null ? null : await assemble(db, organizationId, live, opp, names),
    history: rows
      .filter((r) => r.id !== live?.id)
      .map((r) => ({
        id: r.id,
        generatedAt: r.generated_at,
        generatedByName: names.get(r.generated_by) ?? null,
        presentedAt: r.presented_at,
        supersededAt: r.superseded_at,
        supersededReason: r.superseded_reason,
      })),
    permissions: {
      canGenerate: hasPermission(ctx, "space", "create"),
      canPresent: hasPermission(ctx, "space", "create"),
    },
  };
}

type ComparisonRowRaw = {
  id: string;
  generated_by: string;
  generated_at: string;
  presented_at: string | null;
  presented_by: string | null;
  superseded_at: string | null;
  superseded_reason: string | null;
};

/* `users` is not tenant-scoped; membership is what decides visibility, and RLS enforces it. */
async function peopleNames(
  db: SupabaseClient,
  rows: ComparisonRowRaw[],
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.flatMap((r) => [r.generated_by, r.presented_by]).filter((v): v is string => v !== null))];
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await db.from("users").select("id, full_name").in("id", ids);
  for (const r of (data ?? []) as { id: string; full_name: string | null }[]) {
    if (r.full_name) out.set(r.id, r.full_name);
  }
  return out;
}

/**
 * Whether a comparison is worth making.
 *
 * Deliberately not a single boolean on the screen: the blockers are sentences, because "two
 * insurers have not answered" is something a broker acts on and "not ready" is not.
 */
function readiness(opp: OpportunityResponse): ComparisonReadiness {
  const live = opp.insurers.filter((i) => i.removedAt === null);
  const quoted = live.filter((i) => i.response?.outcome === "quoted");
  const declined = live.filter((i) => i.response?.outcome === "declined");
  const awaiting = live.filter((i) => i.response === null || i.response.outcome === "no_response");
  const missing = opp.requirements.filter((r) => r.required && r.suppliedAt === null).map((r) => r.label);

  const blockers: string[] = [];
  if (quoted.length === 0) {
    blockers.push("No insurer has quoted yet, so there is nothing to compare.");
  } else if (quoted.length === 1) {
    blockers.push(
      `Only ${quoted[0]!.insurerName} has quoted. One quote is a quote, not a comparison.`,
    );
  }
  for (const i of awaiting) {
    blockers.push(
      `With ${i.insurerName} since ${sinceOf(i)} — no answer yet.`,
    );
  }
  for (const label of missing) {
    blockers.push(`The client has not supplied ${label}, so any quote may be revised.`);
  }

  return {
    /* Outstanding insurers and missing papers are worth saying, but they do not forbid the
     * comparison: a broker often compares what is in while chasing the rest. Two quotes do. */
    ready: quoted.length >= 2,
    blockers,
    approached: live.length,
    quoted: quoted.length,
    declined: declined.length,
    awaiting: awaiting.map((i) => ({ insurerName: i.insurerName, since: sinceOf(i) })),
    missingInformation: missing,
  };
}

function sinceOf(i: OpportunityInsurer): string {
  return (i.request?.sentAt ?? i.request?.approvedAt ?? i.request?.preparedAt ?? i.addedAt).slice(0, 10);
}

async function assemble(
  db: SupabaseClient,
  organizationId: string,
  row: ComparisonRowRaw,
  opp: OpportunityResponse,
  names: Map<string, string>,
): Promise<Comparison> {
  const inputsQ = await db
    .from("quote_comparison_inputs")
    .select("id, insurer_response_id, insurer_id, response_sha256")
    .eq("organization_id", organizationId)
    .eq("comparison_id", row.id);
  if (inputsQ.error) throw mapDatabaseError(inputsQ.error);
  const inputs = (inputsQ.data ?? []) as {
    id: string;
    insurer_response_id: string;
    insurer_id: string;
    response_sha256: string;
  }[];

  const byResponseId = new Map(
    opp.insurers
      .filter((i) => i.response !== null)
      .map((i) => [i.response!.id, i] as const),
  );

  const columns: ComparisonColumn[] = [];
  for (const input of inputs) {
    const insurer = byResponseId.get(input.insurer_response_id);
    if (insurer === undefined) continue;
    const response = insurer.response!;
    columns.push({
      insurerId: insurer.insurerId,
      insurerName: insurer.insurerName,
      responseId: response.id,
      receivedAt: response.receivedAt,
      premiumAmount: response.premiumAmount,
      premiumCurrency: response.premiumCurrency,
      validUntil: response.validUntil,
      validityNote: validityNote(response.validUntil),
      source: response.source,
    });
  }
  columns.sort((a, b) => a.insurerName.localeCompare(b.insurerName));

  const changes = await changesSince(db, row.id);

  return {
    id: row.id,
    generatedAt: row.generated_at,
    generatedByName: names.get(row.generated_by) ?? null,
    presentedAt: row.presented_at,
    presentedByName: row.presented_by === null ? null : (names.get(row.presented_by) ?? null),
    stale: row.superseded_at !== null,
    staleReason: row.superseded_reason,
    changes,
    columns,
    rows: buildRows(columns, byResponseId),
    recommendation: recommend(columns, buildRows(columns, byResponseId)),
  };
}

async function changesSince(db: SupabaseClient, comparisonId: string): Promise<ComparisonChange[]> {
  const { data, error } = await db.rpc("quote_comparison_changes", { p_comparison_id: comparisonId });
  /* The function is the database's own answer. If it cannot be reached, say nothing rather than
   * claim nothing changed — the stale flag on the row is the load-bearing signal either way. */
  if (error) return [];
  return ((data ?? []) as {
    insurer_id: string;
    insurer_name: string;
    term_type: string | null;
    label: string | null;
    change: string;
  }[]).map((r) => ({
    insurerId: r.insurer_id,
    insurerName: r.insurer_name,
    termType: (r.term_type ?? null) as ComparisonChange["termType"],
    label: r.label,
    change: r.change,
  }));
}

function validityNote(validUntil: string | null): string | null {
  if (validUntil === null) return "The insurer did not state how long these terms hold.";
  const days = Math.floor((Date.parse(`${validUntil}T00:00:00Z`) - Date.now()) / 86_400_000);
  if (days < 0) return "These terms have expired. Ask the insurer to confirm them again.";
  if (days <= VALIDITY_WARNING_DAYS) return `These terms hold for ${days} more day${days === 1 ? "" : "s"}.`;
  return null;
}

/**
 * One row per term any insurer stated, so silence shows up as silence.
 *
 * A blank cell is the thing this is built to avoid: an insurer that said nothing about theft
 * excess has not offered a nil excess, and a table that leaves the cell empty says it has.
 */
function buildRows(
  columns: ComparisonColumn[],
  byResponseId: Map<string, OpportunityInsurer>,
): ComparisonRow[] {
  const keys = new Map<string, { termType: QuoteTerm["termType"]; label: string }>();
  for (const column of columns) {
    const terms = byResponseId.get(column.responseId)?.response?.terms ?? [];
    for (const t of terms) keys.set(`${t.termType}|${t.label}`, { termType: t.termType, label: t.label });
  }

  const order: QuoteTerm["termType"][] = [
    "limit",
    "excess",
    "condition",
    "exclusion",
    "subjectivity",
    "levy",
    "tax",
    "other",
  ];

  return [...keys.values()]
    .sort((a, b) =>
      order.indexOf(a.termType) - order.indexOf(b.termType) || a.label.localeCompare(b.label),
    )
    .map(({ termType, label }) => {
      const cells: ComparisonCell[] = columns.map((column) => {
        const term = (byResponseId.get(column.responseId)?.response?.terms ?? []).find(
          (t) => t.termType === termType && t.label === label,
        );
        if (term === undefined) {
          return {
            insurerId: column.insurerId,
            value: null,
            amount: null,
            currency: null,
            missing: true,
            unclear: false,
            corrected: false,
            evidence: null,
          };
        }
        return {
          insurerId: column.insurerId,
          value: term.correctedValue ?? term.extractedValue,
          amount: term.amount,
          currency: term.currency,
          missing: false,
          unclear: term.unclear,
          corrected: term.correctedValue !== null,
          evidence: term.evidence,
        };
      });
      return { termType, label, cells, incomplete: cells.some((cell) => cell.missing) };
    });
}

/**
 * What the comparison suggests.
 *
 * The cheapest quote is not the recommendation. It is a candidate, and it only becomes a
 * recommendation when the quotes can honestly be set against one another: same currency, no term
 * one insurer stated and another did not, nothing unclear, nothing expired. Otherwise this
 * abstains and says which of those it tripped on — abstention is a state, not a blank (§36).
 */
function recommend(columns: ComparisonColumn[], rows: ComparisonRow[]): ComparisonRecommendation {
  const caveats: string[] = [];
  const reasoning: string[] = [];

  const priced = columns.filter((c) => c.premiumAmount !== null && c.premiumCurrency !== null);
  if (priced.length < 2) {
    return {
      insurerId: null,
      insurerName: null,
      headline: "Not enough here to recommend one.",
      reasoning: [],
      caveats: ["Fewer than two of these quotes state a premium."],
    };
  }

  const currencies = new Set(priced.map((c) => c.premiumCurrency));
  if (currencies.size > 1) {
    caveats.push(`These premiums are in ${[...currencies].join(" and ")}, so they do not compare directly.`);
  }

  const incomplete = rows.filter((r) => r.incomplete);
  for (const r of incomplete.slice(0, 3)) {
    const silent = r.cells
      .filter((cell) => cell.missing)
      .map((cell) => columns.find((c) => c.insurerId === cell.insurerId)?.insurerName ?? "one insurer");
    caveats.push(`${silent.join(" and ")} did not state ${r.label}.`);
  }
  if (incomplete.length > 3) {
    caveats.push(`${incomplete.length - 3} further terms are stated by some insurers and not others.`);
  }

  const unclear = rows.flatMap((r) =>
    r.cells
      .filter((cell) => cell.unclear)
      .map((cell) => `${columns.find((c) => c.insurerId === cell.insurerId)?.insurerName}: ${r.label}`),
  );
  for (const u of unclear.slice(0, 3)) caveats.push(`${u} was stated in terms that cannot be compared.`);

  for (const c of columns) {
    if (c.validityNote !== null) caveats.push(`${c.insurerName}: ${c.validityNote}`);
  }

  const sorted = [...priced].sort((a, b) => Number(a.premiumAmount) - Number(b.premiumAmount));
  const cheapest = sorted[0]!;
  const next = sorted[1]!;
  const margin = (Number(next.premiumAmount) - Number(cheapest.premiumAmount)) / Number(next.premiumAmount);

  reasoning.push(
    `${cheapest.insurerName} quotes ${money(cheapest)}, against ${money(next)} from ${next.insurerName}.`,
  );

  /* Cheapest by a hair is not cheapest in any way a client cares about. */
  if (margin < PREMIUM_MARGIN) {
    return {
      insurerId: null,
      insurerName: null,
      headline: "These quotes are close enough that price should not decide it.",
      reasoning: [
        ...reasoning,
        `That is under ${Math.round(PREMIUM_MARGIN * 100)}% apart. Cover and excesses will matter more than the premium.`,
      ],
      caveats,
    };
  }

  if (currencies.size > 1 || incomplete.length > 0 || unclear.length > 0) {
    return {
      insurerId: null,
      insurerName: null,
      headline: "These quotes are not yet like for like.",
      reasoning: [
        ...reasoning,
        "Before recommending one, get the missing terms stated so the same cover is being priced.",
      ],
      caveats,
    };
  }

  reasoning.push("Every term either insurer stated is stated by both, so this is the same cover priced twice.");
  return {
    insurerId: cheapest.insurerId,
    insurerName: cheapest.insurerName,
    headline: `${cheapest.insurerName} on these terms.`,
    reasoning,
    caveats,
  };
}

function money(column: ComparisonColumn): string {
  return `${column.premiumCurrency} ${Number(column.premiumAmount).toLocaleString("en-KE")}`;
}
