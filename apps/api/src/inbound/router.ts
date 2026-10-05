import { inboundAutoRouteRuleSchema, INBOUND_KIND_LABELS, type AiProvider } from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { emitEvent } from "../events/emit.js";
import { ruleOr } from "../workflows/rules.js";
import { classifyEmail, tieBreak } from "./classify.js";
import { openDraftFromEmail } from "./drafts.js";
import { readInsurerReply } from "./read-quote.js";
import { decideRoute, matchCandidates, type RunSnapshot } from "./match.js";

/**
 * The inbound router (D-144): on `email.received`, propose what the email is, find the runs that
 * could be waiting for it, and route it only when exactly one fits and the model's confidence
 * clears `inbound.auto_route_confidence`. Otherwise one Unsorted Work item for a person. Once per
 * message: a second delivery of the same event finds the proposal already written.
 *
 * Routing files the email to the run and wakes it; the run says what arrived and a person records
 * what it means (a quote, a confirmation) through the usual path. Routing never records a fact.
 */
export const AUTO_ROUTE_DEFAULT = { threshold: 0.9 };
export const AUTO_ROUTE_BASIS = "ASAP's default — route by itself at 90% confidence or more — because this brokerage has not set an auto-routing rule.";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const emailsIn = (...texts: (string | null | undefined)[]) => [...new Set(texts.flatMap((t) => (t ?? "").match(EMAIL) ?? []).map((a) => a.toLowerCase()))];
/** PostgREST returns a one-to-one embed as an object and a one-to-many as an array. */
const many = <T>(x: T | T[] | null | undefined): T[] => (Array.isArray(x) ? x : x ? [x] : []);
const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x && x.trim())))];

type Run = { id: string; workflow: string; subject_id: string; current_step: string | null; work_item_id: string | null };

async function clientOf(db: SupabaseClient, clientId: string | null | undefined): Promise<{ name: string | null; addresses: string[] }> {
  if (!clientId) return { name: null, addresses: [] };
  const [c, cc] = await Promise.all([
    db.from("clients").select("name").eq("id", clientId).maybeSingle(),
    db.from("client_contacts").select("email").eq("client_id", clientId).is("deleted_at", null),
  ]);
  return { name: (c.data as { name: string } | null)?.name ?? null, addresses: emailsIn(...((cc.data ?? []) as { email: string | null }[]).map((x) => x.email)) };
}

/** Verified addresses for an insurer (D-145), when a person has recorded them. */
async function insurerAddresses(db: SupabaseClient, insurerName: string | null): Promise<string[]> {
  if (!insurerName) return [];
  const r = await db.from("insurer_contacts").select("email, insurers!inner(name)").eq("insurers.name", insurerName).is("retired_at", null);
  return r.error ? [] : emailsIn(...((r.data ?? []) as { email: string }[]).map((x) => x.email));
}

async function preparedOf(db: SupabaseClient, runId: string) {
  const p = await db.from("prepared_communications").select("audience, party_name, to_address, subject, delivery_reference").eq("run_id", runId).neq("state", "superseded");
  return (p.data ?? []) as { audience: string; party_name: string; to_address: string | null; subject: string; delivery_reference: string | null }[];
}

