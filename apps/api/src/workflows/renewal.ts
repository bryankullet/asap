import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { AUTONOMY_DEFAULT, AUTONOMY_LEVELS, autonomyRuleSchema, recommendationRuleSchema, type AutonomyLevel, type AutonomyRule } from "@asap/schema";
import { quoteRequestDigest } from "../routes/opportunities.js";
import { advanceRun, auditAutomation, sha256, startRun, type Evidence, type StepContext, type StepResult, type WorkflowDefinition } from "./engine.js";

/**
 * Renewal Autopilot (D-129): the first workflow on the execution foundation.
 *
 * ASAP detects a period nearing expiry, checks what is on file, reads the schedule, lists what is
 * missing, opens and assigns the Work, prepares the renewal pack and the two messages, and asks for
 * ONE approval. After approval it opens the insurer request as approved — not sent — watches for
 * delivery and terms, chases on the brokerage's schedule, prepares comparison evidence, and hands
 * the presentation to a person. Where it cannot go on, it raises a precise exception.
 *
 * Nothing here sends, binds cover, records a client instruction or moves money.
 */

export const RENEWAL_DEFAULTS = { leadDays: 60, followUpDays: 5, escalateDaysBeforeExpiry: 14 } as const;
export const RENEWAL_DEFAULT_BASIS =
  "ASAP's default — 60 days before expiry, chase after 5 days — because this brokerage has not set a renewal rule.";

type Window = { leadDays: number; followUpDays: number; escalateDaysBeforeExpiry: number; basis: string; configured: boolean };

export async function renewalWindow(db: SupabaseClient, organizationId: string): Promise<Window> {
  const { data } = await db.from("company_rules").select("value, source, verified_at").eq("organization_id", organizationId).eq("key", "renewal.window").maybeSingle();
  const row = data as { value: Partial<Window> | null; source: string; verified_at: string } | null;
  const v = row?.value ?? null;
  const ok = (n: unknown, lo: number, hi: number) => typeof n === "number" && Number.isInteger(n) && n >= lo && n <= hi;
  if (row && v && ok(v.leadDays, 7, 180) && ok(v.followUpDays, 1, 30)) {
    return {
      leadDays: v.leadDays as number,
      followUpDays: v.followUpDays as number,
      escalateDaysBeforeExpiry: ok(v.escalateDaysBeforeExpiry, 1, 60) ? (v.escalateDaysBeforeExpiry as number) : RENEWAL_DEFAULTS.escalateDaysBeforeExpiry,
      basis: `This brokerage's rule: ${row.source} (checked ${row.verified_at}).`,
      configured: true,
    };
  }
  return { ...RENEWAL_DEFAULTS, basis: RENEWAL_DEFAULT_BASIS, configured: false };
}

/**
 * The brokerage's autonomy rule (D-131), or ASAP's stated default. Read at the point of use, so a
 * changed rule applies to the next step without restarting anything.
 */
export async function autonomyRule(db: SupabaseClient, organizationId: string): Promise<AutonomyRule & { configured: boolean }> {
  const { data } = await db.from("company_rules").select("value").eq("organization_id", organizationId).eq("key", "workflow.autonomy").maybeSingle();
  const parsed = autonomyRuleSchema.safeParse((data as { value: unknown } | null)?.value);
  return parsed.success ? { ...parsed.data, configured: true } : { ...AUTONOMY_DEFAULT, configured: false };
}
/** True when the rule lets ASAP do this on its own (level 5 or 6). */
export const automatic = (level: AutonomyLevel) => AUTONOMY_LEVELS.indexOf(level) >= AUTONOMY_LEVELS.indexOf("act_within_rules");

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const human = (d: string | null | undefined) =>
  d ? new Date(d.length === 10 ? d + "T12:00:00Z" : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }) : "not recorded";
const money = (amount: string | number | null | undefined, currency: string | null | undefined) =>
  amount == null ? "not recorded" : `${currency ?? ""} ${Number(amount).toLocaleString("en-KE", { minimumFractionDigits: 0 })}`.trim();

type Subject = {
  period: { id: string; policy_id: string; period_start: string; period_end: string; premium_amount: string | null; premium_currency: string | null; premium_basis: string | null };
  policy: { id: string; client_id: string; insurer_id: string | null; class_of_business: string | null; policy_number: string | null };
  client: { id: string; name: string; file_status: string; file_owner_id: string | null } | null;
  insurer: { id: string; name: string } | null;
  contact: { full_name: string; email: string | null } | null;
};

async function loadSubject(db: SupabaseClient, periodId: string): Promise<Subject | null> {
  const p = await db.from("policy_periods").select("id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis").eq("id", periodId).maybeSingle();
  if (!p.data) return null;
  const period = p.data as Subject["period"];
  const pol = await db.from("policies").select("id, client_id, insurer_id, class_of_business, policy_number").eq("id", period.policy_id).is("deleted_at", null).maybeSingle();
  if (!pol.data) return null;
  const policy = pol.data as Subject["policy"];
  const [c, i, ct] = await Promise.all([
    db.from("clients").select("id, name, file_status, file_owner_id").eq("id", policy.client_id).is("deleted_at", null).maybeSingle(),
    policy.insurer_id ? db.from("insurers").select("id, name").eq("id", policy.insurer_id).is("deleted_at", null).maybeSingle() : Promise.resolve({ data: null }),
    db.from("client_contacts").select("full_name, email, is_primary").eq("client_id", policy.client_id).is("deleted_at", null).order("is_primary", { ascending: false }).limit(1),
  ]);
  const contact = ((ct.data ?? []) as { full_name: string; email: string | null }[])[0] ?? null;
  return { period, policy, client: (c.data as Subject["client"]) ?? null, insurer: (i.data as Subject["insurer"]) ?? null, contact };
}

