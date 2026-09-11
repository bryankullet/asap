import {
  CLIENT_CONTACT_COLUMNS,
  IMPORT_BATCH_COLUMNS,
  IMPORT_ROW_LIMIT,
  type ImportBatch,
  type ImportColumn,
  type ImportRowPreview,
  type InterpretedRow,
  type PremiumBasis,
  contactsResponseSchema,
  createContactRequestSchema,
  contactResponseSchema,
  importCommitRequestSchema,
  importCommitResponseSchema,
  importPreviewRequestSchema,
  importPreviewResponseSchema,
  importsResponseSchema,
  interpretRow,
  matchClientName,
  parseCsv,
  suggestColumns,
  type ClientCandidate,
} from "@asap/schema";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { parseBody } from "./_parse.js";

/**
 * Bringing an existing book in, and the people at a client (D-070).
 *
 * The rule that shapes this file: **an import is not a second way in.** It creates clients through
 * `client_create` and policies through `policy_create`, exactly as `+ New` does, so the duplicate
 * check, the membership check, the API-key gate and the audit row are the same ones — there is no
 * quieter path that skips them because it is doing a hundred records instead of one.
 *
 * Two steps, deliberately. A preview stores what it decided per row; the commit writes exactly
 * that and never re-reads the file. If it re-read, the file could have been edited, a name could
 * resolve differently, or a client could have been created in between — and a person would have
 * approved something other than what happened.
 */