/** Every live run in the brokerage, as the matcher sees it. One snapshot per party a run waits on. */
export async function liveRunSnapshots(db: SupabaseClient, organizationId: string): Promise<RunSnapshot[]> {
  const r = await db.from("workflow_runs").select("id, workflow, subject_id, current_step, work_item_id").eq("organization_id", organizationId).not("state", "in", "(done,cancelled)");
  const out: RunSnapshot[] = [];
  for (const run of (r.data ?? []) as Run[]) {
    const base = { runId: run.id, workflow: run.workflow, step: run.current_step, workItemId: run.work_item_id };
    const prepared = await preparedOf(db, run.id);
    const insurerMsgs = prepared.filter((p) => p.audience === "insurer");
    const sentTo = (party: string | null) => insurerMsgs.filter((p) => !party || p.party_name === party).flatMap((p) => [p.to_address, p.delivery_reference]);
    if (run.workflow === "quotation") {
      const o = await db.from("opportunities").select("client_id").eq("id", run.subject_id).maybeSingle();
      const client = await clientOf(db, (o.data as { client_id: string } | null)?.client_id);
      const oi = await db.from("opportunity_insurers").select("insurers(name), quote_requests(subject, quote_request_deliveries(reference))").eq("opportunity_id", run.subject_id).is("removed_at", null);
      for (const x of (oi.data ?? []) as unknown as { insurers: { name: string } | null; quote_requests: unknown }[]) {
        const name = x.insurers?.name ?? null;
        const qr = many(x.quote_requests as { subject: string; quote_request_deliveries: unknown } | null).map((q) => ({ subject: q.subject, refs: many(q.quote_request_deliveries as { reference: string | null } | null).map((d) => d.reference) }));
        out.push({ ...base, party: name, clientName: client.name, clientAddresses: client.addresses, references: [],
          subjects: uniq([...qr.map((q) => q.subject), ...insurerMsgs.filter((p) => p.party_name === name).map((p) => p.subject)]),
          partyAddresses: [...emailsIn(...qr.flatMap((q) => q.refs), ...sentTo(name)), ...(await insurerAddresses(db, name))] });
      }
    } else if (run.workflow === "placement" || run.workflow === "issuance") {
      const p = await db.from("placements").select("client_id, insurers(name)").eq("id", run.subject_id).maybeSingle();
      const row = p.data as unknown as { client_id: string; insurers: { name: string } | null } | null;
      const client = await clientOf(db, row?.client_id);
      const [req, sub, resp, ir, isub] = await Promise.all([
        db.from("placement_requests").select("id, subject").eq("placement_id", run.subject_id),
        db.from("placement_submissions").select("recipient, placement_requests!inner(placement_id)").eq("placement_requests.placement_id", run.subject_id),
        db.from("placement_insurer_responses").select("insurer_reference").eq("placement_id", run.subject_id),
        db.from("issuance_requests").select("payload").eq("placement_id", run.subject_id),
        db.from("issuance_submissions").select("recipient, issuance_requests!inner(placement_id)").eq("issuance_requests.placement_id", run.subject_id),
      ]);
      const placementSubjects = ((req.data ?? []) as { subject: string }[]).map((x) => x.subject);
      const issuanceSubjects = ((ir.data ?? []) as { payload: { subject?: string } | null }[]).map((x) => x.payload?.subject ?? null);
      const name = row?.insurers?.name ?? null;
      out.push({ ...base, party: name, clientName: client.name, clientAddresses: client.addresses,
        references: uniq(((resp.data ?? []) as { insurer_reference: string | null }[]).map((x) => x.insurer_reference)),
        subjects: uniq(run.workflow === "placement" ? placementSubjects : [...issuanceSubjects, ...placementSubjects]),
        partyAddresses: [...emailsIn(...((sub.data ?? []) as { recipient: string | null }[]).map((x) => x.recipient), ...((isub.data ?? []) as { recipient: string | null }[]).map((x) => x.recipient)), ...(await insurerAddresses(db, name))] });
    } else if (run.workflow === "claim" || run.workflow === "endorsement" || run.workflow === "renewal") {
      const q = run.workflow === "claim"
        ? await db.from("claims").select("client_id, insurer_reference, policies(policy_number, insurers(name))").eq("id", run.subject_id).maybeSingle()
        : run.workflow === "endorsement"
          ? await db.from("endorsements").select("response_reference, policies(policy_number, client_id, insurers(name))").eq("id", run.subject_id).maybeSingle()
          : await db.from("policy_periods").select("policies(policy_number, client_id, insurers(name))").eq("id", run.subject_id).maybeSingle();
      const row = q.data as unknown as { client_id?: string; insurer_reference?: string | null; response_reference?: string | null; policies: { policy_number: string | null; client_id?: string; insurers: { name: string } | null } | null } | null;
      const client = await clientOf(db, row?.client_id ?? row?.policies?.client_id);
      const name = insurerMsgs[0]?.party_name ?? row?.policies?.insurers?.name ?? null;
      out.push({ ...base, party: name, clientName: client.name, clientAddresses: client.addresses,
        references: uniq([row?.insurer_reference, row?.response_reference, row?.policies?.policy_number]), subjects: uniq(prepared.map((p) => p.subject)),
        partyAddresses: [...emailsIn(...sentTo(null)), ...(await insurerAddresses(db, name))] });
    }
  }
  return out;
}

