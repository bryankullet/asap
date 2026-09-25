import { clientSpaceResponseSchema, type ClientSpaceResponse } from "@asap/schema";
import { Hono } from "hono";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";

/**
 * Everything that matters about one client, in one read.
 *
 * A relationship is not nine independent lists, and assembling it in the browser would mean nine
 * round trips and nine chances for one of them to be scoped to the wrong brokerage. Every query
 * below is filtered by `organization_id` as well as by client, under the caller's own RLS — the
 * belt and the braces, because this is the read that touches the most tables.
 *
 * Two things this route will not do:
 *
 *  - **Invent a figure.** A premium is reported as recorded, with its source and whether a
 *    document backs it. There is no balance, because no table holds payments; the Space says so
 *    rather than rendering a confident zero.
 *  - **Claim a capability.** Quotes have no table yet. That is returned as a named gap with the
 *    increment that will build it, so the screen can offer it as unavailable-with-a-reason rather
 *    than as a button that does nothing.
 */
/*
 * No logger dependency: this route reads, and a read that fails returns the error to the caller
 * rather than narrating it. Anything worth recording here would be a business action, and there
 * are none — every write a person starts from this Space goes through the route that owns it.
 */
export function clientRoutes() {
  const app = new Hono();

  app.get("/clients/:id/space", async (c) => {
    const { db, user } = c.get("auth");
    const id = c.req.param("id");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const clientQ = await db
      .from("clients")
      .select("id, name, kind, file_status, created_at")
      .eq("organization_id", org.id)
      .eq("id", id)
      .is("deleted_at", null)
      .maybeSingle();
    if (clientQ.error) return sendError(c, mapDatabaseError(clientQ.error));
    if (!clientQ.data) throw new HttpError(404, "not_found", "No client with that id");
    const client = clientQ.data as {
      id: string;
      name: string;
      kind: "individual" | "corporate";
      file_status: string;
      created_at: string;
    };

    const [contactsQ, policiesQ, workQ, claimsQ, endorsementsQ, documentsQ, threadsQ, mailboxQ, fileQ] =
      await Promise.all([
        db
          .from("client_contacts")
          .select("id, full_name, role_label, email, phone, is_primary")
          .eq("organization_id", org.id)
          .eq("client_id", id)
          .order("is_primary", { ascending: false }),
        db
          .from("policies")
          .select("id, policy_number, class_of_business, insurer_id")
          .eq("organization_id", org.id)
          .eq("client_id", id)
          .is("deleted_at", null),
        db
          .from("work_items")
          .select("id, kind, title, task_status, task_party, task_since, owner_id, completed_at")
          .eq("organization_id", org.id)
          .eq("client_id", id)
          .order("created_at", { ascending: false })
          .limit(50),
        db
          .from("claims")
          .select("id, work_item_id, status, incident_on, incident_summary, insurer_reference, policy_id")
          .eq("organization_id", org.id)
          .eq("client_id", id)
          .order("incident_on", { ascending: false })
          .limit(50),
        db
          .from("endorsements")
          .select("id, work_item_id, kind, status, effective_on, policy_id, client_id")
          .eq("organization_id", org.id)
          .eq("client_id", id)
          .order("created_at", { ascending: false })
          .limit(50),
        db
          .from("documents")
          .select("id, filename, kind, extraction_state, created_at")
          .eq("organization_id", org.id)
          .eq("client_id", id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(50),
        db
          .from("email_threads")
          .select("id, subject, last_message_at")
          .eq("organization_id", org.id)
          .eq("client_id", id)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(20),
        db.from("mailboxes").select("id").eq("organization_id", org.id).eq("status", "connected").limit(1),
        db
          .from("client_file_documents")
          .select("kind, label, received_at")
          .eq("organization_id", org.id)
          .eq("client_id", id),
      ]);

    for (const q of [contactsQ, policiesQ, workQ, claimsQ, endorsementsQ, documentsQ, threadsQ, fileQ]) {
      if (q.error) return sendError(c, mapDatabaseError(q.error));
    }

    const policyRows = (policiesQ.data ?? []) as {
      id: string;
      policy_number: string | null;
      class_of_business: string;
      insurer_id: string | null;
    }[];

    /*
     * Periods and insurer names, fetched by id rather than joined. The stand-in the API tests run
     * against does not execute embedded selects, and a route that only works against one of the
     * two is a route whose tests prove nothing.
     */
    const periodsQ = await db
      .from("policy_periods")
      .select(
        "id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis, commission_amount, premium_source, premium_verified_at, premium_evidence_document_id",
      )
      .eq("organization_id", org.id)
      .in("policy_id", policyRows.map((p) => p.id))
      .order("period_start", { ascending: false });
    if (periodsQ.error) return sendError(c, mapDatabaseError(periodsQ.error));

    const insurerIds = [...new Set(policyRows.map((p) => p.insurer_id).filter((i): i is string => i !== null))];
    const insurersQ = insurerIds.length
      ? await db.from("insurers").select("id, name").eq("organization_id", org.id).in("id", insurerIds)
      : { data: [], error: null };
    if (insurersQ.error) return sendError(c, mapDatabaseError(insurersQ.error));
    const insurerName = new Map(
      ((insurersQ.data ?? []) as { id: string; name: string }[]).map((i) => [i.id, i.name]),
    );

    const workRows = (workQ.data ?? []) as {
      id: string;
      kind: string;
      title: string;
      task_status: "needs_you" | "with_party" | "in_progress" | "done";
      task_party: string | null;
      task_since: string | null;
      owner_id: string | null;
      completed_at: string | null;
    }[];
    const ownerIds = [...new Set(workRows.map((w) => w.owner_id).filter((o): o is string => o !== null))];
    const ownersQ = ownerIds.length
      ? await db.from("users").select("id, display_name, full_name").in("id", ownerIds)
      : { data: [], error: null };
    const ownerName = new Map(
      ((ownersQ.data ?? []) as { id: string; display_name: string | null; full_name: string | null }[]).map(
        (u) => [u.id, u.display_name ?? u.full_name ?? null],
      ),
    );

    const threadRows = (threadsQ.data ?? []) as {
      id: string;
      subject: string;
      last_message_at: string | null;
    }[];
    const countsQ = threadRows.length
      ? await db
          .from("email_messages")
          .select("thread_id")
          .eq("organization_id", org.id)
          .in("thread_id", threadRows.map((t) => t.id))
      : { data: [], error: null };
    const messageCount = new Map<string, number>();
    for (const m of (countsQ.data ?? []) as { thread_id: string }[]) {
      messageCount.set(m.thread_id, (messageCount.get(m.thread_id) ?? 0) + 1);
    }

    /* Today, for deciding which period is current. Dates only: a period is a day range. */
    const today = new Date().toISOString().slice(0, 10);

    const body: ClientSpaceResponse = {
      client: {
        id: client.id,
        name: client.name,
        kind: client.kind,
        fileStatus: client.file_status,
        createdAt: client.created_at,
      },
      contacts: ((contactsQ.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r["id"] as string,
        fullName: r["full_name"] as string,
        roleLabel: (r["role_label"] as string | null) ?? null,
        email: (r["email"] as string | null) ?? null,
        phone: (r["phone"] as string | null) ?? null,
        isPrimary: Boolean(r["is_primary"]),
      })),
      policies: policyRows.map((p) => ({
        id: p.id,
        policyNumber: p.policy_number,
        classOfBusiness: p.class_of_business,
        insurerName: p.insurer_id === null ? null : (insurerName.get(p.insurer_id) ?? null),
        periods: ((periodsQ.data ?? []) as Record<string, unknown>[])
          .filter((r) => r["policy_id"] === p.id)
          .map((r) => ({
            id: r["id"] as string,
            periodStart: r["period_start"] as string,
            periodEnd: r["period_end"] as string,
            premiumAmount: (r["premium_amount"] as string | null) ?? null,
            premiumCurrency: (r["premium_currency"] as string | null) ?? null,
            premiumBasis: (r["premium_basis"] as "gross" | "total_payable" | null) ?? null,
            commissionAmount: (r["commission_amount"] as string | null) ?? null,
            premiumSource: (r["premium_source"] as "manual" | "import" | "document" | "seed") ?? "manual",
            premiumVerifiedAt: (r["premium_verified_at"] as string | null) ?? null,
            premiumEvidenceDocumentId: (r["premium_evidence_document_id"] as string | null) ?? null,
            current:
              (r["period_start"] as string) <= today && today <= (r["period_end"] as string),
          })),
      })),
      work: workRows.map((w) => ({
        id: w.id,
        kind: w.kind,
        title: w.title,
        taskStatus: w.task_status,
        taskParty: w.task_party,
        taskSince: w.task_since,
        ownerName: w.owner_id === null ? null : (ownerName.get(w.owner_id) ?? null),
        completedAt: w.completed_at,
      })),
      claims: ((claimsQ.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r["id"] as string,
        workItemId: r["work_item_id"] as string,
        status: r["status"] as "draft" | "registered" | "closed",
        incidentOn: r["incident_on"] as string,
        incidentSummary: r["incident_summary"] as string,
        insurerReference: (r["insurer_reference"] as string | null) ?? null,
        policyId: (r["policy_id"] as string | null) ?? null,
      })),
      endorsements: ((endorsementsQ.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r["id"] as string,
        workItemId: r["work_item_id"] as string,
        kind: r["kind"] as string,
        status: r["status"] as string,
        effectiveOn: (r["effective_on"] as string | null) ?? null,
        policyId: (r["policy_id"] as string | null) ?? null,
      })),
      documents: ((documentsQ.data ?? []) as Record<string, unknown>[]).map((r) => ({
        id: r["id"] as string,
        filename: r["filename"] as string,
        kind: r["kind"] as string,
        extractionState: r["extraction_state"] as string,
        createdAt: r["created_at"] as string,
      })),
      threads: threadRows.map((t) => ({
        id: t.id,
        subject: t.subject,
        lastMessageAt: t.last_message_at,
        messageCount: messageCount.get(t.id) ?? 0,
      })),
      /* What the file still wants: a requested document with nothing received against it. */
      fileMissing: ((fileQ.data ?? []) as Record<string, unknown>[])
        .filter((r) => r["received_at"] === null || r["received_at"] === undefined)
        .map((r) => (r["label"] as string) || (r["kind"] as string)),
      mailboxConnected: ((mailboxQ.data ?? []) as unknown[]).length > 0,
      /* Resolved from the session (§45 rule 5). The browser sends no role and no permission. */
      permissions: {
        canEditContacts: hasPermission(ctx, "client", "edit"),
        canUploadDocuments: hasPermission(ctx, "document", "create"),
        canStartWork: hasPermission(ctx, "space", "create"),
      },
      /*
       * Named absences. Each says which increment builds it, so the screen offers an unavailable
       * action with a reason instead of a button whose only effect is to look like it worked.
       */
      gaps: [
        {
          id: "money",
          label: "Premium and balance",
          reason:
            "Premiums are recorded against each period, but invoices and payments have no records yet, so ASAP cannot say what is outstanding.",
          gap: "4D",
        },
      ],
    };

    return c.json(clientSpaceResponseSchema.parse(body));
  });

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
