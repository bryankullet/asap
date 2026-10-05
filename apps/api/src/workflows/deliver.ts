import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Context } from "hono";
import type { Logger } from "pino";
import { recordAudit } from "../audit.js";
import { decryptToken, encryptToken } from "../mailbox/crypto.js";
import { sendThroughMailbox } from "../mailbox/send.js";
import type { MailboxCredentials, MailboxProvider } from "../mailbox/types.js";
import { quoteRequestDigest, recordQuoteDelivery } from "../quotation/requests.js";

/**
 * Approved messages leave through the mailbox boundary (D-145).
 *
 * When a person approves a bundle, each message in it is sent — but only where all of these hold:
 *  - a mailbox is connected and the deployment holds its provider;
 *  - the message has an address a person verified (the insurer's recorded contact, or the address
 *    the message was prepared with);
 *  - the body about to leave is byte for byte the body that was approved (its hash, and for a
 *    quotation request the request's approved digest).
 * The send is the approver's: `sendThroughMailbox` records them as the approver, keyed on the
 * message id and its body hash, so approving twice, retrying, or a duplicated event sends once.
 * The provider's id is the evidence that advances the run. Anything else stays with a person,
 * exactly as before: delivered by hand and recorded.
 */
export type MailboxDeps = { providers: Partial<Record<"gmail" | "microsoft", MailboxProvider>>; encryptionKey: string } | undefined;

type Comm = { id: string; organization_id: string; run_id: string; audience: string; party_name: string; to_address: string | null; subject: string; body_text: string; body_sha256: string; state: string; quote_request_id: string | null };
export type DeliveryOutcome = { communicationId: string; party: string; outcome: "sent" | "already_sent" | "manual" | "refused" | "failed" | "outcome_unknown"; why: string };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function connectedMailbox(db: SupabaseClient, service: SupabaseClient, mailbox: MailboxDeps, organizationId: string): Promise<{ id: string; provider: MailboxProvider; credentials: MailboxCredentials; address: string } | null> {
  if (!mailbox) return null;
  const r = await db.from("mailboxes").select("id, provider, email_address").eq("organization_id", organizationId).eq("status", "connected").order("created_at").limit(1);
  const box = ((r.data ?? []) as { id: string; provider: "gmail" | "microsoft"; email_address: string }[])[0];
  const provider = box ? mailbox.providers[box.provider] : undefined;
  if (!box || !provider) return null;
  // Tokens are read on the engine's connection: no person's session ever holds them.
  const t = await service.from("mailboxes").select("access_token_encrypted, refresh_token_encrypted, token_expires_at").eq("id", box.id).maybeSingle();
  const row = t.data as { access_token_encrypted: string | null; refresh_token_encrypted: string | null; token_expires_at: string | null } | null;
  const access = row?.access_token_encrypted ? decryptToken(row.access_token_encrypted, mailbox.encryptionKey) : null;
  const refresh = row?.refresh_token_encrypted ? decryptToken(row.refresh_token_encrypted, mailbox.encryptionKey) : null;
  if (access === null && refresh === null) return null;
  const expired = row?.token_expires_at ? new Date(row.token_expires_at).getTime() <= Date.now() + 60_000 : false;
  if (access !== null && !expired) return { id: box.id, provider, credentials: { accessToken: access, refreshToken: refresh, expiresAt: row?.token_expires_at ?? null }, address: box.email_address };
  const renewed = await provider.refresh({ accessToken: access ?? "", refreshToken: refresh, expiresAt: row?.token_expires_at ?? null });
  if (renewed === "needs_reauthorisation") return null;
  await service.from("mailboxes").update({ access_token_encrypted: encryptToken(renewed.accessToken, mailbox.encryptionKey), token_expires_at: renewed.expiresAt, updated_at: new Date().toISOString() }).eq("id", box.id);
  return { id: box.id, provider, credentials: renewed, address: box.email_address };
}

/** The address a person verified for this message, or null: the insurer's recorded contact, or the one it was prepared with. */
async function verifiedAddress(db: SupabaseClient, m: Comm): Promise<string | null> {
  if (m.to_address) return m.to_address;
  if (m.audience !== "insurer") return null;
  const r = await db.from("insurer_contacts").select("email, insurers!inner(name)").eq("organization_id", m.organization_id).eq("insurers.name", m.party_name).is("retired_at", null).order("verified_at").limit(1);
  return ((r.data ?? []) as { email: string }[])[0]?.email ?? null;
}

