import {
  comparisonActionResponseSchema,
  comparisonActionSchema,
  comparisonResponseSchema,
  type Comparison,
  type ComparisonCell,
  type ComparisonChange,
  type ComparisonColumn,
  type ComparisonReadiness,
  type ComparisonChangedValue,
  type ComparisonRecommendation,
  type ComparisonResponse,
  type ComparisonRow,
  type ComparisonValidity,
  type EvidenceRef,
  type RecommendationRule,
  type OpportunityInsurer,
  type OpportunityResponse,
  type QuoteTerm,
} from "@asap/schema";
import { createHash } from "node:crypto";
import { pgMoney } from "../numeric.js";
import { Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { mapDatabaseError, sendError } from "../errors.js";
import { loadOpportunity } from "./opportunities.js";
import {
  DEFAULT_EXPIRING_SOON_BASIS,
  recommendationRule,
  validityRule,
  type ResolvedRule,
} from "../rules.js";
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

export function comparisonRoutes(deps: { logger: Logger }) {
  const app = new Hono();

  app.get("/opportunities/:id/comparison", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    /* `?version=` opens what the client was shown then, exactly as it was made. */
    const asked = Number.parseInt(c.req.query("version") ?? "", 10);
    return c.json(
      comparisonResponseSchema.parse(
        await load(db, ctx, org.id, c.req.param("id"), Number.isFinite(asked) ? asked : null),
      ),
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
        /*
         * The revision, not the row. This is what makes the comparison reproducible: the id
         * recorded here names one immutable reading, and nothing that happens to the answer
         * afterwards can change what this comparison shows.
         */
        const responseRevisionId = await latestRevision(
          db, org.id, "insurer_response_revisions", "insurer_response_id", response.id);
        if (responseRevisionId === null) {
          return blocked(
            `${insurer.insurerName}'s answer has no recorded revision, so a comparison including it could not be reproduced later. Record the answer again.`,
          );
        }

        const input_ = await db
          .from("quote_comparison_inputs")
          .insert({
            organization_id: org.id,
            comparison_id: comparisonId,
            insurer_response_id: response.id,
            insurer_id: insurer.insurerId,
            response_sha256: responseDigest(response),
            response_revision_id: responseRevisionId,
          })
          .select("id")
          .maybeSingle();
        if (input_.error || !input_.data) continue;
        const inputId = (input_.data as { id: string }).id;

        for (const term of response.terms) {
          const termRevisionId = await latestRevision(
            db, org.id, "quote_term_revisions", "quote_term_id", term.id);
          if (termRevisionId === null) continue;
          await db.from("quote_comparison_terms").insert({
            organization_id: org.id,
            comparison_input_id: inputId,
            quote_term_id: term.id,
            term_type: term.termType,
            label: term.label,
            term_sha256: termDigest(term),
            term_revision_id: termRevisionId,
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
    /* Stale, or holding an expired quotation. Either way it is not a page to put to a client. */
    if (!live.presentable.can) {
      return blocked(live.presentable.reason ?? "This comparison is out of date. Generate it again.");
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

/** Exported so placement can refuse an instruction against a comparison nobody could present. */
export async function loadComparisonView(
  db: SupabaseClient,
  ctx: Ctx,
  organizationId: string,
  id: string,
  version: number | null = null,
): Promise<ComparisonResponse> {
  return load(db, ctx, organizationId, id, version);
}

async function load(
  db: SupabaseClient,
  ctx: Ctx,
  organizationId: string,
  id: string,
  version: number | null = null,
): Promise<ComparisonResponse> {
  const opp = await loadOpportunity(db, ctx, organizationId, id);

  const comparisonsQ = await db
    .from("quote_comparisons")
    .select("id, version, generated_by, generated_at, presented_at, presented_by, superseded_at, superseded_reason")
    .eq("organization_id", organizationId)
    .eq("opportunity_id", id)
    .order("generated_at", { ascending: false });
  if (comparisonsQ.error) throw mapDatabaseError(comparisonsQ.error);
  const rows = (comparisonsQ.data ?? []) as ComparisonRowRaw[];

  const current = rows.find((r) => r.superseded_at === null) ?? null;
  /*
   * An earlier version is opened as it was, not as the current one. Asking for a version that
   * does not exist falls back to the current one rather than inventing an empty page.
   */
  const asked = version === null ? null : (rows.find((r) => r.version === version) ?? null);
  const showing = asked ?? current;

  const names = await peopleNames(db, rows);
  const [recommendation, validity] = await Promise.all([
    recommendationRule(db, organizationId),
    validityRule(db, organizationId),
  ]);

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
    comparison:
      showing === null
        ? null
        : await assemble(db, organizationId, showing, opp, names, recommendation, validity),
    viewingHistory: showing !== null && showing.id !== current?.id,
    history: rows
      .filter((r) => r.id !== showing?.id)
      .map((r) => ({
        id: r.id,
        version: r.version ?? 1,
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
  version: number | null;
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

/**
 * The comparison as it was made.
 *
 * Everything on screen comes from the revisions the comparison named (0051), never from the rows
 * as they stand today. That is the whole correction: a comparison joined to live rows shows this
 * month's excess under last month's name and claims the client saw it.
 */
async function assemble(
  db: SupabaseClient,
  organizationId: string,
  row: ComparisonRowRaw,
  opp: OpportunityResponse,
  names: Map<string, string>,
  rule: Awaited<ReturnType<typeof recommendationRule>>,
  validity: Awaited<ReturnType<typeof validityRule>>,
): Promise<Comparison> {
  const inputsQ = await db
    .from("quote_comparison_inputs")
    .select("id, insurer_response_id, insurer_id, response_sha256, response_revision_id")
    .eq("organization_id", organizationId)
    .eq("comparison_id", row.id);
  if (inputsQ.error) throw mapDatabaseError(inputsQ.error);
  const inputs = (inputsQ.data ?? []) as {
    id: string;
    insurer_response_id: string;
    insurer_id: string;
    response_sha256: string;
    response_revision_id: string | null;
  }[];

  const termsQ = await db
    .from("quote_comparison_terms")
    .select("id, comparison_input_id, quote_term_id, term_type, label, term_sha256, term_revision_id")
    .eq("organization_id", organizationId)
    .in("comparison_input_id", inputs.length === 0 ? [NO_SUCH_ID] : inputs.map((i) => i.id));
  if (termsQ.error) throw mapDatabaseError(termsQ.error);
  const comparedTerms = (termsQ.data ?? []) as {
    id: string;
    comparison_input_id: string;
    quote_term_id: string | null;
    term_revision_id: string | null;
  }[];

  const [responseRevisions, termRevisions] = await Promise.all([
    revisionsById(db, organizationId, "insurer_response_revisions",
      inputs.map((i) => i.response_revision_id)),
    revisionsById(db, organizationId, "quote_term_revisions",
      comparedTerms.map((t) => t.term_revision_id)),
  ]);

  const insurerNames = new Map(opp.insurers.map((i) => [i.insurerId, i.insurerName] as const));

  const columns: ComparisonColumn[] = [];
  for (const input of inputs) {
    const revision = input.response_revision_id === null
      ? null
      : (responseRevisions.get(input.response_revision_id) ?? null);
    if (revision === null) continue;  // Pre-0051, and said to be unrecoverable on the row itself.
    columns.push({
      insurerId: input.insurer_id,
      insurerName: insurerNames.get(input.insurer_id) ?? "An insurer no longer approached",
      responseId: input.insurer_response_id,
      receivedAt: (revision["received_at"] as string | null) ?? null,
      premiumAmount: pgMoney(revision["premium_amount"]),
      premiumCurrency: (revision["premium_currency"] as string | null) ?? null,
      validUntil: (revision["valid_until"] as string | null) ?? null,
      validity: validityOf((revision["valid_until"] as string | null) ?? null, validity),
      source: sourceOf(revision, opp, input.insurer_response_id),
    });
  }
  columns.sort((a, b) => a.insurerName.localeCompare(b.insurerName));

  const rows = buildRows(columns, inputs, comparedTerms, termRevisions);
  const changes = await changesSince(db, row.id);
  const recommendation = recommend(columns, rows, rule);

  const expired = columns.filter((c) => c.validity.state === "expired");
  const stale = row.superseded_at !== null;

  return {
    id: row.id,
    version: row.version ?? 1,
    generatedAt: row.generated_at,
    generatedByName: names.get(row.generated_by) ?? null,
    presentedAt: row.presented_at,
    presentedByName: row.presented_by === null ? null : (names.get(row.presented_by) ?? null),
    stale,
    staleReason: row.superseded_reason,
    changes,
    changedValues: changedValues(columns, inputs, comparedTerms, termRevisions, opp, insurerNames),
    columns,
    rows,
    recommendation,
    presentable: {
      can: !stale && expired.length === 0,
      reason: stale
        ? (row.superseded_reason ?? "A quote it included has changed since this was made.")
        : expired.length > 0
          ? `${expired.map((c) => c.insurerName).join(" and ")} ${expired.length === 1 ? "has" : "have"} let these terms expire. An expired quotation is not an offer.`
          : null,
    },
  };
}

/** The newest revision of one row, which is what a comparison made now compares. */
async function latestRevision(
  db: SupabaseClient,
  organizationId: string,
  table: string,
  column: string,
  rowId: string,
): Promise<string | null> {
  const { data } = await db
    .from(table)
    .select("id, revision")
    .eq("organization_id", organizationId)
    .eq(column, rowId)
    .order("revision", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** A uuid nothing has. Used where an `in` clause would otherwise be handed an empty list. */
const NO_SUCH_ID = "00000000-0000-4000-8000-000000000000";

async function revisionsById(
  db: SupabaseClient,
  organizationId: string,
  table: string,
  ids: (string | null)[],
): Promise<Map<string, Record<string, unknown>>> {
  const wanted = [...new Set(ids.filter((v): v is string => v !== null))];
  const out = new Map<string, Record<string, unknown>>();
  if (wanted.length === 0) return out;
  const { data, error } = await db
    .from(table)
    .select("*")
    .eq("organization_id", organizationId)
    .in("id", wanted);
  if (error) throw mapDatabaseError(error);
  for (const r of (data ?? []) as Record<string, unknown>[]) out.set(r["id"] as string, r);
  return out;
}

/**
 * Where the compared figures came from, as of the comparison.
 *
 * The revision holds the document and the note, so a citation on an old comparison opens the
 * evidence that was used then rather than whatever the answer points at today.
 */
function sourceOf(
  revision: Record<string, unknown>,
  opp: OpportunityResponse,
  responseId: string,
): EvidenceRef | null {
  const documentId = (revision["source_document_id"] as string | null) ?? null;
  if (documentId !== null) {
    const document = opp.documents.find((d) => d.id === documentId);
    return {
      kind: "document",
      id: documentId,
      label: document?.filename ?? "The quotation document",
      path: `/documents/${documentId}`,
    };
  }
  const note = (revision["source_note"] as string | null) ?? null;
  if (note !== null && note.trim() !== "") {
    return { kind: "note", id: null, label: note, path: null };
  }
  /* Fall back to whatever the answer itself records, which is all there is. */
  return opp.insurers.find((i) => i.response?.id === responseId)?.response?.source ?? null;
}

/**
 * How long each quote holds, in four states and in words.
 *
 * "Expiring soon" is a judgement, so the threshold and its basis travel to the screen with it.
 * A brokerage sets the number; where none has, the product default says that is what it is.
 */
function validityOf(
  validUntil: string | null,
  rule: ResolvedRule<{ expiringSoonDays: number }>,
): ComparisonValidity {
  const days = rule.value.expiringSoonDays;
  const basis = rule.configured === null
    ? DEFAULT_EXPIRING_SOON_BASIS
    : `This brokerage's rule: ${rule.configured.source} (checked ${rule.configured.verifiedAt}).`;

  if (validUntil === null) {
    return {
      state: "not_stated",
      validUntil: null,
      note: "The insurer did not say how long these terms hold.",
      thresholdDays: days,
      thresholdSource: basis,
    };
  }
  const remaining = Math.floor((Date.parse(`${validUntil}T00:00:00Z`) - Date.now()) / 86_400_000);
  if (remaining < 0) {
    return {
      state: "expired",
      validUntil,
      note: "These terms have expired. Ask the insurer to confirm them again.",
      thresholdDays: days,
      thresholdSource: basis,
    };
  }
  if (remaining <= days) {
    return {
      state: "expiring_soon",
      validUntil,
      note: `These terms hold for ${remaining} more day${remaining === 1 ? "" : "s"}.`,
      thresholdDays: days,
      thresholdSource: basis,
    };
  }
  return {
    state: "valid",
    validUntil,
    note: `These terms hold until ${validUntil}.`,
    thresholdDays: days,
    thresholdSource: basis,
  };
}

/**
 * What has moved since, as old value → new value.
 *
 * The digest says *that* something changed; this says what. Both are wanted: a broker asked to
 * regenerate deserves to know whether the excess went up or the premium came down.
 */
function changedValues(
  columns: ComparisonColumn[],
  inputs: { id: string; insurer_id: string; insurer_response_id: string; response_revision_id: string | null }[],
  comparedTerms: { comparison_input_id: string; quote_term_id: string | null; term_revision_id: string | null }[],
  termRevisions: Map<string, Record<string, unknown>>,
  opp: OpportunityResponse,
  insurerNames: Map<string, string>,
): ComparisonChangedValue[] {
  const out: ComparisonChangedValue[] = [];

  for (const column of columns) {
    const live = opp.insurers.find((i) => i.response?.id === column.responseId)?.response ?? null;
    if (live === null) continue;
    if ((live.premiumAmount ?? null) !== (column.premiumAmount ?? null)) {
      out.push({
        insurerId: column.insurerId,
        insurerName: column.insurerName,
        termType: null,
        label: "Premium",
        was: money(column.premiumAmount, column.premiumCurrency),
        now: money(live.premiumAmount, live.premiumCurrency),
      });
    }
    if ((live.validUntil ?? null) !== (column.validUntil ?? null)) {
      out.push({
        insurerId: column.insurerId,
        insurerName: column.insurerName,
        termType: null,
        label: "Valid until",
        was: column.validUntil,
        now: live.validUntil,
      });
    }
  }

  for (const input of inputs) {
    const live = opp.insurers.find((i) => i.response?.id === input.insurer_response_id)?.response ?? null;
    const name = insurerNames.get(input.insurer_id) ?? "An insurer";
    const mine = comparedTerms.filter((t) => t.comparison_input_id === input.id);

    for (const compared of mine) {
      const revision = compared.term_revision_id === null
        ? null
        : (termRevisions.get(compared.term_revision_id) ?? null);
      if (revision === null) continue;
      const was = valueOf(revision);
      const term = live?.terms.find((t) => t.id === compared.quote_term_id) ?? null;
      const now = term === null ? null : (term.correctedValue ?? term.extractedValue);
      if (was !== now) {
        out.push({
          insurerId: input.insurer_id,
          insurerName: name,
          termType: revision["term_type"] as ComparisonChangedValue["termType"],
          label: revision["label"] as string,
          was,
          now,
        });
      }
    }

    /* And anything the insurer has stated since, which the comparison never saw. */
    for (const term of live?.terms ?? []) {
      const seen = mine.some((t) => t.quote_term_id === term.id);
      if (seen) continue;
      out.push({
        insurerId: input.insurer_id,
        insurerName: name,
        termType: term.termType,
        label: term.label,
        was: null,
        now: term.correctedValue ?? term.extractedValue,
      });
    }
  }

  return out;
}

function valueOf(revision: Record<string, unknown>): string | null {
  return ((revision["corrected_value"] as string | null) ?? (revision["extracted_value"] as string | null)) ?? null;
}

function money(amount: string | null, currency: string | null): string | null {
  if (amount === null || currency === null) return null;
  return `${currency} ${Number(amount).toLocaleString("en-KE")}`;
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

/**
 * One row per term any insurer stated, read from the revisions the comparison named.
 *
 * A blank cell is the thing this is built to avoid: an insurer that said nothing about theft
 * excess has not offered a nil excess, and a table that leaves the cell empty says it has.
 */
function buildRows(
  columns: ComparisonColumn[],
  inputs: { id: string; insurer_id: string; response_revision_id: string | null }[],
  comparedTerms: { comparison_input_id: string; term_revision_id: string | null }[],
  termRevisions: Map<string, Record<string, unknown>>,
): ComparisonRow[] {
  const byInsurer = new Map(inputs.map((i) => [i.id, i.insurer_id] as const));

  type Stated = { insurerId: string; revision: Record<string, unknown> };
  const stated: Stated[] = [];
  for (const compared of comparedTerms) {
    const revision = compared.term_revision_id === null
      ? null
      : (termRevisions.get(compared.term_revision_id) ?? null);
    const insurerId = byInsurer.get(compared.comparison_input_id);
    if (revision === null || insurerId === undefined) continue;
    stated.push({ insurerId, revision });
  }

  const keys = new Map<string, { termType: QuoteTerm["termType"]; label: string }>();
  for (const { revision } of stated) {
    const termType = revision["term_type"] as QuoteTerm["termType"];
    const label = revision["label"] as string;
    keys.set(`${termType}|${label}`, { termType, label });
  }

  const order: QuoteTerm["termType"][] = [
    "limit", "excess", "condition", "exclusion", "benefit", "subjectivity", "levy", "tax", "other",
  ];

  return [...keys.values()]
    .sort((a, b) =>
      order.indexOf(a.termType) - order.indexOf(b.termType) || a.label.localeCompare(b.label),
    )
    .map(({ termType, label }) => {
      const cells: ComparisonCell[] = columns.map((column) => {
        const found = stated.find(
          (v) =>
            v.insurerId === column.insurerId &&
            v.revision["term_type"] === termType &&
            v.revision["label"] === label,
        );
        if (found === undefined) {
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
        const r = found.revision;
        const documentId = (r["evidence_document_id"] as string | null) ?? null;
        return {
          insurerId: column.insurerId,
          value: valueOf(r),
          amount: pgMoney(r["amount"]),
          currency: (r["currency"] as string | null) ?? null,
          missing: false,
          unclear: Boolean(r["unclear"]),
          corrected: (r["corrected_value"] as string | null) !== null,
          /* The evidence as it stood: an old comparison's citation opens the page it opened then. */
          evidence: documentId === null
            ? null
            : {
                kind: "document",
                id: documentId,
                label: r["evidence_page"] === null
                  ? "The quotation document"
                  : `The quotation document, page ${String(r["evidence_page"])}`,
                path: `/documents/${documentId}`,
              },
        };
      });
      return { termType, label, cells, incomplete: cells.some((cell) => cell.missing) };
    });
}

/**
 * What the comparison says, and whether this brokerage lets ASAP go further.
 *
 * The facts are always stated: which is cheaper and by how much, what one insurer stated and
 * another did not, what cannot be compared, what is about to expire. Naming a *recommended*
 * quote is a separate thing, and it happens only under a rule the brokerage configured. There is
 * no fallback: with no rule, ASAP says what it can see and leaves the judgement where it belongs.
 */
function recommend(
  columns: ComparisonColumn[],
  rows: ComparisonRow[],
  rule: ResolvedRule<RecommendationRule>,
): ComparisonRecommendation {
  const caveats: string[] = [];
  const facts: string[] = [];

  const priced = columns.filter((c) => c.premiumAmount !== null && c.premiumCurrency !== null);
  const currencies = new Set(priced.map((c) => c.premiumCurrency));
  const sorted = [...priced].sort((a, b) => Number(a.premiumAmount) - Number(b.premiumAmount));

  if (priced.length >= 2 && currencies.size === 1) {
    const cheapest = sorted[0]!;
    const next = sorted[1]!;
    const gap = Number(next.premiumAmount) - Number(cheapest.premiumAmount);
    const percent = (gap / Number(next.premiumAmount)) * 100;
    facts.push(
      `${cheapest.insurerName} is ${money(String(gap), cheapest.premiumCurrency)} cheaper than ${next.insurerName} — ${percent.toFixed(1)}%.`,
    );
  } else if (priced.length >= 2) {
    caveats.push(`These premiums are in ${[...currencies].join(" and ")}, so they do not compare directly.`);
  } else {
    caveats.push("Fewer than two of these quotes state a premium.");
  }

  const incomplete = rows.filter((r) => r.incomplete);
  for (const r of incomplete.slice(0, 3)) {
    const silent = r.cells
      .filter((cell) => cell.missing)
      .map((cell) => columns.find((c) => c.insurerId === cell.insurerId)?.insurerName ?? "one insurer");
    facts.push(`${silent.join(" and ")} did not state ${r.label}.`);
  }
  if (incomplete.length > 3) {
    facts.push(`${incomplete.length - 3} further terms are stated by some insurers and not others.`);
  }

  const unclear = rows.flatMap((r) =>
    r.cells
      .filter((cell) => cell.unclear)
      .map((cell) => `${columns.find((c) => c.insurerId === cell.insurerId)?.insurerName}: ${r.label}`),
  );
  for (const u of unclear.slice(0, 3)) caveats.push(`${u} was stated in terms that cannot be compared.`);

  for (const c of columns) {
    if (c.validity.state !== "valid") caveats.push(`${c.insurerName}: ${c.validity.note}`);
  }

  const configured = rule.configured === null
    ? null
    : {
        summary: rule.value.mode === "abstain"
          ? "This brokerage has asked ASAP not to name a recommended quote."
          : `Name the cheaper quote when the same cover is priced twice and the gap is at least ${rule.value.minimumGapPercent ?? 0}%.`,
        source: rule.configured.source,
        verifiedAt: rule.configured.verifiedAt,
      };

  /* No rule, or a rule that says abstain: the facts stand and the judgement is the broker's. */
  if (rule.configured === null || rule.value.mode === "abstain") {
    return {
      insurerId: null,
      insurerName: null,
      headline: rule.configured === null
        ? "ASAP is not recommending one of these."
        : "This brokerage has asked ASAP not to recommend one of these.",
      facts,
      reasoning: rule.configured === null
        ? [
            "No rule has been set for when ASAP may name a recommended quote, so it does not.",
            "The differences are set out above; which cover suits this client is a judgement for the broker.",
          ]
        : ["The differences are set out above; the recommendation is the broker's to make."],
      caveats,
      rule: configured,
    };
  }

  const minimum = rule.value.minimumGapPercent ?? 0;

  if (priced.length < 2 || currencies.size > 1) {
    return {
      insurerId: null,
      insurerName: null,
      headline: "Not enough here to apply this brokerage's rule.",
      facts,
      reasoning: ["The rule compares premiums, and fewer than two of these can be compared directly."],
      caveats,
      rule: configured,
    };
  }

  if (incomplete.length > 0 || unclear.length > 0) {
    return {
      insurerId: null,
      insurerName: null,
      headline: "These quotes are not yet like for like.",
      facts,
      reasoning: [
        "This brokerage's rule applies only where the same cover is priced twice.",
        "Get the missing terms stated, then compare again.",
      ],
      caveats,
      rule: configured,
    };
  }

  const cheapest = sorted[0]!;
  const next = sorted[1]!;
  const percent = ((Number(next.premiumAmount) - Number(cheapest.premiumAmount)) / Number(next.premiumAmount)) * 100;

  if (percent < minimum) {
    return {
      insurerId: null,
      insurerName: null,
      headline: "These quotes are close enough that price should not decide it.",
      facts,
      reasoning: [
        `This brokerage's rule asks for at least ${minimum}%, and the gap is ${percent.toFixed(1)}%.`,
        "Cover and excesses will matter more than the premium.",
      ],
      caveats,
      rule: configured,
    };
  }

  return {
    insurerId: cheapest.insurerId,
    insurerName: cheapest.insurerName,
    headline: `${cheapest.insurerName}, under this brokerage's own rule.`,
    facts,
    reasoning: [
      `Every term either insurer stated is stated by both, and the gap is ${percent.toFixed(1)}% — at or above the ${minimum}% this brokerage set.`,
      "It remains a recommendation. Whether the cover suits this client is the broker's judgement.",
    ],
    caveats,
    rule: configured,
  };
}
