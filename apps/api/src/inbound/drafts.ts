import { claimSteps, classifyEndorsementRequest, deriveTask, endorsementSteps } from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { autonomyRule, automatic } from "../workflows/renewal.js";

/**
 * Opening a draft claim or endorsement from an email (D-151). Only where every fact the record needs
 * is read deterministically from the email and the brokerage's own records — the model has said only
 * what KIND of email it is:
 *  - the sender is the recorded contact of exactly one client;
 *  - a claim's incident date is stated in the email (a date, or "today"/"yesterday" against when it
 *    was sent); its policy is the one the email names, or the client's only live policy, or none —
 *    a person matches the period either way, and the claim is a draft until they do;
 *  - an endorsement's policy is the one the email names, or the client's only live policy.
 * Anything missing leaves the email Unsorted for a person. Nothing is guessed.
 */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The incident date the email states, or null. Relative words are read against when it was sent (Nairobi). */
export function incidentDateFrom(text: string, sentAt: string): string | null {
  const t = text.toLowerCase();
  const sent = new Date(new Date(sentAt).getTime() + 3 * 3_600_000); // Africa/Nairobi, UTC+3
  const sentDay = new Date(Date.UTC(sent.getUTCFullYear(), sent.getUTCMonth(), sent.getUTCDate()));
  const explicit = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?\b/);
  if (explicit) {
    const year = explicit[3] ? Number(explicit[3]) : sentDay.getUTCFullYear();
    const d = new Date(Date.UTC(year, MONTHS.indexOf(explicit[2]!), Number(explicit[1])));
    if (!explicit[3] && d > sentDay) d.setUTCFullYear(year - 1);
    return d <= sentDay ? iso(d) : null;
  }
  const numeric = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/); // Kenyan day/month/year
  if (numeric) {
    const d = new Date(Date.UTC(Number(numeric[3]), Number(numeric[2]) - 1, Number(numeric[1])));
    return !Number.isNaN(d.getTime()) && d <= sentDay ? iso(d) : null;
  }
  if (/\b(yesterday|last night)\b/.test(t)) return iso(new Date(sentDay.getTime() - 86_400_000));
  if (/\b(today|this morning|this afternoon|this evening|earlier today)\b/.test(t)) return iso(sentDay);
  return null;
}

type Policy = { id: string; policy_number: string | null; class_of_business: string; insurer_id: string | null; insurers: { name: string } | null };

export async function openDraftFromEmail(
  db: SupabaseClient,
  logger: Logger,
  o: { organizationId: string; message: { id: string; from_address: string; subject: string; body_text: string | null; sent_at: string }; kind: "claim_notice" | "endorsement_request" },
): Promise<{ opened: true; workItemId: string } | { opened: false; why: string }> {
  const rule = await autonomyRule(db, o.organizationId);
  if (!automatic(o.kind === "claim_notice" ? rule.actions.prepare_claim : rule.actions.prepare_endorsement)) return { opened: false, why: "This brokerage has not let ASAP open this work." };
  const cc = await db.from("client_contacts").select("client_id, full_name, clients!inner(id, name, organization_id, deleted_at)").eq("organization_id", o.organizationId).ilike("email", o.message.from_address).is("deleted_at", null);
  const clients = [...new Map(((cc.data ?? []) as unknown as { client_id: string; full_name: string | null; clients: { id: string; name: string; deleted_at: string | null } }[]).filter((x) => !x.clients.deleted_at).map((x) => [x.client_id, x])).values()];
  if (clients.length !== 1) return { opened: false, why: clients.length ? "The sender is a contact of more than one client." : "The sender is not a recorded client contact." };
  const client = clients[0]!;
  const text = `${o.message.subject}\n${o.message.body_text ?? ""}`;
  const p = await db.from("policies").select("id, policy_number, class_of_business, insurer_id, insurers(name)").eq("organization_id", o.organizationId).eq("client_id", client.client_id).is("deleted_at", null);
  const policies = (p.data ?? []) as unknown as Policy[];
  const named = policies.filter((x) => x.policy_number && compact(x.policy_number).length >= 5 && compact(text).includes(compact(x.policy_number)));
  const policy = named.length === 1 ? named[0]! : named.length === 0 && policies.length === 1 ? policies[0]! : null;
  const body = (o.message.body_text ?? o.message.subject).trim().slice(0, 2000);

  let args: Record<string, unknown>;
  if (o.kind === "claim_notice") {
    const incidentOn = incidentDateFrom(text, o.message.sent_at);
    if (!incidentOn) return { opened: false, why: "The email does not say when the incident happened." };
    const steps = claimSteps({ clientName: client.clients.name, insurerName: policy?.insurers?.name ?? null });
    const t = deriveTask(steps);
    // The same title as a person's report, so the same claim reported twice is one claim.
    const title = policy ? `${client.clients.name} — claim, ${policy.class_of_business}${policy.policy_number ? ` ${policy.policy_number}` : ""}, incident ${incidentOn}` : `${client.clients.name} — claim, incident ${incidentOn}`;
    args = { p_kind: "claim", p_title: title, p_policy_id: policy?.id ?? null, p_insurer_id: policy?.insurer_id ?? null, p_class_of_business: policy?.class_of_business ?? null, p_steps: steps, p_task_status: t.status, p_task_party: t.party, p_incident_on: incidentOn, p_endorsement_kind: null };
  } else {
    if (!policy) return { opened: false, why: policies.length ? "The email does not say which policy to change." : "The client has no policy on file." };
    const steps = endorsementSteps({ insurerName: policy.insurers?.name ?? "the insurer" });
    const t = deriveTask(steps);
    const title = `${client.clients.name} — policy change, ${policy.class_of_business}${policy.policy_number ? ` ${policy.policy_number}` : ""}`;
    args = { p_kind: "endorsement", p_title: title, p_policy_id: policy.id, p_insurer_id: policy.insurer_id, p_class_of_business: policy.class_of_business, p_steps: steps, p_task_status: t.status, p_task_party: t.party, p_incident_on: null, p_endorsement_kind: classifyEndorsementRequest(body) };
  }
  const r = await db.rpc("inbound_open_draft", { p_email_message_id: o.message.id, p_client_id: client.client_id, p_text: body, p_requested_by_name: client.full_name ?? client.clients.name, ...args });
  if (r.error) {
    logger.warn({ code: r.error.code }, "a draft could not be opened from an email");
    return { opened: false, why: "ASAP could not open it." };
  }
  return { opened: true, workItemId: (r.data as { workItemId: string }).workItemId };
}