export async function routeInbound(db: SupabaseClient, provider: AiProvider | null, logger: Logger, organizationId: string, emailMessageId: string): Promise<{ outcome: "routed" | "unsorted" | "already" | "opened"; runId?: string }> {
  const existing = await db.from("inbound_classifications").select("state").eq("email_message_id", emailMessageId).maybeSingle();
  if (existing.data) return { outcome: "already" };
  const m = await db.from("email_messages").select("id, from_address, subject, body_text, sent_at, email_threads(work_item_id)").eq("id", emailMessageId).eq("organization_id", organizationId).maybeSingle();
  const msg = m.data as unknown as { id: string; from_address: string; subject: string; body_text: string | null; sent_at: string; email_threads: { work_item_id: string | null } | null } | null;
  if (!msg) return { outcome: "already" };
  const email = { from: msg.from_address, subject: msg.subject, body: msg.body_text ?? "", threadWorkItemId: msg.email_threads?.work_item_id ?? null };

  const classification = await classifyEmail(provider, logger, email);
  const candidates = matchCandidates(email, classification?.kind ?? null, await liveRunSnapshots(db, organizationId));
  const tie = classification && candidates.length > 1 ? await tieBreak(provider, logger, email, candidates) : null;
  const rule = await ruleOr(db, organizationId, "inbound.auto_route_confidence", inboundAutoRouteRuleSchema, AUTO_ROUTE_DEFAULT, AUTO_ROUTE_BASIS);
  const decision = decideRoute({ source: classification ? "model" : "none", confidence: classification?.confidence ?? null, threshold: rule.threshold, candidates, tieBreak: tie });

  const row = {
    organization_id: organizationId, email_message_id: msg.id, kind: classification?.kind ?? null, confidence: classification?.confidence ?? null,
    source: classification ? "model" : "none", model: classification?.model ?? null, reason: classification?.reason ?? null,
    candidates, tie_break_run_id: tie?.runId ?? null,
  };

  if (decision.route) {
    const ins = await db.from("inbound_classifications").insert({ ...row, state: "routed", routed_run_id: decision.route, routed_by: "auto" }).select("id").maybeSingle();
    if (ins.error) {
      if (ins.error.code === "23505") return { outcome: "already" };
      throw new Error(`inbound classification not written: ${ins.error.message}`);
    }
    await fileToRun(db, logger, { organizationId, runId: decision.route, message: msg, kind: classification!.kind, party: candidates.find((c) => c.runId === decision.route)?.party ?? null, why: decision.why, by: "auto" });
    return { outcome: "routed", runId: decision.route };
  }

  // A claim notice or a change request, sure enough, from a client's own contact: open a draft (D-151).
  const opensDraft = classification && (classification.kind === "claim_notice" || classification.kind === "endorsement_request") && classification.confidence >= rule.threshold;
  const ins = await db.from("inbound_classifications").insert({ ...row, state: opensDraft ? "proposed" : "unsorted" }).select("id").maybeSingle();
  if (ins.error) {
    if (ins.error.code === "23505") return { outcome: "already" };
    throw new Error(`inbound classification not written: ${ins.error.message}`);
  }
  let draftWhy = "";
  if (opensDraft) {
    const d = await openDraftFromEmail(db, logger, { organizationId, message: { id: msg.id, from_address: msg.from_address, subject: msg.subject, body_text: msg.body_text, sent_at: msg.sent_at }, kind: classification!.kind as "claim_notice" | "endorsement_request" });
    if (d.opened) return { outcome: "opened", runId: d.workItemId };
    draftWhy = ` ASAP did not open it: ${d.why.charAt(0).toLowerCase()}${d.why.slice(1)}`;
    await db.from("inbound_classifications").update({ state: "unsorted" }).eq("id", (ins.data as { id: string }).id);
  }
  const proposal = classification
    ? `ASAP thinks this is: ${INBOUND_KIND_LABELS[classification.kind].toLowerCase()} (${Math.round(classification.confidence * 100)}% sure).`
    : provider ? "ASAP could not tell what this email is." : "No model is connected, so ASAP has not proposed what this is.";
  const options = candidates.length ? ` It could belong to: ${candidates.slice(0, 3).map((c) => `${c.workflow} work with ${c.party ?? "an outside party"}`).join("; ")}.` : "";
  const next = classification?.kind === "claim_notice" ? "Open the claim if it is one" : classification?.kind === "endorsement_request" ? "Open the endorsement if it is one" : classification?.kind === "new_enquiry" ? "Open the quotation if it is one" : `Sort the email from ${msg.from_address}`;
  const w = await db.from("work_items").insert({
    organization_id: organizationId, title: `Unsorted email — ${msg.subject || "(no subject)"}`.slice(0, 200), kind: "inbound",
    task_status: "needs_you", steps: [], source_type: "email_message", source_id: msg.id, reason_code: "unsorted_email",
    required_action: next, reason: `${proposal}${options} ${decision.why}${draftWhy}`.trim(),
  }).select("id").maybeSingle();
  if (w.data) await db.from("inbound_classifications").update({ work_item_id: (w.data as { id: string }).id }).eq("id", (ins.data as { id: string }).id);
  await db.from("audit_log").insert({ organization_id: organizationId, actor_type: "automation", action: "email.unsorted", object_type: "email_message", object_id: msg.id, new_state: { kind: row.kind, confidence: row.confidence, candidates: candidates.length, why: decision.why } });
  return { outcome: "unsorted" };
}

