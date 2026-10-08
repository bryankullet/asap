import { createHash } from "node:crypto";
import { auditAutomation, type StepContext } from "./engine.js";
import { connectedMailbox, type MailboxDeps } from "./deliver.js";
import { sendThroughMailbox } from "../mailbox/send.js";
import { autonomyRule, automatic } from "./renewal.js";

/**
 * Routine insurer chasers under a person's standing approval (D-147). Off unless the brokerage sets
 * `insurer_chasers` to act within rules. A chaser is sent only when every condition in D-147 holds;
 * the caller falls back to asking a person whenever this returns `sent: false`.
 */
let engineMailbox: MailboxDeps;
/** The mailbox adapters the engine may send through, set once by the app (same as the routes'). */
export function configureEngineMailbox(m: MailboxDeps) {
  engineMailbox = m;
}

export type ChaserFacts = { insurer: string; client: string; subject: string; sentOn: string; followUp: number };
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Fills the approved wording from the run's own facts only; any other placeholder refuses the render. */
export function renderChaser(template: string, f: ChaserFacts): string | null {
  const values: Record<"insurer" | "client" | "subject" | "sent_on" | "follow_up", string> = { insurer: f.insurer, client: f.client, subject: f.subject, sent_on: f.sentOn, follow_up: String(f.followUp) };
  const out = template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in values ? values[k as keyof typeof values] : m));
  return /\{\{/.test(out) ? null : out;
}

export async function sendStandingChaser(ctx: StepContext, purpose: "quote_chase" | "placement_chase" | "issuance_chase", f: ChaserFacts): Promise<{ sent: true; to: string } | { sent: false; why: string }> {
  const org = ctx.run.organization_id;
  const rule = await autonomyRule(ctx.db, org);
  if (!automatic(rule.actions.insurer_chasers)) return { sent: false, why: "Routine chasers are not switched on." };
  const t = await ctx.db.from("chaser_templates").select("id, version, subject_template, body_template, min_days_between, sha256, approved_by").eq("organization_id", org).eq("purpose", purpose).is("retired_at", null).maybeSingle();
  const tpl = t.data as { id: string; version: number; subject_template: string; body_template: string; min_days_between: number; sha256: string; approved_by: string } | null;
  if (!tpl) return { sent: false, why: "No chaser wording is approved." };
  const box = await connectedMailbox(ctx.db, ctx.db, engineMailbox, org);
  if (!box) return { sent: false, why: "No mailbox is connected." };
  const c = await ctx.db.from("insurer_contacts").select("email, insurers!inner(name)").eq("organization_id", org).eq("insurers.name", f.insurer).is("retired_at", null).order("verified_at").limit(1);
  const to = ((c.data ?? []) as { email: string }[])[0]?.email;
  if (!to) return { sent: false, why: `No verified address for ${f.insurer} is on file.` };
  const last = await ctx.db.from("chaser_sends").select("sent_at").eq("run_id", ctx.run.id).eq("party", f.insurer).order("sent_at", { ascending: false }).limit(1);
  const lastAt = ((last.data ?? []) as { sent_at: string }[])[0]?.sent_at;
  if (lastAt && ctx.now.getTime() - new Date(lastAt).getTime() < tpl.min_days_between * 86_400_000) return { sent: false, why: `The approved wording allows one chaser every ${tpl.min_days_between} days.` };
  const subject = renderChaser(tpl.subject_template, f);
  const body = renderChaser(tpl.body_template, f);
  if (!subject || !body) return { sent: false, why: "The approved wording could not be filled from this work's facts." };
  const res = await sendThroughMailbox({
    db: ctx.db, logger: ctx.logger, c: null, organizationId: org, approverId: tpl.approved_by,
    mailbox: { id: box.id, provider: box.provider, credentials: box.credentials },
    message: { to: [to], cc: [], subject, bodyText: body, replyToProviderThreadId: null, idempotencyKey: `chaser:${ctx.run.id}:${f.insurer}:${f.followUp}:${tpl.sha256}` },
    workItemId: ctx.run.work_item_id, draftId: null,
  });
  const attempt = res.state === "already_attempted" ? { id: res.attemptId, outcome: res.outcome } : { id: res.attemptId, outcome: res.state };
  if (attempt.outcome !== "sent") return { sent: false, why: "The mailbox did not send it." };
  await ctx.db.from("chaser_sends").upsert({ organization_id: org, template_id: tpl.id, run_id: ctx.run.id, party: f.insurer, follow_up: f.followUp, to_address: to, body_sha256: sha256(`${tpl.sha256}\n${subject}\n\n${body}`), send_attempt_id: attempt.id }, { onConflict: "run_id,party,follow_up", ignoreDuplicates: true });
  await auditAutomation(ctx.db, ctx.run, "email.chaser_sent", { templateId: tpl.id, templateVersion: tpl.version, insurer: f.insurer, followUp: f.followUp, attemptId: attempt.id, approvedBy: tpl.approved_by });
  return { sent: true, to };
}