/** The approved text, checked again at the moment of sending. */
async function stillApproved(db: SupabaseClient, m: Comm): Promise<string | null> {
  if (sha256(`${m.subject}\n\n${m.body_text}`) !== m.body_sha256) return "The message changed after it was approved.";
  if (m.quote_request_id) {
    const q = await db.from("quote_requests").select("approved_body_sha256").eq("id", m.quote_request_id).maybeSingle();
    const approved = (q.data as { approved_body_sha256: string | null } | null)?.approved_body_sha256;
    if (!approved || approved !== quoteRequestDigest(m.subject, m.body_text)) return "The message is not the quotation request a person approved.";
  }
  return null;
}

export async function deliverApproved(o: { db: SupabaseClient; service: SupabaseClient; logger: Logger; c: Context; mailbox: MailboxDeps; approverId: string; approvalId?: string; communicationId?: string }): Promise<DeliveryOutcome[]> {
  let q = o.db.from("prepared_communications").select("id, organization_id, run_id, audience, party_name, to_address, subject, body_text, body_sha256, state, quote_request_id").in("state", ["approved", "sent"]);
  q = o.approvalId ? q.eq("approval_id", o.approvalId) : q.eq("id", o.communicationId!);
  const comms = ((await q).data ?? []) as Comm[];
  const out: DeliveryOutcome[] = [];
  for (const m of comms) {
    if (m.state === "sent") {
      out.push({ communicationId: m.id, party: m.party_name, outcome: "already_sent", why: "Sent already." });
      continue;
    }
    const box = await connectedMailbox(o.db, o.service, o.mailbox, m.organization_id);
    if (!box) {
      out.push({ communicationId: m.id, party: m.party_name, outcome: "manual", why: "No mailbox is connected, so a person delivers it." });
      continue;
    }
    const to = await verifiedAddress(o.db, m);
    if (!to) {
      out.push({ communicationId: m.id, party: m.party_name, outcome: "manual", why: `No verified address for ${m.party_name} is on file, so a person delivers it.` });
      continue;
    }
    const changed = await stillApproved(o.db, m);
    if (changed) {
      await recordAudit(o.db, o.logger, o.c, { organizationId: m.organization_id, actorUserId: o.approverId, action: "email.send_refused", objectType: "prepared_communication", objectId: m.id, result: "denied", failureReason: "body_changed_after_approval" });
      out.push({ communicationId: m.id, party: m.party_name, outcome: "refused", why: `${changed} Nothing was sent.` });
      continue;
    }
    const res = await sendThroughMailbox({
      db: o.db, logger: o.logger, c: o.c, organizationId: m.organization_id, approverId: o.approverId,
      mailbox: { id: box.id, provider: box.provider, credentials: box.credentials },
      message: { to: [to], cc: [], subject: m.subject, bodyText: m.body_text, replyToProviderThreadId: null, idempotencyKey: `${m.id}:${m.body_sha256}` },
      workItemId: null, draftId: null,
    });
    const attempt = res.state === "already_attempted"
      ? ((await o.db.from("email_send_attempts").select("id, outcome").eq("id", res.attemptId).maybeSingle()).data as { id: string; outcome: string } | null)
      : { id: res.attemptId, outcome: res.state };
    if (attempt?.outcome !== "sent") {
      const outcome = attempt?.outcome === "outcome_unknown" ? "outcome_unknown" : "failed";
      out.push({ communicationId: m.id, party: m.party_name, outcome, why: outcome === "outcome_unknown" ? "The mailbox did not say whether it went. Check the sent folder before anything is sent again." : "The mailbox refused it. Nothing went; a person delivers it." });
      continue;
    }
    const rec = await o.db.rpc("prepared_communication_record_sent", { p_id: m.id, p_attempt_id: attempt.id, p_to_address: to });
    if (rec.error) throw new Error(`a sent message could not be recorded: ${rec.error.message}`);
    if (m.quote_request_id) {
      const qr = await o.db.from("quote_requests").select("opportunity_id").eq("id", m.quote_request_id).maybeSingle();
      const opp = (qr.data as { opportunity_id: string } | null)?.opportunity_id;
      if (opp) await recordQuoteDelivery(o.db, { organizationId: m.organization_id, opportunityId: opp, quoteRequestId: m.quote_request_id, method: "own_email", reference: `Sent to ${to} through the connected mailbox ${box.address}`, deliveredAt: new Date().toISOString(), evidenceDocumentId: null, userId: o.approverId });
    }
    out.push({ communicationId: m.id, party: m.party_name, outcome: "sent", why: `Sent to ${to}.` });
  }
  return out;
}