async function updateWork(db: SupabaseClient, workItemId: string | null, patch: Record<string, unknown>) {
  if (!workItemId) return;
  const w = await db.from("work_items").select("version").eq("id", workItemId).maybeSingle();
  const version = (w.data as { version: number } | null)?.version ?? 1;
  await db.from("work_items").update({ ...patch, version: version + 1, updated_at: new Date().toISOString() }).eq("id", workItemId);
}

const subjectOf = async (ctx: StepContext) => {
  const s = await loadSubject(ctx.db, ctx.run.subject_id);
  if (!s) throw new Error("The policy period this renewal is about can no longer be read.");
  return s;
};

/* ------------------------------------------------------------------------------- the steps */

async function detect(ctx: StepContext): Promise<StepResult> {
  const s = await subjectOf(ctx);
  const window = await renewalWindow(ctx.db, ctx.run.organization_id);
  const daysLeft = Math.ceil((new Date(s.period.period_end + "T23:59:59Z").getTime() - ctx.now.getTime()) / DAY);
  if (daysLeft < 0)
    return { kind: "exception", code: "already_expired", message: `The period ended on ${human(s.period.period_end)} — before the renewal was prepared.`, needs: "Check with the client whether cover lapsed or was renewed elsewhere, and record what happened." };
  return {
    kind: "done",
    output: { periodEnd: s.period.period_end, daysLeft, leadDays: window.leadDays, followUpDays: window.followUpDays, windowBasis: window.basis },
    evidence: [
      { kind: "record", label: `Period ends ${human(s.period.period_end)} (${daysLeft} days)`, ref: `policy_period:${s.period.id}` },
      { kind: "rule", label: window.basis },
    ],
  };
}

async function completeness(ctx: StepContext): Promise<StepResult> {
  const s = await subjectOf(ctx);
  if (!s.client) return { kind: "exception", code: "no_client", message: "The policy is not attached to a client that can be read.", needs: "Attach the policy to its client." };
  if (!s.insurer)
    return { kind: "exception", code: "no_insurer", message: `The expiring policy for ${s.client.name}, ${s.policy.policy_number ?? ""} is with an insurer that is no longer on file, so ASAP cannot ask for renewal terms.`.replace(/ {2,}/g, " "), needs: "Restore the insurer, or record the insurer the policy is with; then resume the renewal." };
  const docs = await ctx.db.from("documents").select("id, kind, filename").eq("client_id", s.client.id).is("deleted_at", null);
  const documents = (docs.data ?? []) as { id: string; kind: string; filename: string }[];
  const schedule = documents.find((d) => d.kind === "policy_schedule") ?? null;
  const missing: string[] = [];
  const present: string[] = [];
  (s.policy.policy_number ? present : missing).push(s.policy.policy_number ? `Policy number ${s.policy.policy_number}` : "Policy number");
  (s.policy.class_of_business ? present : missing).push(s.policy.class_of_business ? `Class: ${s.policy.class_of_business}` : "Class of business");
  (s.period.premium_amount ? present : missing).push(s.period.premium_amount ? `Expiring premium ${money(s.period.premium_amount, s.period.premium_currency)}` : "Expiring premium");
  (s.contact?.email ? present : missing).push(s.contact?.email ? `Client contact ${s.contact.full_name}` : "A client contact with an email address");
  (schedule ? present : missing).push(schedule ? `Schedule on file: ${schedule.filename}` : "The expiring policy schedule");
  if (s.client.file_status !== "cleared") missing.push(`Client file is ${s.client.file_status.replaceAll("_", " ")} — it must be cleared before placement`);
  /*
   * Blocking: without it the bundle cannot safely be used, so ASAP stops before asking for an
   * approval (D-131). The insurer cannot identify the policy without its number, and the client
   * letter has nobody to go to without a contact. Everything else is disclosed and ASAP goes on.
   */
  const blocking = [
    ...(s.policy.policy_number ? [] : [{ label: "Policy number", fix: "Add the policy number to the policy record" }]),
    ...(s.contact?.email ? [] : [{ label: "A client contact with an email address", fix: `Add a contact with an email address to ${s.client.name}` }]),
  ];
  const nonBlocking = missing.filter((m) => !/^Policy number$|client contact/i.test(m));
  if (blocking.length)
    return {
      kind: "exception",
      code: "missing_information",
      message: `ASAP cannot prepare a usable renewal bundle for ${s.client.name} — ${blocking.map((b) => b.label.toLowerCase()).join(" and ")} ${blocking.length === 1 ? "is" : "are"} missing.`,
      needs: blocking.map((b) => b.fix).join("; ") + ". Then resume the renewal — it continues from this step.",
      output: { missing, present, blocking, nonBlocking, clientName: s.client.name, insurerName: s.insurer.name },
    };
  return {
    kind: "done",
    output: { missing, present, blocking: [], nonBlocking, scheduleDocumentId: schedule?.id ?? null, clientName: s.client.name, insurerName: s.insurer.name },
    evidence: [
      { kind: "record", label: `${present.length} items on file, ${missing.length} missing`, ref: `client:${s.client.id}` },
      ...(schedule ? [{ kind: "document" as const, label: schedule.filename, ref: `document:${schedule.id}` }] : []),
    ],
  };
}