/** Files an email to a run, records it on the run, and wakes it. Shared by ASAP's routing and a person's. */
export async function fileToRun(db: SupabaseClient, logger: Logger | null, o: { organizationId: string; runId: string; message: { id: string; from_address: string; subject: string; sent_at: string }; kind: string | null; party: string | null; why: string; by: "auto" | "person"; userId?: string }) {
  const r = await db.from("workflow_runs").select("facts, work_item_id, current_step").eq("id", o.runId).maybeSingle();
  const run = r.data as { facts: Record<string, unknown>; work_item_id: string | null; current_step: string | null } | null;
  if (!run) return;
  const inbound = ((run.facts["inbound"] as { messageId: string }[] | undefined) ?? []).filter((x) => x.messageId !== o.message.id);
  // Filed against the step the run is on: once that step moves on, the email has been dealt with.
  inbound.push({ messageId: o.message.id, from: o.message.from_address, subject: o.message.subject, at: o.message.sent_at, kind: o.kind, party: o.party, step: run.current_step, by: o.by, acknowledged: false } as { messageId: string });
  await db.from("workflow_runs").update({ facts: { ...run.facts, inbound }, next_run_at: new Date().toISOString() }).eq("id", o.runId);
  if (run.work_item_id) {
    const t = await db.from("email_messages").select("thread_id").eq("id", o.message.id).maybeSingle();
    const threadId = (t.data as { thread_id: string } | null)?.thread_id;
    if (threadId) await db.from("email_threads").update({ work_item_id: run.work_item_id }).eq("id", threadId).is("work_item_id", null);
  }
  await proposeResponse(db, { organizationId: o.organizationId, runId: o.runId, message: o.message, kind: o.kind, party: o.party });
  await db.from("audit_log").insert({ organization_id: o.organizationId, actor_type: o.by === "auto" ? "automation" : "user", actor_user_id: o.userId ?? null, action: "email.routed", object_type: "email_message", object_id: o.message.id, new_state: { runId: o.runId, kind: o.kind, by: o.by, why: o.why } });
  await emitEvent(db, logger, { organizationId: o.organizationId, eventType: "workflow.email_routed", entityType: "workflow_run", entityId: o.runId, actor: o.by === "auto" ? "automation" : "user", actorUserId: o.userId ?? null, payload: { emailMessageId: o.message.id, kind: o.kind }, dedupeKey: `${o.runId}:${o.message.id}` });
}

/**
 * An insurer's quote or decline filed to a quotation becomes a proposed response (D-152): read from
 * the email's own words, never the model's, and kept until a person accepts or corrects it.
 */
async function proposeResponse(db: SupabaseClient, o: { organizationId: string; runId: string; message: { id: string; sent_at: string }; kind: string | null; party: string | null }) {
  if (!o.party || (o.kind !== "insurer_quote" && o.kind !== "insurer_decline")) return;
  const r = await db.from("workflow_runs").select("workflow, subject_id").eq("id", o.runId).maybeSingle();
  const run = r.data as { workflow: string; subject_id: string } | null;
  if (run?.workflow !== "quotation") return;
  const oi = await db.from("opportunity_insurers").select("id, insurers!inner(name)").eq("opportunity_id", run.subject_id).eq("insurers.name", o.party).is("removed_at", null).maybeSingle();
  const approach = oi.data as { id: string } | null;
  if (!approach) return;
  const m = await db.from("email_messages").select("subject, body_text").eq("id", o.message.id).maybeSingle();
  const text = `${(m.data as { subject: string } | null)?.subject ?? ""}\n${(m.data as { body_text: string | null } | null)?.body_text ?? ""}`;
  const read = readInsurerReply(text, o.message.sent_at, o.kind === "insurer_decline");
  if (!read) return;
  await db.from("insurer_response_proposals").upsert({
    organization_id: o.organizationId, opportunity_id: run.subject_id, opportunity_insurer_id: approach.id, email_message_id: o.message.id,
    outcome: read.outcome, premium_amount: read.premiumAmount, premium_currency: read.premiumCurrency, valid_until: read.validUntil,
    decline_reason: read.declineReason, evidence: read.evidence, method: "email-text-patterns",
  }, { onConflict: "opportunity_insurer_id,email_message_id", ignoreDuplicates: true });
}
