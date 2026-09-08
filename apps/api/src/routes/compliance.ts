import {
  AGREEMENT_COLUMNS,
  AGREEMENT_RATE_COLUMNS,
  AGREEMENT_VERSION_COLUMNS,
  AgreementRateRow,
  AgreementRow,
  AgreementVersionRow,
  CLIENT_COLUMNS,
  CLIENT_DOCUMENT_COLUMNS,
  ClientDocumentRow,
  ClientRow,
  INSURER_COLUMNS,
  InsurerRow,
  K01View,
  SCREENING_PARKED_MESSAGE,
  WORK_ITEM_COLUMNS,
  WorkItemRow,
  agreementActionSchema,
  agreementResponseSchema,
  agreementsResponseSchema,
  clientFileActionResponseSchema,
  clientFileActionSchema,
  clientFileResponseSchema,
  clientFilesResponseSchema,
  createClientRequestSchema,
  effectiveFileStatus,
  type ClientFileResponse,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { parseBody } from "./_parse.js";

/** Client files (K01–K03) and insurer agreements (G01–G02). Reads under RLS; writes through 0026's functions. */
export function complianceRoutes(deps: { logger: Logger }) {
  const app = new Hono();

  /** Live work an incomplete file is blocking: placements sitting at approval. */
  async function blockingByClient(db: SupabaseClient, orgId: string) {
    const { data, error } = await db
      .from("work_items")
      .select(WORK_ITEM_COLUMNS)
      .eq("organization_id", orgId)
      .eq("kind", "placement")
      .neq("task_status", "done")
      .is("deleted_at", null);
    if (error) throw mapDatabaseError(error);
    const out = new Map<string, { id: string; title: string; step: string }[]>();
    for (const row of WorkItemRow.array().parse(data ?? [])) {
      const now = row.steps.find((s) => s.state === "now" || s.state === "blocked");
      if (
        !row.client_id ||
        !now ||
        !now.guards.some((g) => (typeof g === "string" ? g : g.id) === "client_file_cleared")
      )
        continue;
      out.set(row.client_id, [
        ...(out.get(row.client_id) ?? []),
        { id: row.id, title: row.title, step: now.label },
      ]);
    }
    return out;
  }

  app.get("/clients", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const view = K01View.catch("blocking").parse(c.req.query("view"));
    const [clientsR, docsR, blocking] = await Promise.all([
      db
        .from("clients")
        .select(CLIENT_COLUMNS)
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .order("name"),
      db
        .from("client_file_documents")
        .select("client_id, received_at")
        .eq("organization_id", org.id),
      blockingByClient(db, org.id),
    ]);
    if (clientsR.error) return sendError(c, mapDatabaseError(clientsR.error));
    if (docsR.error) return sendError(c, mapDatabaseError(docsR.error));
    const held = new Map<string, number>();
    for (const d of (docsR.data ?? []) as { client_id: string; received_at: string | null }[]) {
      if (d.received_at) held.set(d.client_id, (held.get(d.client_id) ?? 0) + 1);
    }
    const all = ClientRow.array()
      .parse(clientsR.data ?? [])
      .map((client) => {
        const effective_status = effectiveFileStatus(client);
        return {
          client,
          effective_status,
          blocking: blocking.get(client.id) ?? [],
          in_state_since: client.file_decided_at ?? client.updated_at,
          documents_held: held.get(client.id) ?? 0,
        };
      });
    const counts = {
      blocking: all.filter((i) => i.blocking.length > 0).length,
      incomplete: all.filter(
        (i) => i.effective_status === "incomplete" || i.effective_status === "in_review",
      ).length,
      refresh_due: all.filter((i) => i.effective_status === "refresh_due").length,
      cleared: all.filter((i) => i.effective_status === "cleared").length,
      not_started: all.filter((i) => i.effective_status === "not_started").length,
    };
    const items = all.filter((i) =>
      view === "blocking"
        ? i.blocking.length > 0
        : view === "incomplete"
          ? i.effective_status === "incomplete" || i.effective_status === "in_review"
          : i.effective_status === view,
    );
    return c.json(clientFilesResponseSchema.parse({ view, items, counts }));
  });

  app.post("/clients", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, createClientRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const { data, error } = await db.rpc("client_create", {
      p_organization_id: org.id,
      p_name: input.name,
      p_kind: input.kind,
      p_source: "manual",
    });
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json(await loadFile(db, org.id, (data as { id: string }).id), 201);
  });

  async function loadFile(
    db: SupabaseClient,
    orgId: string,
    clientId: string,
  ): Promise<ClientFileResponse> {
    const [clientR, docsR, blocking, missingR] = await Promise.all([
      db
        .from("clients")
        .select(CLIENT_COLUMNS)
        .eq("id", clientId)
        .is("deleted_at", null)
        .maybeSingle(),
      db
        .from("client_file_documents")
        .select(CLIENT_DOCUMENT_COLUMNS)
        .eq("client_id", clientId)
        .order("created_at"),
      blockingByClient(db, orgId),
      db.rpc("client_file_missing", { p_client_id: clientId }),
    ]);
    if (clientR.error) throw mapDatabaseError(clientR.error);
    if (!clientR.data) throw new HttpError(404, "not_found");
    if (docsR.error) throw mapDatabaseError(docsR.error);
    const client = ClientRow.parse(clientR.data);
    return clientFileResponseSchema.parse({
      client,
      effective_status: effectiveFileStatus(client),
      documents: ClientDocumentRow.array().parse(docsR.data ?? []),
      blocking: blocking.get(client.id) ?? [],
      screening: { available: false, reason: SCREENING_PARKED_MESSAGE },
      missing: missingR.error ? [] : ((missingR.data ?? []) as string[]),
    });
  }

  app.get("/clients/:id", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    return c.json(await loadFile(db, org.id, c.req.param("id")));
  });

  app.post("/clients/:id/file", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const input = await parseBody(c, clientFileActionSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const blocked = async (guard: string, reason: string, status = 409) => {
      await recordAudit(db, deps.logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: `client_file.${input.action}`,
        objectType: "client",
        objectId: id,
        result: "denied",
        failureReason: guard,
      });
      return c.json(
        clientFileActionResponseSchema.parse({
          outcome: "blocked",
          guard,
          reason,
          file: await loadFile(db, org.id, id),
        }),
        status as 409,
      );
    };
    let r: { error: { code?: string; message?: string; details?: string } | null };
    switch (input.action) {
      case "request_document":
        r = await db.rpc("client_file_request_document", {
          p_client_id: id,
          p_kind: input.kind,
          p_label: input.label,
        });
        break;
      case "record_document":
        r = await db.rpc("client_file_record_document", {
          p_client_id: id,
          p_kind: input.kind,
          p_label: input.label,
          p_reference: input.reference,
          p_received_at: input.receivedAt ?? null,
        });
        break;
      case "start_review":
        r = await db.rpc("client_file_start_review", { p_client_id: id });
        break;
      case "clear":
        r = await db.rpc("client_file_clear", {
          p_client_id: id,
          p_reason: input.reason,
          p_refresh_interval_days: input.refreshIntervalDays,
        });
        break;
      case "reopen":
        r = await db.rpc("client_file_reopen", { p_client_id: id, p_reason: input.reason });
        break;
      case "screen":
        // K03 is parked: no screening source is configured (spec Part 13 item 3).
        return blocked("screening_source_configured", SCREENING_PARKED_MESSAGE);
    }
    if (r.error) {
      const token = (r.error.message ?? "").split(/\s/)[0];
      if (token === "file_incomplete")
        return blocked(
          "evidence_present",
          `The file cannot be cleared yet. Still missing: ${r.error.details ?? "documents"}.`,
        );
      if (token === "nothing_to_review")
        return blocked(
          "evidence_present",
          "Nothing has been received yet, so there is nothing to review.",
        );
      return sendError(c, mapDatabaseError(r.error));
    }
    return c.json(
      clientFileActionResponseSchema.parse({
        outcome: "applied",
        file: await loadFile(db, org.id, id),
      }),
    );
  });

  // ---- agreements -----------------------------------------------------------------------------

  app.get("/agreements", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const [insR, agrR, verR, rateR, liveR] = await Promise.all([
      db
        .from("insurers")
        .select(INSURER_COLUMNS)
        .eq("organization_id", org.id)
        .is("deleted_at", null)
        .order("name"),
      db
        .from("agreements")
        .select(AGREEMENT_COLUMNS)
        .eq("organization_id", org.id)
        .is("deleted_at", null),
      db
        .from("agreement_versions")
        .select(AGREEMENT_VERSION_COLUMNS)
        .eq("organization_id", org.id)
        .order("version", { ascending: false }),
      db.from("agreement_rates").select(AGREEMENT_RATE_COLUMNS).eq("organization_id", org.id),
      db
        .from("work_items")
        .select("id, title, insurer_id, class_of_business")
        .eq("organization_id", org.id)
        .neq("task_status", "done")
        .is("deleted_at", null)
        .not("insurer_id", "is", null),
    ]);
    for (const r of [insR, agrR, verR, rateR, liveR])
      if (r.error) return sendError(c, mapDatabaseError(r.error));
    const agreements = AgreementRow.array().parse(agrR.data ?? []);
    const versions = AgreementVersionRow.array().parse(verR.data ?? []);
    const rates = AgreementRateRow.array().parse(rateR.data ?? []);
    const live = (liveR.data ?? []) as {
      id: string;
      title: string;
      insurer_id: string;
      class_of_business: string | null;
    }[];
    const today = new Date().toISOString().slice(0, 10);
    const rows = InsurerRow.array()
      .parse(insR.data ?? [])
      .map((insurer) => {
        const agreement = agreements.find((a) => a.insurer_id === insurer.id) ?? null;
        const current = agreement
          ? (versions.find(
              (v) =>
                v.agreement_id === agreement.id &&
                v.effective_from <= today &&
                (v.effective_to === null || v.effective_to >= today),
            ) ?? null)
          : null;
        const vrates = current ? rates.filter((r) => r.version_id === current.id) : [];
        const confirmed = vrates.filter((r) => r.confirmed_at).map((r) => r.class_of_business);
        const unconfirmed = vrates.filter((r) => !r.confirmed_at).map((r) => r.class_of_business);
        const undocumented_live = live
          .filter(
            (w) =>
              w.insurer_id === insurer.id &&
              w.class_of_business &&
              !confirmed.some((k) => k.toLowerCase() === w.class_of_business!.toLowerCase()),
          )
          .map((w) => ({ id: w.id, title: w.title, class_of_business: w.class_of_business! }));
        return {
          insurer,
          agreement,
          current_version: current,
          confirmed_classes: confirmed,
          unconfirmed_classes: unconfirmed,
          undocumented_live,
        };
      });
    return c.json(
      agreementsResponseSchema.parse({
        rows,
        undocumented_total: rows.reduce((n, r) => n + r.undocumented_live.length, 0),
      }),
    );
  });

  app.get("/agreements/:id", async (c) => {
    const { db } = c.get("auth");
    const id = c.req.param("id");
    const agrR = await db
      .from("agreements")
      .select(AGREEMENT_COLUMNS)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (agrR.error) return sendError(c, mapDatabaseError(agrR.error));
    if (!agrR.data) return sendError(c, new HttpError(404, "not_found"));
    const agreement = AgreementRow.parse(agrR.data);
    const [insR, verR, rateR] = await Promise.all([
      db.from("insurers").select(INSURER_COLUMNS).eq("id", agreement.insurer_id).maybeSingle(),
      db
        .from("agreement_versions")
        .select(AGREEMENT_VERSION_COLUMNS)
        .eq("agreement_id", id)
        .order("version", { ascending: false }),
      db
        .from("agreement_rates")
        .select(AGREEMENT_RATE_COLUMNS)
        .eq("organization_id", agreement.organization_id),
    ]);
    for (const r of [insR, verR, rateR])
      if (r.error) return sendError(c, mapDatabaseError(r.error));
    const rates = AgreementRateRow.array().parse(rateR.data ?? []);
    const versions = AgreementVersionRow.array()
      .parse(verR.data ?? [])
      .map((version) => ({ version, rates: rates.filter((r) => r.version_id === version.id) }));
    return c.json(
      agreementResponseSchema.parse({ insurer: InsurerRow.parse(insR.data), agreement, versions }),
    );
  });

  app.post("/agreements/actions", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, agreementActionSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    let r: { data: unknown; error: { code?: string; message?: string } | null };
    switch (input.action) {
      case "create_insurer":
        r = await db.rpc("insurer_create", { p_organization_id: org.id, p_name: input.name });
        break;
      case "create_agreement":
        r = await db.rpc("agreement_create", {
          p_insurer_id: input.insurerId,
          p_effective_from: input.effectiveFrom,
          p_document_reference: input.documentReference ?? null,
          p_payment_terms_days: input.paymentTermsDays ?? null,
        });
        break;
      case "new_version":
        r = await db.rpc("agreement_version_create", {
          p_agreement_id: input.agreementId,
          p_effective_from: input.effectiveFrom,
          p_document_reference: input.documentReference ?? null,
          p_payment_terms_days: input.paymentTermsDays ?? null,
          p_notes: input.notes ?? null,
        });
        break;
      case "propose_rate":
        r = await db.rpc("agreement_rate_propose", {
          p_version_id: input.versionId,
          p_class: input.classOfBusiness,
          p_rate_basis_points: input.rateBasisPoints,
          p_clause: input.clauseReference ?? null,
          p_proposed_by: input.proposedBy,
        });
        break;
      case "confirm_rate":
        r = await db.rpc("agreement_rate_confirm", { p_rate_id: input.rateId });
        break;
    }
    if (r.error) return sendError(c, mapDatabaseError(r.error));
    return c.json({ id: typeof r.data === "string" ? r.data : null });
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