async function readSchedule(ctx: StepContext): Promise<StepResult> {
  const s = await subjectOf(ctx);
  const docId = (ctx.done["completeness"]?.["scheduleDocumentId"] as string | null) ?? null;
  if (!docId) return { kind: "done", output: { read: false, findings: [], note: "No schedule on file to read." } };
  const f = await ctx.db.from("document_fields").select("field_key, proposed_value, corrected_value, state, page_number").eq("document_id", docId);
  const fields = (f.data ?? []) as { field_key: string; proposed_value: string | null; corrected_value: string | null; state: string; page_number: number | null }[];
  // Only values a person accepted count; proposed readings are listed as unconfirmed, never used.
  const confirmed = fields.filter((x) => x.state === "accepted" || x.state === "corrected").map((x) => ({ key: x.field_key, value: x.corrected_value ?? x.proposed_value, page: x.page_number }));
  const unconfirmed = fields.filter((x) => x.state === "proposed").map((x) => x.field_key);
  const findings: string[] = [];
  const pn = confirmed.find((x) => x.key === "policy_number")?.value;
  if (pn && s.policy.policy_number && pn.replace(/\s/g, "") !== s.policy.policy_number.replace(/\s/g, "")) findings.push(`The schedule says policy number ${pn}; the record says ${s.policy.policy_number}.`);
  const pe = confirmed.find((x) => x.key === "period_end")?.value;
  if (pe && pe.slice(0, 10) !== s.period.period_end) findings.push(`The schedule says cover ends ${human(pe)}; the record says ${human(s.period.period_end)}.`);
  return {
    kind: "done",
    output: { read: true, confirmed, unconfirmed, findings },
    evidence: confirmed.map((x) => ({ kind: "document" as const, label: `${x.key.replaceAll("_", " ")}: ${x.value}${x.page ? ` (page ${x.page})` : ""}`, ref: `document:${docId}` })),
  };
}

async function assignWork(ctx: StepContext): Promise<StepResult> {
  const s = await subjectOf(ctx);
  const missing = (ctx.done["completeness"]?.["missing"] as string[]) ?? [];
  const findings = (ctx.done["read_schedule"]?.["findings"] as string[]) ?? [];
  const rule = await autonomyRule(ctx.db, ctx.run.organization_id);
  let owner = rule.assignment === "client_file_owner" ? (s.client?.file_owner_id ?? null) : null;
  if (!owner && rule.assignment === "client_file_owner" && ctx.run.work_item_id) {
    const w = await ctx.db.from("work_items").select("owner_id").eq("id", ctx.run.work_item_id).maybeSingle();
    owner = (w.data as { owner_id: string | null } | null)?.owner_id ?? null;
  }
  await updateWork(ctx.db, ctx.run.work_item_id, {
    owner_id: owner,
    task_status: "in_progress",
    task_party: null,
    required_action: "ASAP is preparing the renewal pack and messages",
    evidence_needed: [...missing, ...findings].join("; ") || null,
    reason: `Renewal of ${s.policy.policy_number ?? "the policy"} — cover ends ${human(s.period.period_end)}.`,
    due_on: isoDay(new Date(new Date(s.period.period_end + "T12:00:00Z").getTime() - 14 * DAY)),
  });
  return {
    kind: "done",
    output: { ownerId: owner, assigned: owner !== null },
    evidence: [{ kind: "record", label: owner ? "Assigned to the client file's owner" : "No owner on the client file — Work shows it unassigned", ref: ctx.run.work_item_id ? `work_item:${ctx.run.work_item_id}` : null }],
  };
}

async function pack(ctx: StepContext): Promise<StepResult> {
  const s = await subjectOf(ctx);
  const c = ctx.done["completeness"] ?? {};
  const r = ctx.done["read_schedule"] ?? {};
  const body = {
    client: s.client?.name,
    policyNumber: s.policy.policy_number,
    classOfBusiness: s.policy.class_of_business,
    insurer: s.insurer?.name,
    expiringPeriod: { start: s.period.period_start, end: s.period.period_end },
    expiringPremium: s.period.premium_amount ? { amount: s.period.premium_amount, currency: s.period.premium_currency, basis: s.period.premium_basis } : null,
    onFile: c["present"] ?? [],
    missing: c["missing"] ?? [],
    scheduleFindings: r["findings"] ?? [],
    confirmedFromSchedule: r["confirmed"] ?? [],
  };
  return { kind: "done", output: { pack: body, packSha256: sha256(JSON.stringify(body)) }, evidence: [{ kind: "record", label: "Renewal pack prepared from the records and the confirmed schedule values" }] };
}

function clientMessage(s: Subject, missing: string[]) {
  const greeting = s.contact ? `Dear ${s.contact.full_name},` : `Dear ${s.client!.name},`;
  const asks = [
    "whether anything insured has changed — items or vehicles added or removed, sums insured, use or location;",
    "any losses or claims since the policy started;",
    ...missing.filter((m) => /schedule|contact/i.test(m) === false && !/client file/i.test(m)).map((m) => `${m.toLowerCase()};`),
  ];
  return {
    subject: `Renewal of your ${s.policy.class_of_business ?? "insurance"} policy ${s.policy.policy_number ?? ""}`.trim(),
    body: `${greeting}\n\nYour ${s.policy.class_of_business ?? ""} policy ${s.policy.policy_number ?? ""} with ${s.insurer!.name} ends on ${human(s.period.period_end)}. To obtain renewal terms in good time, please confirm:\n\n${asks.map((a) => "- " + a).join("\n")}\n\nWe will come back to you with the terms once the insurer has responded.\n\nKind regards`.replace(/ {2,}/g, " "),
  };
}

function insurerMessage(s: Subject) {
  return {
    subject: `Renewal terms request — ${s.client!.name}, ${s.policy.policy_number ?? s.policy.class_of_business ?? "policy"}`,
    body: `Dear Underwriter,\n\nPlease provide renewal terms for ${s.client!.name}'s ${s.policy.class_of_business ?? ""} policy ${s.policy.policy_number ?? "(number not recorded)"}, expiring ${human(s.period.period_end)}.\n\nExpiring premium: ${money(s.period.premium_amount, s.period.premium_currency)}${s.period.premium_basis ? ` (${s.period.premium_basis})` : ""}.\n\nPlease quote on the expiring basis and note any change in terms, excesses or conditions. We will confirm any change in exposure the client tells us about.\n\nKind regards`.replace(/ {2,}/g, " "),
  };
}