export function importRoutes(deps: { logger: Logger }) {
  const app = new Hono<{ Variables: { auth: { db: SupabaseClient; user: { id: string } } } }>();

  /** The people at a client. */
  app.get("/clients/:id/contacts", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const { data, error } = await db
      .from("client_contacts")
      .select(CLIENT_CONTACT_COLUMNS)
      .eq("organization_id", org.id)
      .eq("client_id", c.req.param("id"))
      .is("deleted_at", null)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json(
      contactsResponseSchema.parse({ contacts: ((data ?? []) as ContactRow[]).map(toContact) }),
    );
  });

  app.post("/contacts", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, createContactRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    // The client must resolve for this caller first: a contact is not a way to discover whether
    // an id belongs to somebody else's brokerage.
    const client = await db
      .from("clients")
      .select("id")
      .eq("organization_id", org.id)
      .eq("id", input.clientId)
      .is("deleted_at", null)
      .maybeSingle();
    if (client.error) return sendError(c, mapDatabaseError(client.error));
    if (!client.data) throw new HttpError(404, "not_found", "No client with that id");

    // Exactly one primary per client is a database rule (0039). Standing the previous one down
    // here means a person choosing a new primary does not have to clear the old one first.
    if (input.isPrimary) {
      const cleared = await db
        .from("client_contacts")
        .update({ is_primary: false, updated_at: new Date().toISOString() })
        .eq("organization_id", org.id)
        .eq("client_id", input.clientId)
        .eq("is_primary", true);
      if (cleared.error) return sendError(c, mapDatabaseError(cleared.error));
    }

    const { data, error } = await db
      .from("client_contacts")
      .insert({
        organization_id: org.id,
        client_id: input.clientId,
        full_name: input.fullName,
        role_label: input.roleLabel,
        email: input.email === "" ? null : input.email,
        phone: input.phone,
        is_primary: input.isPrimary,
        source: "manual",
        notes: input.notes,
        created_by: user.id,
      })
      .select(CLIENT_CONTACT_COLUMNS)
      .single();
    if (error) return sendError(c, mapDatabaseError(error));

    const contact = toContact(data as ContactRow);
    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "client_contact.created",
      objectType: "client_contact",
      objectId: contact.id,
      // The person's name and role are the record; the address is not copied into the audit row.
      newState: { client_id: input.clientId, full_name: contact.fullName, is_primary: contact.isPrimary },
      result: "success",
    });
    return c.json(contactResponseSchema.parse({ contact }), 201);
  });

  /** What has been imported into this brokerage, newest first. */
  app.get("/imports", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const { data, error } = await db
      .from("import_batches")
      .select(IMPORT_BATCH_COLUMNS)
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return sendError(c, mapDatabaseError(error));
    return c.json(
      importsResponseSchema.parse({ batches: ((data ?? []) as BatchRow[]).map(toBatch) }),
    );
  });

  /**
   * Read the file and say what it would do. Writes nothing to the book.
   *
   * Everything the commit will need is stored here, per row, so that what a person approves is
   * what happens.
   */
  app.post("/imports", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, importPreviewRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const contentSha256 = createHash("sha256").update(input.content, "utf8").digest("hex");
    // The same spreadsheet twice is recognised rather than imported twice. Said before the work,
    // not discovered by a unique-index error after it.
    const already = await db
      .from("import_batches")
      .select("id, filename, committed_at")
      .eq("organization_id", org.id)
      .eq("content_sha256", contentSha256)
      .eq("status", "committed")
      .maybeSingle();
    if (already.error) return sendError(c, mapDatabaseError(already.error));
    if (already.data) {
      throw new HttpError(
        409,
        "already_imported",
        "This exact file has already been imported. Nothing was read a second time.",
      );
    }

    const parsed = parseCsv(input.content, IMPORT_ROW_LIMIT);
    if (parsed.headers.length === 0) {
      throw new HttpError(400, "empty_file", "That file has no columns in it.");
    }

    // Suggested from the headers, then overridden by anything the caller stated explicitly.
    const columns: Record<string, ImportColumn | null> = suggestColumns(parsed.headers);
    for (const [header, meaning] of Object.entries(input.columns)) {
      if (header in columns) columns[header] = meaning;
    }
    const mapped = new Set(Object.values(columns).filter(Boolean) as ImportColumn[]);

    const blocking: string[] = [];
    if (!mapped.has("client_name")) {
      blocking.push(
        "No column in this file was recognised as the client's name, and everything else is filed under a client.",
      );
    }
    if (mapped.has("premium_amount") && !input.premiumBasis) {
      blocking.push(
        "This file has a premium column. Say whether those figures are the gross premium or the total the client pays — the two differ by the statutory levies and cannot be told apart from the numbers.",
      );
    }

    const existing = await db
      .from("clients")
      .select("id, name, kind")
      .eq("organization_id", org.id)
      .is("deleted_at", null);
    if (existing.error) return sendError(c, mapDatabaseError(existing.error));
    const candidates = (existing.data ?? []) as ClientCandidate[];

    const batchInsert = await db
      .from("import_batches")
      .insert({
        organization_id: org.id,
        filename: input.filename,
        content_sha256: contentSha256,
        row_count: parsed.rows.length,
        premium_basis: input.premiumBasis,
        status: "previewed",
        created_by: user.id,
      })
      .select(IMPORT_BATCH_COLUMNS)
      .single();
    if (batchInsert.error) return sendError(c, mapDatabaseError(batchInsert.error));
    const batch = toBatch(batchInsert.data as BatchRow);

    /*
     * Names created earlier in this same file count as existing for the rows after them.
     * Otherwise a book with twelve policies for one client proposes creating that client twelve
     * times, and the duplicate check would only catch it on the second import.
     */
    const seenInFile = new Map<string, string>();
    const rowInserts: Record<string, unknown>[] = [];
    const previews: Omit<ImportRowPreview, "id">[] = [];

    for (const raw of parsed.rows) {
      const r = interpretRow(raw, columns, input.premiumBasis as PremiumBasis | null);
      let outcome: ImportRowPreview["outcome"];
      let problem = r.problem;
      let matchedClientId: string | null = null;
      let rowCandidates: { id: string; name: string }[] = [];

      if (problem) {
        outcome = "invalid";
      } else {
        const key = r.clientName.trim().toLowerCase();
        const earlier = seenInFile.get(key);
        const match = matchClientName(r.clientName, candidates);
        if (earlier) {
          outcome = "match";
        } else if (match.outcome === "one") {
          outcome = "match";
          matchedClientId = match.client.id;
        } else if (match.outcome === "many") {
          outcome = "needs_review";
          rowCandidates = match.candidates.slice(0, 5).map((x) => ({ id: x.id, name: x.name }));
          problem = "More than one client here could be this one. Nothing was written for this row.";
        } else {
          outcome = "create";
          // Counting it as seen means the next line naming this client attaches rather than
          // proposing to create it again — a book with twelve policies for one client would
          // otherwise propose creating that client twelve times.
          seenInFile.set(key, key);
        }
      }

      previews.push({
        lineNumber: r.lineNumber,
        outcome,
        problem,
        clientName: r.clientName || null,
        contactName: r.contactName,
        contactEmail: r.contactEmail,
        policyNumber: r.policyNumber,
        insurerName: r.insurerName,
        classOfBusiness: r.classOfBusiness,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        premiumAmount: r.premiumAmount,
        matchedClientId,
        candidates: rowCandidates,
      });
      rowInserts.push({
        organization_id: org.id,
        batch_id: batch.id,
        line_number: r.lineNumber,
        // The interpretation, not the original text: this is what the commit will act on, and
        // storing it is what makes the preview binding.
        raw: r as unknown as Record<string, unknown>,
        outcome,
        problem,
        matched_client_id: matchedClientId,
      });
    }

    // Lines the parser could not read at all are rows of the file too, and a person who uploaded
    // 400 lines and sees 398 deserves to know which two and why.
    for (const p of parsed.problems) {
      previews.push({
        lineNumber: p.lineNumber,
        outcome: "invalid",
        problem: p.problem,
        clientName: null,
        contactName: null,
        contactEmail: null,
        policyNumber: null,
        insurerName: null,
        classOfBusiness: null,
        periodStart: null,
        periodEnd: null,
        premiumAmount: null,
        matchedClientId: null,
        candidates: [],
      });
      rowInserts.push({
        organization_id: org.id,
        batch_id: batch.id,
        line_number: p.lineNumber,
        raw: { unreadable: true },
        outcome: "invalid",
        problem: p.problem,
      });
    }

    if (rowInserts.length > 0) {
      const stored = await db.from("import_rows").insert(rowInserts).select("id, line_number");
      if (stored.error) return sendError(c, mapDatabaseError(stored.error));
      const byLine = new Map(
        ((stored.data ?? []) as { id: string; line_number: number }[]).map((x) => [
          x.line_number,
          x.id,
        ]),
      );
      for (const p of previews) {
        (p as ImportRowPreview).id = byLine.get(p.lineNumber) ?? "";
      }
    }

    const rows = previews as ImportRowPreview[];
    return c.json(
      importPreviewResponseSchema.parse({
        batch,
        rows: rows.sort((a, b) => a.lineNumber - b.lineNumber),
        summary: summarise(rows),
        columns: parsed.headers.map((h) => ({ header: h, meaning: columns[h] ?? null })),
        blocking,
      }),
      201,
    );
  });

  /**
   * Write what the preview said, and nothing else.
   *
   * Rows that were invalid or need review are not written and are not silently dropped: the batch
   * counts them, and the response names what did not land.
   */
  app.post("/imports/:id/commit", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, importCommitRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    const batchId = c.req.param("id");

    const found = await db
      .from("import_batches")
      .select(IMPORT_BATCH_COLUMNS)
      .eq("organization_id", org.id)
      .eq("id", batchId)
      .maybeSingle();
    if (found.error) return sendError(c, mapDatabaseError(found.error));
    if (!found.data) throw new HttpError(404, "not_found", "No import with that id");
    const batch = toBatch(found.data as BatchRow);
    if (batch.status === "committed") {
      throw new HttpError(409, "already_committed", "This import has already been committed.");
    }

    const rowsR = await db
      .from("import_rows")
      .select("id, line_number, raw, outcome, matched_client_id")
      .eq("organization_id", org.id)
      .eq("batch_id", batchId)
      .order("line_number", { ascending: true });
    if (rowsR.error) return sendError(c, mapDatabaseError(rowsR.error));

    const skip = new Set(input.skipLineNumbers);
    const failures: { lineNumber: number; problem: string }[] = [];
    let clientsCreated = 0;
    let contactsCreated = 0;
    let policiesCreated = 0;
    let periodsCreated = 0;
    let rowsSkipped = 0;

    // Clients created during this commit, so later rows for the same client attach rather than
    // attempting to create it again.
    const createdByName = new Map<string, string>();

    for (const row of (rowsR.data ?? []) as StoredRow[]) {
      if (row.outcome !== "create" && row.outcome !== "match") {
        rowsSkipped++;
        continue;
      }
      if (skip.has(row.line_number)) {
        rowsSkipped++;
        await db.from("import_rows").update({ outcome: "skipped" }).eq("id", row.id);
        continue;
      }
      const r = row.raw as unknown as InterpretedRow;
      const key = r.clientName.trim().toLowerCase();

      try {
        let clientId = row.matched_client_id ?? createdByName.get(key) ?? null;

        if (!clientId) {
          // The same function `+ New` calls. `confirmNew` has effectively already happened: the
          // preview ran the duplicate check and a person approved the result.
          const created = await db.rpc("client_create", {
            p_organization_id: org.id,
            p_name: r.clientName,
            p_kind: r.clientKind,
            p_source: "imported",
          });
          if (created.error) throw created.error;
          clientId = (created.data as { id: string }).id;
          createdByName.set(key, clientId);
          clientsCreated++;
        }

        if (r.contactName || r.contactEmail || r.contactPhone) {
          const contact = await db
            .from("client_contacts")
            .insert({
              organization_id: org.id,
              client_id: clientId,
              full_name: r.contactName ?? r.clientName,
              role_label: r.contactRole,
              email: r.contactEmail,
              phone: r.contactPhone,
              // The first contact a client gets is the one to write to; a later import does not
              // silently take that over, because the partial unique index would refuse it.
              is_primary: !createdByName.has(`${key}:contact`),
              source: "import",
              created_by: user.id,
            })
            .select("id")
            .maybeSingle();
          // A contact already on file is not a failure: the row's client and policy still land.
          if (!contact.error && contact.data) {
            createdByName.set(`${key}:contact`, contact.data.id);
            contactsCreated++;
          }
        }

        if (r.policyNumber && r.periodStart && r.periodEnd && r.insurerName) {
          const policy = await db.rpc("policy_create", {
            p_client_id: clientId,
            p_insurer_name: r.insurerName,
            p_class_of_business: r.classOfBusiness ?? "Unclassified",
            p_policy_number: r.policyNumber,
            p_period_start: r.periodStart,
            p_period_end: r.periodEnd,
          });
          if (policy.error) throw policy.error;
          const result = policy.data as { policy_id: string; period_id: string; created: boolean };
          if (result.created) policiesCreated++;
          periodsCreated++;

          if (r.premiumAmount && batch.premiumBasis) {
            // Through the engine's own function, like every other write: a signed-in role has no
            // update grant on `policy_periods` and never should.
            const premium = await db.rpc("policy_period_record_premium", {
              p_period_id: result.period_id,
              p_amount: r.premiumAmount,
              p_currency: r.premiumCurrency ?? "KES",
              p_basis: batch.premiumBasis,
              p_commission_rate: r.commissionRate,
              p_commission_amount: r.commissionAmount,
              // Imported, and unverified until a document backs it: what the brokerage's old
              // system said is not the same as what a schedule says.
              p_source: "import",
            });
            if (premium.error) throw premium.error;
          }

          await db
            .from("import_rows")
            .update({
              outcome: "committed",
              created_client_id: createdByName.get(key) ?? null,
              created_policy_id: result.policy_id,
              created_period_id: result.period_id,
            })
            .eq("id", row.id);
        } else {
          await db
            .from("import_rows")
            .update({ outcome: "committed", created_client_id: createdByName.get(key) ?? null })
            .eq("id", row.id);
        }
      } catch (e) {
        /*
         * A Supabase error is a plain object, not an Error, so `instanceof` discarded every
         * message and every row failed with a sentence that said nothing. What the database
         * refused is the only useful thing here, and it goes to the person who must fix the file.
         */
        const problem =
          (e as { message?: string } | null)?.message ?? "This row could not be written.";
        failures.push({ lineNumber: row.line_number, problem });
        await db.from("import_rows").update({ outcome: "failed", problem }).eq("id", row.id);
      }
    }

    const finished = await db
      .from("import_batches")
      .update({
        status: "committed",
        clients_created: clientsCreated,
        contacts_created: contactsCreated,
        policies_created: policiesCreated,
        periods_created: periodsCreated,
        rows_skipped: rowsSkipped,
        committed_at: new Date().toISOString(),
      })
      .eq("organization_id", org.id)
      .eq("id", batchId)
      .select(IMPORT_BATCH_COLUMNS)
      .single();
    if (finished.error) return sendError(c, mapDatabaseError(finished.error));

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "import.committed",
      objectType: "import_batch",
      objectId: batchId,
      newState: {
        filename: batch.filename,
        clients_created: clientsCreated,
        contacts_created: contactsCreated,
        policies_created: policiesCreated,
        periods_created: periodsCreated,
        rows_skipped: rowsSkipped,
        failed: failures.length,
      },
      result: failures.length > 0 ? "failure" : "success",
      failureReason: failures.length > 0 ? `${failures.length} rows could not be written` : null,
    });

    return c.json(
      importCommitResponseSchema.parse({ batch: toBatch(finished.data as BatchRow), failures }),
    );
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}

