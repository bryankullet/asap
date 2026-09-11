import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import type { Context } from "hono";
import { recordAudit } from "../audit.js";
import { mapDatabaseError } from "../errors.js";
import type { MailboxCredentials, MailboxProvider, OutgoingMessage } from "./types.js";

/**
 * Sending, with the three rules that make it safe to let software touch a client's inbox.
 *
 * **1. A person approved it.** The attempt row carries `approved_by` and `approved_at`, and the
 * insert policy requires the approver to be the caller. There is no path from an automation or a
 * model to this function that skips it (§45 rule 13).
 *
 * **2. It cannot send twice.** The attempt is claimed first, by an insert keyed on
 * `(mailbox_id, idempotency_key)`. If that key already exists, this returns what happened last
 * time and sends nothing. Retrying a send that timed out therefore cannot become a second email —
 * the retry reuses the key, finds the attempt, and reports its state.
 *
 * **3. Sent means the provider said so.** The outcome is written from what the provider returned,
 * and `sent` requires an id. `outcome_unknown` stays unknown: it is not retried automatically and
 * it is not rounded to either neighbour. A person sees it and decides, because only they can check
 * the sent folder and know whether the client already has the letter.
 */

export type SendResult =
  | { state: "sent"; attemptId: string; providerMessageId: string }
  | { state: "failed"; attemptId: string; reason: string }
  | { state: "outcome_unknown"; attemptId: string; reason: string }
  | { state: "already_attempted"; attemptId: string; outcome: string };

export async function sendThroughMailbox(input: {
  db: SupabaseClient;
  logger: Logger;
  c: Context;
  organizationId: string;
  approverId: string;
  mailbox: { id: string; provider: MailboxProvider; credentials: MailboxCredentials };
  message: OutgoingMessage;
  workItemId: string | null;
  draftId: string | null;
}): Promise<SendResult> {
  const { db, logger, c, organizationId, approverId, mailbox, message } = input;
  const now = new Date().toISOString();

  // Claim the intent before touching the provider. If this key already exists, someone — a double
  // click, a retried job, a duplicated webhook — is asking for the same email a second time.
  const { data: claimed, error: claimErr } = await db
    .from("email_send_attempts")
    .insert({
      organization_id: organizationId,
      mailbox_id: mailbox.id,
      draft_id: input.draftId,
      work_item_id: input.workItemId,
      idempotency_key: message.idempotencyKey,
      approved_by: approverId,
      approved_at: now,
      attempt_count: 1,
      outcome: "preparing",
    })
    .select("id, outcome")
    .single();

  if (claimErr) {
    // 23505: the key is taken. Report what the existing attempt says; never send again.
    const mapped = mapDatabaseError(claimErr);
    const { data: existing } = await db
      .from("email_send_attempts")
      .select("id, outcome")
      .eq("mailbox_id", mailbox.id)
      .eq("idempotency_key", message.idempotencyKey)
      .maybeSingle();
    if (existing) {
      const row = existing as { id: string; outcome: string };
      logger.info({ attemptId: row.id }, "send suppressed: this message was already attempted");
      return { state: "already_attempted", attemptId: row.id, outcome: row.outcome };
    }
    throw mapped;
  }

  const attemptId = (claimed as { id: string }).id;
  const outcome = await mailbox.provider.send({ credentials: mailbox.credentials, message });

  const patch =
    outcome.outcome === "sent"
      ? {
          outcome: "sent",
          provider_message_id: outcome.providerMessageId,
          provider_thread_id: outcome.providerThreadId,
          provider_accepted_at: outcome.acceptedAt,
          failure_reason: null,
        }
      : { outcome: outcome.outcome, failure_reason: outcome.reason };

  const { error: updateErr } = await db
    .from("email_send_attempts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", attemptId);
  if (updateErr) {
    // The email may have gone but we could not record it. That is exactly the unknown case, and
    // it is loud: without the row nobody can prove what happened.
    logger.error({ attemptId }, "could not record the outcome of a send");
  }

  await recordAudit(db, logger, c, {
    organizationId,
    actorUserId: approverId,
    action: "email.send_attempted",
    objectType: "email_send_attempt",
    objectId: attemptId,
    result: outcome.outcome === "sent" ? "success" : "failure",
    // Recipients and the provider's id — never the subject or the body (docs/SECRETS.md).
    newState: {
      outcome: outcome.outcome,
      recipients: message.to.length,
      provider: mailbox.provider.id,
      provider_message_id: outcome.outcome === "sent" ? outcome.providerMessageId : null,
    },
    failureReason: outcome.outcome === "sent" ? null : outcome.reason,
  });

  if (outcome.outcome === "sent") {
    return { state: "sent", attemptId, providerMessageId: outcome.providerMessageId };
  }
  return { state: outcome.outcome, attemptId, reason: outcome.reason };
}
