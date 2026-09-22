import {
  onboardingResponseSchema,
  saveOnboardingRequestSchema,
  type Onboarding,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { hasPermission, requireActiveOrganization, resolveContext } from "../context.js";
import { HttpError, mapDatabaseError, sendError } from "../errors.js";
import { parseBody } from "./_parse.js";

/**
 * A person's first day, as rows.
 *
 * Three things this surface exists to make true, none of which component state can:
 *
 *  - **A refresh does not undo a step.** Where somebody got to is a row, so closing the tab on
 *    step three and coming back lands on step three.
 *  - **A skip is an answer.** "Not connecting a mailbox yet" and "has not got that far" are
 *    different facts, and a product that cannot tell them apart nags people who already decided.
 *  - **Nobody is walked through it twice.** Completion is a timestamp. Somebody who joins an
 *    existing brokerage gets their own first day there, and changes nothing about the brokerage:
 *    the company step is a form only for whoever created it, and a read-only summary otherwise.
 *
 * What is *not* here is any copy of the brokerage's own details. Those are `organizations`, which
 * already exists by the time this row does; a second copy would be a second thing to get wrong.
 */
export function onboardingRoutes(deps: {
  logger: Logger;
  /** True when this deployment holds Google credentials, so step three can be honest. */
  gmailConfigured: boolean;
}) {
  const app = new Hono();

  app.get("/onboarding", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);
    return c.json(onboardingResponseSchema.parse({ onboarding: await read(db, org.id, user.id) }));
  });

  /**
   * Move a step, or record a choice.
   *
   * The row is created on first write rather than on first read, so a person who never opens
   * onboarding never acquires one. It is keyed on (brokerage, person), which is what makes this
   * safe to call twice with the same body — the second call writes the same values.
   */
  app.put("/onboarding", async (c) => {
    const { db, user } = c.get("auth");
    const input = await parseBody(c, saveOnboardingRequestSchema);
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    if (input.step === undefined && input.recordsChoice === undefined && input.mailboxChoice === undefined) {
      throw new HttpError(400, "invalid_request", "Say which step or which choice to record.");
    }

    const saved = await db.from("user_onboarding").upsert(
      {
        organization_id: org.id,
        user_id: user.id,
        ...(input.step === undefined ? {} : { step: input.step }),
        ...(input.recordsChoice === undefined ? {} : { records_choice: input.recordsChoice }),
        ...(input.mailboxChoice === undefined ? {} : { mailbox_choice: input.mailboxChoice }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "organization_id,user_id" },
    );
    if (saved.error) return sendError(c, mapDatabaseError(saved.error));

    /*
     * A choice is audited; moving between steps is not. Deciding to skip putting records in, or
     * to skip connecting a mailbox, is a decision somebody may later have to account for; paging
     * back and forth is not, and an audit trail full of it hides the decisions.
     */
    if (input.recordsChoice !== undefined || input.mailboxChoice !== undefined) {
      await recordAudit(db, deps.logger, c, {
        organizationId: org.id,
        actorUserId: user.id,
        action: "onboarding.choice_recorded",
        objectType: "user_onboarding",
        result: "success",
        newState: {
          ...(input.recordsChoice === undefined ? {} : { recordsChoice: input.recordsChoice }),
          ...(input.mailboxChoice === undefined ? {} : { mailboxChoice: input.mailboxChoice }),
        },
      });
    }

    return c.json(onboardingResponseSchema.parse({ onboarding: await read(db, org.id, user.id) }));
  });

  /**
   * Finish.
   *
   * Idempotent by reading first: a second press finds `completed_at` already set, writes nothing
   * and audits nothing. The unique row per person per brokerage is what makes that reliable
   * rather than a race between two clicks.
   */
  app.post("/onboarding/complete", async (c) => {
    const { db, user } = c.get("auth");
    const ctx = await resolveContext(db, user.id);
    const org = requireActiveOrganization(ctx);

    const existing = await db
      .from("user_onboarding")
      .select("id, completed_at")
      .eq("organization_id", org.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existing.error) return sendError(c, mapDatabaseError(existing.error));

    const already = (existing.data as { completed_at: string | null } | null)?.completed_at ?? null;
    if (already !== null) {
      // Already finished. Nothing is written and nothing is audited a second time.
      return c.json(onboardingResponseSchema.parse({ onboarding: await read(db, org.id, user.id) }));
    }

    const now = new Date().toISOString();
    const saved = await db.from("user_onboarding").upsert(
      {
        organization_id: org.id,
        user_id: user.id,
        step: 4,
        completed_at: now,
        updated_at: now,
      },
      { onConflict: "organization_id,user_id" },
    );
    if (saved.error) return sendError(c, mapDatabaseError(saved.error));

    await recordAudit(db, deps.logger, c, {
      organizationId: org.id,
      actorUserId: user.id,
      action: "onboarding.completed",
      objectType: "user_onboarding",
      result: "success",
      newState: { completedAt: now },
    });

    return c.json(onboardingResponseSchema.parse({ onboarding: await read(db, org.id, user.id) }));
  });

  /**
   * What is true right now.
   *
   * The counts are read from the brokerage's own rows rather than from anything onboarding
   * recorded: "you have put some records in" must be true because records exist, not because a
   * step was marked done.
   */
  async function read(
    db: SupabaseClient,
    organizationId: string,
    userId: string,
  ): Promise<Onboarding> {
    const ctx = await resolveContext(db, userId);

    const row = await db
      .from("user_onboarding")
      .select("step, records_choice, mailbox_choice, completed_at")
      .eq("organization_id", organizationId)
      .eq("user_id", userId)
      .maybeSingle();
    const state = (row.data ?? null) as {
      step?: number;
      records_choice?: string | null;
      mailbox_choice?: string | null;
      completed_at?: string | null;
    } | null;

    const orgRow = await db
      .from("organizations")
      .select("id, name, country, currency, timezone, created_by")
      .eq("id", organizationId)
      .maybeSingle();
    const company = orgRow.data as
      | { id: string; name: string; country: string; currency: string; timezone: string; created_by: string | null }
      | null;

    const [documents, imports, clients, mailboxes] = await Promise.all([
      db.from("documents").select("id").eq("organization_id", organizationId).limit(200),
      db.from("import_batches").select("id").eq("organization_id", organizationId).limit(200),
      db.from("clients").select("id").eq("organization_id", organizationId).limit(200),
      db
        .from("mailboxes")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("status", "connected")
        .limit(1),
    ]);

    return {
      step: state?.step ?? 1,
      recordsChoice: (state?.records_choice ?? null) as Onboarding["recordsChoice"],
      mailboxChoice: (state?.mailbox_choice ?? null) as Onboarding["mailboxChoice"],
      completedAt: state?.completed_at ?? null,
      company:
        company === null
          ? null
          : {
              id: company.id,
              name: company.name,
              country: company.country,
              currency: company.currency,
              timezone: company.timezone,
              /*
               * Resolved from the session, never sent by the browser (§45 rule 5). Somebody who
               * joined an existing brokerage sees its details and cannot overwrite them here.
               */
              canEdit: hasPermission(ctx, "organization", "edit"),
              createdByYou: company.created_by === userId,
            },
      progress: {
        documents: (documents.data ?? []).length,
        imports: (imports.data ?? []).length,
        clients: (clients.data ?? []).length,
        mailboxConnected: (mailboxes.data ?? []).length > 0,
      },
      gmailConfigured: deps.gmailConfigured,
      gmailUnavailableReason: deps.gmailConfigured
        ? null
        : "Gmail connection is not configured. Whoever administers this deployment can add the Google credentials.",
    };
  }

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    throw err;
  });
  return app;
}