async function communications(ctx: StepContext): Promise<StepResult> {
  const s = await subjectOf(ctx);
  const missing = (ctx.done["completeness"]?.["missing"] as string[]) ?? [];
  const existing = await ctx.db.from("prepared_communications").select("id, audience").eq("run_id", ctx.run.id).neq("state", "superseded");
  const have = new Set(((existing.data ?? []) as { audience: string }[]).map((x) => x.audience));
  const rows: Record<string, unknown>[] = [];
  const cm = clientMessage(s, missing);
  if (!have.has("client"))
    rows.push({ organization_id: ctx.run.organization_id, run_id: ctx.run.id, audience: "client", party_name: s.contact?.full_name ?? s.client!.name, to_address: s.contact?.email ?? null, subject: cm.subject, body_text: cm.body, body_sha256: sha256(cm.subject + "\n\n" + cm.body) });
  const im = insurerMessage(s);
  if (!have.has("insurer"))
    // Insurers carry no verified address in ASAP: delivered by a person until one is recorded.
    rows.push({ organization_id: ctx.run.organization_id, run_id: ctx.run.id, audience: "insurer", party_name: s.insurer!.name, to_address: null, subject: im.subject, body_text: im.body, body_sha256: sha256(im.subject + "\n\n" + im.body) });
  if (rows.length) {
    const ins = await ctx.db.from("prepared_communications").insert(rows);
    if (ins.error) return { kind: "retry", error: ins.error.message };
  }
  return { kind: "done", output: { prepared: ["client", "insurer"] }, evidence: [{ kind: "communication", label: "Client renewal letter and insurer terms request prepared — not sent" }] };
}

async function approval(ctx: StepContext): Promise<StepResult> {
  const s = await subjectOf(ctx);
  const existing = await ctx.db.from("workflow_approvals").select("id, state, decided_by, note, bundle_sha256").eq("run_id", ctx.run.id).eq("step_key", "approval").order("created_at", { ascending: false }).limit(1);
  const a = ((existing.data ?? []) as { id: string; state: string; decided_by: string | null; note: string | null; bundle_sha256: string }[])[0];
  if (a?.state === "approved") {
    return { kind: "done", output: { approvalId: a.id, approvedBy: a.decided_by }, evidence: [{ kind: "approval", label: "Renewal bundle approved by a person", ref: `workflow_approval:${a.id}` }] };
  }
  if (a?.state === "rejected")
    return { kind: "exception", code: "bundle_rejected", message: `The renewal bundle was not approved${a.note ? `: ${a.note}` : ""}.`, needs: "Change what was wrong on the records, then restart the renewal from its Space." };
  if (!a) {
    const comms = await ctx.db.from("prepared_communications").select("id, audience, party_name, to_address, subject, body_text, body_sha256").eq("run_id", ctx.run.id).neq("state", "superseded").order("audience");
    const items = (comms.data ?? []) as { id: string; audience: string; party_name: string; to_address: string | null; subject: string; body_text: string; body_sha256: string }[];
    const packOut = ctx.done["pack"] ?? {};
    const bundle = [
      { kind: "pack", label: "Renewal pack", sha256: packOut["packSha256"], pack: packOut["pack"] },
      ...items.map((m) => ({ kind: "communication", communicationId: m.id, audience: m.audience, label: m.audience === "client" ? `Letter to ${m.party_name}` : `Terms request to ${m.party_name}`, to: m.to_address, deliveredBy: m.to_address ? "You, or the connected mailbox once one exists" : "You — no verified address is on file", subject: m.subject, body: m.body_text, sha256: m.body_sha256 })),
    ];
    const ins = await ctx.db
      .from("workflow_approvals")
      .insert({ organization_id: ctx.run.organization_id, run_id: ctx.run.id, step_key: "approval", title: `Approve the renewal for ${s.client!.name}`, bundle, bundle_sha256: sha256(JSON.stringify(bundle)) })
      .select("id")
      .maybeSingle();
    if (ins.error || !ins.data) return { kind: "retry", error: ins.error?.message ?? "approval not written" };
    const approvalId = (ins.data as { id: string }).id;
    await ctx.db.from("prepared_communications").update({ approval_id: approvalId }).eq("run_id", ctx.run.id).neq("state", "superseded");
    await updateWork(ctx.db, ctx.run.work_item_id, { task_status: "needs_you", task_party: null, required_action: `Review and approve the renewal bundle for ${s.client!.name} — the pack and both messages`, reason: "Nothing leaves the brokerage until a person approves its exact content." });
    await auditAutomation(ctx.db, ctx.run, "workflow.renewal.approval_requested", { approvalId, items: bundle.length });
  }
  return { kind: "wait", on: "approval", until: new Date(ctx.now.getTime() + DAY), output: { approvalId: a?.id ?? null } };
}