type ContactRow = {
  id: string;
  client_id: string;
  full_name: string;
  role_label: string | null;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  source: "manual" | "import" | "email" | "seed";
  notes: string | null;
  created_at: string;
};

function toContact(row: ContactRow) {
  return {
    id: row.id,
    clientId: row.client_id,
    fullName: row.full_name,
    roleLabel: row.role_label,
    email: row.email,
    phone: row.phone,
    isPrimary: row.is_primary,
    source: row.source,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

type BatchRow = {
  id: string;
  filename: string;
  row_count: number;
  premium_basis: PremiumBasis | null;
  status: ImportBatch["status"];
  clients_created: number;
  contacts_created: number;
  policies_created: number;
  periods_created: number;
  rows_skipped: number;
  failure_reason: string | null;
  created_at: string;
  committed_at: string | null;
};

type StoredRow = {
  id: string;
  line_number: number;
  raw: Record<string, unknown>;
  outcome: ImportRowPreview["outcome"];
  matched_client_id: string | null;
};

function toBatch(row: BatchRow): ImportBatch {
  return {
    id: row.id,
    filename: row.filename,
    rowCount: row.row_count,
    premiumBasis: row.premium_basis,
    status: row.status,
    clientsCreated: row.clients_created,
    contactsCreated: row.contacts_created,
    policiesCreated: row.policies_created,
    periodsCreated: row.periods_created,
    rowsSkipped: row.rows_skipped,
    failureReason: row.failure_reason,
    createdAt: row.created_at,
    committedAt: row.committed_at,
  };
}

function summarise(rows: ImportRowPreview[]) {
  return {
    rows: rows.length,
    clientsToCreate: new Set(
      rows.filter((r) => r.outcome === "create").map((r) => r.clientName?.toLowerCase()),
    ).size,
    contactsToCreate: rows.filter(
      (r) => (r.outcome === "create" || r.outcome === "match") && (r.contactName || r.contactEmail),
    ).length,
    policiesToCreate: rows.filter(
      (r) => (r.outcome === "create" || r.outcome === "match") && r.policyNumber,
    ).length,
    needsReview: rows.filter((r) => r.outcome === "needs_review").length,
    invalid: rows.filter((r) => r.outcome === "invalid").length,
  };
}