async function openTerms(ctx: StepContext): Promise<StepResult> {
  const s = await subjectOf(ctx);
  const approverId = ctx.done["approval"]?.["approvedBy"] as string;
  if (!ctx.run.work_item_id) return { kind: "exception", code: "no_work_item", message: "The renewal has no Work item to attach the insurer request to.", needs: "Reopen the renewal from its Space." };
  const im = await ctx.db.from("prepared_communications").select("id, subject, body_text, quote_request_id").eq("run_id", ctx.run.id).eq("audience", "insurer").neq("state", "superseded").maybeSingle();
  const insurerMsg = im.data as { id: string; subject: string; body_text: string; quote_request_id: string | null } | null;
  if (!insurerMsg) return { kind: "retry", error: "the prepared insurer request is missing" };

  // One renewal quotation per Work item (opportunities.work_item_id is unique): found, or made once.
  let opp = await ctx.db.from("opportunities").select("id").eq("work_item_id", ctx.run.work_item_id).maybeSingle();
  if (!opp.data) {
    const created = await ctx.db
      .from("opportunities")
      .insert({ organization_id: ctx.run.organization_id, client_id: s.client!.id, work_item_id: ctx.run.work_item_id, title: `Renewal — ${s.policy.policy_number ?? s.policy.class_of_business ?? "policy"}`, class_of_business: s.policy.class_of_business ?? "Renewal", owner_id: approverId, created_by: approverId })
      .select("id")
      .maybeSingle();
    opp = created.data ? created : await ctx.db.from("opportunities").select("id").eq("work_item_id", ctx.run.work_item_id).maybeSingle();
  }
  const opportunityId = (opp.data as { id: string } | null)?.id;
  if (!opportunityId) return { kind: "retry", error: "the renewal quotation could not be opened" };

  let oi = await ctx.db.from("opportunity_insurers").select("id").eq("opportunity_id", opportunityId).eq("insurer_id", s.insurer!.id).is("removed_at", null).maybeSingle();
  if (!oi.data) {
    await ctx.db.from("opportunity_insurers").insert({ organization_id: ctx.run.organization_id, opportunity_id: opportunityId, insurer_id: s.insurer!.id, added_by: approverId });
    oi = await ctx.db.from("opportunity_insurers").select("id").eq("opportunity_id", opportunityId).eq("insurer_id", s.insurer!.id).is("removed_at", null).maybeSingle();
  }
  const opportunityInsurerId = (oi.data as { id: string } | null)?.id;
  if (!opportunityInsurerId) return { kind: "retry", error: "the expiring insurer could not be added" };

  let quoteRequestId = insurerMsg.quote_request_id;
  if (!quoteRequestId) {
    const existingQr = await ctx.db.from("quote_requests").select("id").eq("opportunity_insurer_id", opportunityInsurerId).maybeSingle();
    quoteRequestId = (existingQr.data as { id: string } | null)?.id ?? null;
    if (!quoteRequestId) {
      const qr = await ctx.db.from("quote_requests").insert({ organization_id: ctx.run.organization_id, opportunity_id: opportunityId, opportunity_insurer_id: opportunityInsurerId, subject: insurerMsg.subject, body_text: insurerMsg.body_text, prepared_by: approverId }).select("id").maybeSingle();
      quoteRequestId = (qr.data as { id: string } | null)?.id ?? null;
      if (!quoteRequestId) return { kind: "retry", error: qr.error?.message ?? "the insurer request could not be recorded" };
    }
    // The person approved this exact text in the bundle; the request carries that approval.
    const at = new Date().toISOString();
    const digest = quoteRequestDigest(insurerMsg.subject, insurerMsg.body_text);
    await ctx.db.from("quote_requests").update({ approved_by: approverId, approved_at: at, approved_body_sha256: digest, updated_at: at }).eq("id", quoteRequestId).is("approved_at", null);
    await ctx.db.from("quote_request_approvals").insert({ organization_id: ctx.run.organization_id, quote_request_id: quoteRequestId, body_sha256: digest, approved_by: approverId, approved_at: at });
    await ctx.db.from("prepared_communications").update({ quote_request_id: quoteRequestId, updated_at: at }).eq("id", insurerMsg.id);
  }
  return {
    kind: "done",
    output: { opportunityId, opportunityInsurerId, quoteRequestId },
    evidence: [{ kind: "record", label: `Terms request to ${s.insurer!.name} recorded as approved — not sent`, ref: `quote_request:${quoteRequestId}` }],
  };
}

async function awaitTerms(ctx: StepContext): Promise<StepResult> {
  const s = await subjectOf(ctx);
  const o = ctx.done["open_terms"] ?? {};
  const window = await renewalWindow(ctx.db, ctx.run.organization_id);
  const daysLeft = Math.ceil((new Date(s.period.period_end + "T23:59:59Z").getTime() - ctx.now.getTime()) / DAY);
  const [resp, del] = await Promise.all([
    ctx.db.from("insurer_responses").select("id, outcome, premium_amount, premium_currency, valid_until, decline_reason, received_at").eq("opportunity_id", o["opportunityId"] as string),
    ctx.db.from("quote_request_deliveries").select("delivered_at, method, reference").eq("quote_request_id", o["quoteRequestId"] as string).maybeSingle(),
  ]);
  const responses = (resp.data ?? []) as { id: string; outcome: string }[];
  if (responses.length) return { kind: "done", output: { responses: responses.length }, evidence: [{ kind: "response", label: `${responses.length} insurer response recorded` }] };

  const delivery = del.data as { delivered_at: string; method: string; reference: string } | null;
  const followUps = Number(ctx.step.output["followUps"] ?? 0);
  const rule = await autonomyRule(ctx.db, ctx.run.organization_id);
  if (daysLeft <= window.escalateDaysBeforeExpiry && automatic(rule.actions.escalate))
    return {
      kind: "exception",
      code: "no_terms_near_expiry",
      message: `No renewal terms from ${s.insurer!.name} with ${Math.max(daysLeft, 0)} days to expiry${delivery ? ` (request delivered ${human(delivery.delivered_at)}, ${followUps} follow-ups)` : " — the approved request has not been delivered"}.`,
      needs: `Call the underwriter at ${s.insurer!.name} today, or approach another insurer, and tell ${s.client!.name} where things stand.`,
      output: { followUps },
    };
  if (!delivery) {
    await updateWork(ctx.db, ctx.run.work_item_id, { task_status: "needs_you", task_party: null, required_action: `Deliver the approved renewal request to ${s.insurer!.name} and record how`, reason: "The request is approved but nothing has been sent — ASAP has no mailbox connected.", task_next_check: new Date(ctx.now.getTime() + DAY).toISOString() });
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + DAY), output: { followUps, delivered: false } };
  }
  const scheduled = new Date(new Date(delivery.delivered_at).getTime() + (followUps + 1) * window.followUpDays * DAY);
  // A person may move the next follow-up ("move it to Friday") or stop chasing this insurer.
  const override = typeof ctx.run.facts["followUpOn"] === "string" ? new Date(String(ctx.run.facts["followUpOn"]) + "T06:00:00Z") : null;
  const nextDue = override ?? scheduled;
  const escalation = new Date(new Date(s.period.period_end + "T06:00:00Z").getTime() - window.escalateDaysBeforeExpiry * DAY);
  const stopped = ctx.run.facts["chasing"] as { stopped?: boolean; byName?: string } | undefined;
  // Chasing stopped by a person, or the brokerage's rule keeps follow-ups with people.
  if (stopped?.stopped || !automatic(rule.actions.follow_up)) {
    const why = stopped?.stopped ? `${stopped.byName ?? "A person"} stopped the follow-ups.` : "This brokerage's autonomy rule keeps insurer follow-ups with people.";
    await updateWork(ctx.db, ctx.run.work_item_id, { task_status: "with_party", task_party: s.insurer!.name, task_since: delivery.delivered_at, required_action: `ASAP is not chasing ${s.insurer!.name} — ${automatic(rule.actions.escalate) ? `it escalates on ${human(escalation.toISOString())} if no terms arrive` : "follow up when you decide"}`, reason: why, task_next_check: escalation.toISOString() });
    return { kind: "wait", on: "party", until: escalation, output: { followUps, delivered: true, chasingStopped: true } };
  }
  if (ctx.now >= nextDue) {
    const n = followUps + 1;
    await updateWork(ctx.db, ctx.run.work_item_id, { task_status: "needs_you", task_party: null, required_action: `Chase ${s.insurer!.name} for ${s.client!.name}'s renewal terms (follow-up ${n})`, reason: `Requested ${human(delivery.delivered_at)}; no terms after ${n * window.followUpDays} days. Cover ends ${human(s.period.period_end)}.`, task_next_check: new Date(ctx.now.getTime() + window.followUpDays * DAY).toISOString() });
    await auditAutomation(ctx.db, ctx.run, "workflow.renewal.follow_up", { insurer: s.insurer!.name, followUp: n, daysLeft });
    // A moved follow-up is used once; the schedule resumes from here.
    if (override) await ctx.db.from("workflow_runs").update({ facts: { ...ctx.run.facts, followUpOn: null } }).eq("id", ctx.run.id);
    return { kind: "wait", on: "party", until: new Date(ctx.now.getTime() + window.followUpDays * DAY), output: { followUps: n, delivered: true, lastFollowUp: ctx.now.toISOString() } };
  }
  // After a chase, the chase stays the next action until terms arrive or the next chase is due.
  if (followUps === 0) await updateWork(ctx.db, ctx.run.work_item_id, { task_status: "with_party", task_party: s.insurer!.name, task_since: delivery.delivered_at, required_action: `Wait for ${s.insurer!.name}'s renewal terms — chase on ${human(nextDue.toISOString())}`, reason: `Request delivered ${human(delivery.delivered_at)} by ${delivery.method.replaceAll("_", " ")}.`, task_next_check: nextDue.toISOString() });
  return { kind: "wait", on: "party", until: nextDue, output: { followUps, delivered: true } };
}

async function compare(ctx: StepContext): Promise<StepResult> {
  const s = await subjectOf(ctx);
  const o = ctx.done["open_terms"] ?? {};
  const resp = await ctx.db.from("insurer_responses").select("id, opportunity_insurer_id, outcome, premium_amount, premium_currency, valid_until, decline_reason").eq("opportunity_id", o["opportunityId"] as string);
  const responses = (resp.data ?? []) as { id: string; opportunity_insurer_id: string; outcome: string; premium_amount: string | null; premium_currency: string | null; valid_until: string | null; decline_reason: string | null }[];
  const quoted = responses.filter((r) => r.outcome === "quoted" && r.premium_amount);
  if (!quoted.length)
    return { kind: "exception", code: "all_declined", message: `${s.insurer!.name} did not offer renewal terms${responses[0]?.decline_reason ? `: ${responses[0].decline_reason}` : ""}.`, needs: `Approach another insurer for ${s.client!.name} before ${human(s.period.period_end)}.` };
  const expiring = s.period.premium_amount ? Number(s.period.premium_amount) : null;
  const rows = quoted.map((q) => {
    const premium = Number(q.premium_amount);
    const change = expiring ? Math.round(((premium - expiring) / expiring) * 1000) / 10 : null;
    return { responseId: q.id, premium: q.premium_amount, currency: q.premium_currency, changePercent: change, validUntil: q.valid_until, expiresBeforeCover: q.valid_until ? q.valid_until < s.period.period_end : false };
  });
  // A recommendation only where the brokerage has a rule for one (D-?? / rules.ts): otherwise abstain.
  const ruleRow = await ctx.db.from("company_rules").select("value").eq("organization_id", ctx.run.organization_id).eq("key", "quote.recommendation").maybeSingle();
  const rule = recommendationRuleSchema.safeParse((ruleRow.data as { value: unknown } | null)?.value);
  const recommendation =
    rule.success && rule.data.mode !== "abstain" && rows.length >= 2
      ? "Several quotes are in; the comparison in the quotation shows the brokerage's recommendation rule applied."
      : rows.length === 1
        ? `One set of terms is in. ASAP does not recommend with only one quote; present it against the expiring terms.`
        : "ASAP does not name a recommendation: this brokerage has no recommendation rule.";
  return {
    kind: "done",
    output: { expiringPremium: s.period.premium_amount, terms: rows, recommendation },
    evidence: rows.map((r) => ({ kind: "response" as const, label: `${s.insurer!.name}: ${money(r.premium, r.currency)}${r.changePercent !== null ? ` (${r.changePercent > 0 ? "+" : ""}${r.changePercent}% on expiring)` : ""}${r.validUntil ? `, valid to ${human(r.validUntil)}` : ""}`, ref: `insurer_response:${r.responseId}` })),
  };
}

/**
 * The completion receipt (D-131): what was meant, what was achieved, the dates, approvals, people,
 * evidence and delivery evidence, and anything left unresolved. Written once; never edited.
 */
async function writeReceipt(ctx: StepContext, s: Subject) {
  const c = ctx.done["completeness"] ?? {};
  const cmp = ctx.done["compare"] ?? {};
  const o = ctx.done["open_terms"] ?? {};
  const appr = await ctx.db.from("workflow_approvals").select("id, decided_by, decided_at").eq("run_id", ctx.run.id).eq("state", "approved").order("decided_at", { ascending: false }).limit(1);
  const a = ((appr.data ?? []) as { id: string; decided_by: string | null; decided_at: string | null }[])[0] ?? null;
  const people = [a?.decided_by, s.client?.file_owner_id].filter(Boolean) as string[];
  const names = people.length ? await ctx.db.from("users").select("id, display_name, full_name").in("id", [...new Set(people)]) : { data: [] };
  const nameOf = (id: string | null | undefined) => (id ? ((names.data ?? []) as { id: string; display_name: string | null; full_name: string | null }[]).find((u) => u.id === id) : undefined);
  const nm = (id: string | null | undefined) => nameOf(id)?.display_name ?? nameOf(id)?.full_name ?? null;
  const del = o["quoteRequestId"] ? await ctx.db.from("quote_request_deliveries").select("delivered_at, method, reference").eq("quote_request_id", o["quoteRequestId"] as string).maybeSingle() : { data: null };
  const d = del.data as { delivered_at: string; method: string; reference: string } | null;
  const terms = (cmp["terms"] as { premium: string; currency: string | null; changePercent: number | null; validUntil: string | null }[] | undefined) ?? [];
  const first = terms[0];
  const outcome = first
    ? `Renewal terms ready to present — ${s.insurer!.name} quoted ${money(first.premium, first.currency)}${first.changePercent !== null ? ` (${first.changePercent > 0 ? "+" : ""}${first.changePercent}% on expiring)` : ""}`
    : "Renewal handed over to present";
  const receipt = {
    intendedOutcome: `Renewal terms for ${s.client!.name}'s ${s.policy.class_of_business ?? ""} policy ${s.policy.policy_number ?? ""} before cover ends ${human(s.period.period_end)}`.replace(/ {2,}/g, " "),
    achievedOutcome: outcome,
    dates: [
      { label: "Renewal started", at: (ctx.run as unknown as { started_at?: string }).started_at ?? null },
      { label: "Bundle approved", at: a?.decided_at ?? null },
      { label: "Request delivered to the insurer", at: d?.delivered_at ?? null },
      { label: "Cover ends", at: s.period.period_end },
    ].filter((x) => x.at),
    approvals: a ? [{ what: "Renewal pack, client letter and insurer terms request", by: nm(a.decided_by), at: a.decided_at }] : [],
    people: [{ role: "Responsible", name: nm(s.client?.file_owner_id) ?? "Unassigned" }, ...(a ? [{ role: "Approved by", name: nm(a.decided_by) ?? "A member" }] : [])],
    evidence: [...((c["present"] as string[]) ?? []), ...(((cmp["recommendation"] as string) ? [cmp["recommendation"] as string] : []))],
    delivery: d ? [{ to: s.insurer!.name, method: d.method.replaceAll("_", " "), reference: d.reference, at: d.delivered_at }] : [],
    unresolved: (c["nonBlocking"] as string[]) ?? [],
    links: [
      { label: "Client", ref: `client:${s.client!.id}` },
      { label: "Policy period", ref: `policy_period:${s.period.id}` },
      ...(ctx.run.work_item_id ? [{ label: "Work", ref: `work_item:${ctx.run.work_item_id}` }] : []),
      ...(o["opportunityId"] ? [{ label: "Quotation", ref: `opportunity:${o["opportunityId"]}` }] : []),
    ],
    nothingSent: "ASAP sent nothing itself: every external message was delivered by a person and recorded.",
  };
  // Once per run (run_id is unique): a re-run of this step finds the receipt already written.
  await ctx.db.from("workflow_receipts").upsert(
    { organization_id: ctx.run.organization_id, run_id: ctx.run.id, workflow: "renewal", client_id: s.client!.id, work_item_id: ctx.run.work_item_id, title: `Renewal — ${s.client!.name}, ${s.policy.policy_number ?? s.policy.class_of_business ?? "policy"}`, outcome, receipt },
    { onConflict: "run_id", ignoreDuplicates: true },
  );
  await auditAutomation(ctx.db, ctx.run, "workflow.renewal.receipt", { outcome, unresolved: receipt.unresolved.length });
  return outcome;
}

async function handOver(ctx: StepContext): Promise<StepResult> {
  const s = await subjectOf(ctx);
  const outcome = await writeReceipt(ctx, s);
  await updateWork(ctx.db, ctx.run.work_item_id, { task_status: "needs_you", task_party: null, required_action: `Present the renewal terms to ${s.client!.name} and record their instruction`, reason: `Terms are in and compared against the expiring premium. Cover ends ${human(s.period.period_end)}.`, task_next_check: null });
  return { kind: "done", output: { handedTo: "person", outcome }, evidence: [{ kind: "record", label: "Handed to a person to present — a client instruction is the client's to give" }, { kind: "record", label: `Completion receipt: ${outcome}`, ref: `workflow_run:${ctx.run.id}` }] };
}

export const RENEWAL: WorkflowDefinition = {
  workflow: "renewal",
  steps: [
    { key: "detect", label: "Renewal detected", run: detect },
    { key: "completeness", label: "Client, policy and documents checked", run: completeness },
    { key: "read_schedule", label: "Schedule read (confirmed values only)", run: readSchedule },
    { key: "assign_work", label: "Work created and assigned", run: assignWork },
    { key: "pack", label: "Renewal pack prepared", run: pack },
    { key: "communications", label: "Client and insurer messages prepared", run: communications },
    { key: "approval", label: "One approval for the pack and messages", run: approval },
    { key: "open_terms", label: "Insurer request recorded as approved", run: openTerms },
    { key: "await_terms", label: "Insurer terms awaited and chased", maxAttempts: 5, run: awaitTerms },
    { key: "compare", label: "Terms compared with the expiring premium", run: compare },
    { key: "hand_over", label: "Handed to a person to present", run: handOver },
  ],
};

/* --------------------------------------------------------------------------- detection */

/**
 * Finds periods ending within the window and starts one run for each, once. A period whose policy
 * already has a later period is renewed; a policy with an open renewal Work item adopts it.
 */
export async function detectRenewals(db: SupabaseClient, logger: Logger, organizationId: string, now = new Date()): Promise<{ started: number; existing: number; startedRunIds: string[] }> {
  // A brokerage that set "start renewal work" below automatic starts renewals itself.
  if (!automatic((await autonomyRule(db, organizationId)).actions.detect_renewals)) return { started: 0, existing: 0, startedRunIds: [] };
  const window = await renewalWindow(db, organizationId);
  const today = isoDay(now);
  const horizon = isoDay(new Date(now.getTime() + window.leadDays * DAY));
  const q = await db.from("policy_periods").select("id, policy_id, period_end").eq("organization_id", organizationId).gte("period_end", today).lte("period_end", horizon).limit(200);
  const periods = (q.data ?? []) as { id: string; policy_id: string; period_end: string }[];
  let started = 0;
  let existing = 0;
  const startedRunIds: string[] = [];
  for (const p of periods) {
    const r = await detectRenewalFor(db, logger, organizationId, p.id);
    if ("blocked" in r) continue;
    if (r.created) {
      started++;
      startedRunIds.push(r.runId);
    }
    else existing++;
  }
  if (started) logger.info({ organizationId, started }, "renewals detected");
  return { started, existing, startedRunIds };
}

/** One period: renewed already, unreadable, or one run (created now or found). */
/** How a run began: found by ASAP inside the renewal window, or started by a person. */
export type RenewalOrigin = { kind: "window" } | { kind: "manual"; by: string };

export async function detectRenewalFor(db: SupabaseClient, _logger: Logger, organizationId: string, periodId: string, origin: RenewalOrigin = { kind: "window" }): Promise<{ runId: string; created: boolean } | { blocked: string }> {
  const s = await loadSubject(db, periodId);
  if (!s || !s.client) return { blocked: "That policy period, its policy or its client cannot be read." };
  const later = await db.from("policy_periods").select("id").eq("policy_id", s.policy.id).gt("period_start", s.period.period_end).limit(1);
  if ((later.data ?? []).length) return { blocked: "This policy already has a later period on file — it has been renewed." };
  const workItemId = await ensureRenewalWork(db, organizationId, s);
  return startRun(db, RENEWAL, { organizationId, subjectType: "policy_period", subjectId: s.period.id, workItemId, facts: { policyId: s.policy.id, clientId: s.client.id, periodEnd: s.period.period_end, origin: origin.kind, ...(origin.kind === "manual" ? { startedBy: origin.by } : {}) } });
}

async function ensureRenewalWork(db: SupabaseClient, organizationId: string, s: Subject): Promise<string | null> {
  const open = await db
    .from("work_items")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("kind", "renewal")
    .eq("policy_period_id", s.period.id)
    .neq("task_status", "done")
    .is("deleted_at", null)
    .limit(1);
  const found = ((open.data ?? []) as { id: string }[])[0];
  if (found) return found.id;
  const bySource = await db.from("work_items").select("id").eq("organization_id", organizationId).eq("source_type", "policy_period").eq("source_id", s.period.id).eq("reason_code", "renewal_due").neq("task_status", "done").is("deleted_at", null).maybeSingle();
  if (bySource.data) return (bySource.data as { id: string }).id;
  const ins = await db
    .from("work_items")
    .insert({
      organization_id: organizationId,
      title: `${s.client!.name} — ${s.policy.class_of_business ?? "policy"} renewal`,
      kind: "renewal",
      client_id: s.client!.id,
      policy_period_id: s.period.id,
      insurer_id: s.insurer?.id ?? null,
      class_of_business: s.policy.class_of_business,
      owner_id: s.client!.file_owner_id,
      task_status: "in_progress",
      reason: `Cover ends ${human(s.period.period_end)}. ASAP found it and is preparing the renewal.`,
      required_action: "ASAP is checking the file and preparing the renewal",
      source_type: "policy_period",
      source_id: s.period.id,
      reason_code: "renewal_due",
      steps: [],
    })
    .select("id")
    .maybeSingle();
  if (ins.data) return (ins.data as { id: string }).id;
  const again = await db.from("work_items").select("id").eq("organization_id", organizationId).eq("source_type", "policy_period").eq("source_id", s.period.id).eq("reason_code", "renewal_due").neq("task_status", "done").maybeSingle();
  return (again.data as { id: string } | null)?.id ?? null;
}

/** The scheduled pass: detect in every brokerage, then advance every run that is due. */
export async function sweepWorkflows(db: SupabaseClient, logger: Logger, now = new Date()) {
  const orgs = await db.from("organizations").select("id");
  let started = 0;
  /*
   * A run found in this pass is advanced in this pass (D-137). Its `next_run_at` is stamped by the
   * database a moment after `now`, so the due query below missed it and the run sat at "0 of 11"
   * until the next sweep — fifteen minutes that read as ASAP working when it was only queued.
   */
  const fresh: string[] = [];
  for (const o of (orgs.data ?? []) as { id: string }[]) {
    const d = await detectRenewals(db, logger, o.id, now);
    started += d.started;
    fresh.push(...d.startedRunIds);
  }
  const due = await db.from("workflow_runs").select("id").in("state", ["running", "waiting_approval", "waiting_party"]).lte("next_run_at", now.toISOString()).order("next_run_at").limit(100);
  const outcomes = [];
  const ids = [...new Set([...fresh, ...((due.data ?? []) as { id: string }[]).map((r) => r.id)])];
  for (const id of ids) {
    const r = { id };
    try {
      outcomes.push(await advanceRun(db, logger, RENEWAL, r.id, now));
    } catch (e) {
      logger.error({ runId: r.id, err: (e as Error).message }, "a workflow run could not be advanced; the next sweep tries again");
    }
  }
  return { started, advanced: outcomes.length, outcomes };
}

export { advanceRun, type Evidence };
