import { INBOUND_KIND_LABELS, type InboundKind, type LivingAction, type LivingBlock, type LivingCommandInput, type WorkItemRow } from "@asap/schema";
import { createHash } from "node:crypto";
import { hasPermission } from "../context.js";
import type { Env } from "../placement/service.js";

/**
 * Insurance-native intelligence shared by every Living workspace (D-166). Each part is read from a
 * record the viewer may read, and each block either states what the records hold or proposes a
 * governed step through an endpoint that already owns it:
 *
 *  - Arrived email: what the inbound router filed to this work's runs (D-144) and nobody has dealt
 *    with, ASAP's reading of it labelled as a reading, and the step it proposes. Filing records
 *    nothing; confirming a reading (D-152) is a person's command.
 *  - Handover: responsibility moving between colleagues with what is done, open and to watch (0087).
 *  - Related work: other open work on the same client or policy, and why it bears on this work.
 *  - What usually happens: insurer response times measured from this brokerage's own requests and
 *    answers, an estimate with its basis and sample, or "too little on file to say".
 *
 * None of these is a status. Nothing here changes what the work is waiting on.
 */

type Command = Extract<LivingAction, { kind: "command" }>;
export type Gap = { part: string; reason: "restricted" | "failed" };
const many = <T>(x: T | T[] | null | undefined): T[] => (Array.isArray(x) ? x : x ? [x] : []);
const hashOf = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const human = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const nameOf = (u: { display_name: string | null; full_name: string | null } | null | undefined) => u?.display_name ?? u?.full_name ?? "A colleague";
const input = (name: string, label: string, kind: LivingCommandInput["kind"], required: boolean, extra: Partial<LivingCommandInput> = {}): LivingCommandInput => ({ name, label, kind, required, options: extra.options ?? [], hint: extra.hint ?? null });

export type Arrival = {
  messageId: string;
  from: string;
  subject: string;
  at: string;
  party: string | null;
  kind: string | null;
  workflow: string;
  proposal: { id: string; opportunityInsurerId: string; opportunityId: string; outcome: string; premiumAmount: string | null; premiumCurrency: string | null; validUntil: string | null; declineReason: string | null; words: string | null } | null;
};
export type Handover = { id: string; fromName: string; toName: string; toUserId: string; at: string; done: string; open: string; watch: string | null; acknowledgedAt: string | null; earlier: number };
export type Related = { workItemId: string; title: string; kind: string; status: string; samePolicy: boolean };
export type Pattern = { party: string; requests: number; answered: number; medianDays: number | null };
export type TrailItem = { at: string | null; text: string; by: string | null; tone: "green" | "gold" | "red" | "grey"; documentId: string | null };
export type DecisionTrail = { title: string; closedAt: string | null; items: TrailItem[] };
export type Collaboration = {
  arrivals: Arrival[];
  handover: Handover | null;
  members: { id: string; name: string }[];
  related: Related[];
  patterns: Pattern[];
  viewerId: string;
  canManage: boolean;
  canRecordResponse: boolean;
  /** The client's last round for the same cover, when there is one (renewals). */
  trail: DecisionTrail | null;
  /** Parts that could not be read, in words — said on the surface, never shown as absent. */
  unavailable: Gap[];
};

/** The blocks every workspace gains, placed by the composer; `null` parts are left out. */
export function collaborationBlocks(c: Collaboration | null | undefined, item: WorkItemRow, kind: string) {
  if (!c) return { arrived: null, handover: null, related: null, patterns: null, trail: null };
  return { arrived: arrivedMailBlock(c), handover: handoverBlock(c, item), related: relatedWorkBlock(c, kind), patterns: responsePatternsBlock(c), trail: decisionTrailBlock(c) };
}
/**
 * Places the collaboration blocks among a composed surface's own: a handover waiting for the
 * viewer straight after the lead; arrived email after what moves the work forward; patterns and an
 * acknowledged handover beside who holds the next step; related work beside what this means.
 */
export function placeCollaboration(blocks: LivingBlock[], c: Collaboration | null | undefined, item: WorkItemRow, kind: string): LivingBlock[] {
  const b = collaborationBlocks(c, item, kind);
  const out = [...blocks];
  const after = (id: string | null, x: LivingBlock | null) => {
    if (!x) return;
    const i = id ? out.findIndex((y) => y.id === id) : -1;
    if (i >= 0) out.splice(i + 1, 0, x);
    else out.push(x);
  };
  const leadEnd = () => out.filter((y) => y.role === "lead").length;
  if (b.handover?.role === "main") out.splice(leadEnd(), 0, b.handover);
  if (b.arrived) {
    const i = out.findIndex((y) => y.id === "next");
    out.splice(i >= 0 ? i + 1 : leadEnd() + (b.handover?.role === "main" ? 1 : 0), 0, b.arrived);
  }
  after("obligations", b.patterns);
  if (b.handover?.role === "side") after(b.patterns ? "patterns" : "obligations", b.handover);
  after("consequences", b.related);
  after(out.some((y) => y.id === "memory") ? "memory" : "cover", b.trail);
  return out.slice(0, 28);
}

/** Unavailable parts in words, merged without repeats and within the surface's limit. */
export function mergeUnavailable(base: { part: string; reason: "restricted" | "failed" }[], c: Collaboration | null | undefined) {
  const out = [...base];
  for (const g of c?.unavailable ?? []) if (!out.some((x) => x.part === g.part)) out.push(g);
  return out.slice(0, 12);
}

/** Smallest number of delivered requests before a typical time is stated. A display rule, said in the basis. */
export const PATTERN_MIN_SAMPLE = 5;

async function read<T>(gaps: Gap[], part: string, q: PromiseLike<{ data: unknown; error: unknown }>): Promise<T | null> {
  try {
    const r = await q;
    if (r.error) {
      gaps.push({ part, reason: (r.error as { code?: string }).code === "42501" ? "restricted" : "failed" });
      return null;
    }
    return r.data as T;
  } catch {
    gaps.push({ part, reason: "failed" });
    return null;
  }
}

export async function loadCollaboration(env: Env, gaps: Gap[], o: {
  item: WorkItemRow;
  /** Subjects whose runs belong to this work (the quotation, the placement). */
  subjectIds: string[];
  policyId: string | null;
  /** Insurers this work is waiting on an answer from (renewal quotations). */
  waitingOn: string[];
  canRecordResponse: boolean;
  /** Renewals: find the client's previous quotation round for the same class. */
  trailFor?: { clientId: string; classOfBusiness: string; excludeOpportunityId: string | null } | null;
}): Promise<Collaboration> {
  const { db, organizationId: org } = env;
  const item = o.item;
  const subjects = o.subjectIds.filter(Boolean);
  const runFilter = subjects.length ? `work_item_id.eq.${item.id},subject_id.in.(${subjects.join(",")})` : `work_item_id.eq.${item.id}`;

  const [runs, handovers, related] = await Promise.all([
    read<{ id: string; workflow: string; current_step: string | null; facts: Record<string, unknown> }[]>(gaps, "Email filed to this work",
      db.from("workflow_runs").select("id, workflow, current_step, facts").eq("organization_id", org).or(runFilter).not("state", "in", "(done,cancelled)")),
    read<{ id: string; to_user_id: string; created_at: string; done_text: string; open_text: string; watch_text: string | null; acknowledged_at: string | null; from_user: { display_name: string | null; full_name: string | null } | null; to_user: { display_name: string | null; full_name: string | null } | null }[]>(gaps, "Handovers",
      db.from("work_handovers").select("id, to_user_id, created_at, done_text, open_text, watch_text, acknowledged_at, from_user:users!work_handovers_from_user_id_fkey(display_name, full_name), to_user:users!work_handovers_to_user_id_fkey(display_name, full_name)").eq("organization_id", org).eq("work_item_id", item.id).order("created_at", { ascending: false }).limit(10)),
    item.client_id
      ? read<{ id: string; title: string; kind: string; task_status: string; task_party: string | null; task_since: string | null; policy_period_id: string | null }[]>(gaps, "Related work",
          db.from("work_items").select("id, title, kind, task_status, task_party, task_since, policy_period_id").eq("organization_id", org).eq("client_id", item.client_id).neq("id", item.id).neq("task_status", "done").is("deleted_at", null).in("kind", ["renewal", "claim", "endorsement", "new_business", "placement"]).order("updated_at", { ascending: false }).limit(12))
      : Promise.resolve([]),
  ]);

  // Arrived email: filed on the step the run is on and not yet dealt with (D-144's own rule).
  const filed: { runId: string; workflow: string; messageId: string; from: string; subject: string; at: string; kind: string | null; party: string | null }[] = [];
  for (const r of runs ?? [])
    for (const e of (r.facts["inbound"] as { messageId: string; from: string; subject: string; at: string; kind: string | null; party: string | null; step: string | null; acknowledged: boolean }[] | undefined) ?? [])
      if (!e.acknowledged && e.step === r.current_step) filed.push({ runId: r.id, workflow: r.workflow, ...e });
  const ids = [...new Set(filed.map((f) => f.messageId))].slice(0, 8);
  const proposals = ids.length
    ? await read<{ id: string; email_message_id: string; opportunity_id: string; opportunity_insurer_id: string; outcome: string; premium_amount: string | null; premium_currency: string | null; valid_until: string | null; decline_reason: string | null; evidence: { words?: string }[] | null }[]>(gaps, "ASAP's readings of email",
        db.from("insurer_response_proposals").select("id, email_message_id, opportunity_id, opportunity_insurer_id, outcome, premium_amount, premium_currency, valid_until, decline_reason, evidence").eq("organization_id", org).in("email_message_id", ids).eq("state", "proposed"))
    : [];
  const arrivals: Arrival[] = ids.map((id) => {
    const f = filed.find((x) => x.messageId === id)!;
    const p = (proposals ?? []).find((x) => x.email_message_id === id);
    return {
      messageId: id, from: f.from, subject: f.subject, at: f.at, party: f.party, kind: f.kind, workflow: f.workflow,
      proposal: p ? { id: p.id, opportunityId: p.opportunity_id, opportunityInsurerId: p.opportunity_insurer_id, outcome: p.outcome, premiumAmount: p.premium_amount, premiumCurrency: p.premium_currency, validUntil: p.valid_until, declineReason: p.decline_reason, words: p.evidence?.[0]?.words ?? null } : null,
    };
  });

  // Related work: same client; same policy is known from the claim, the change or the renewal's period.
  let relatedOut: Related[] = [];
  if (related?.length) {
    const rIds = related.map((r) => r.id);
    const periods = related.map((r) => r.policy_period_id).filter((x): x is string => !!x);
    const [cl, en, pp] = await Promise.all([
      read<{ work_item_id: string; policy_id: string | null }[]>(gaps, "Related work", db.from("claims").select("work_item_id, policy_id").eq("organization_id", org).in("work_item_id", rIds)),
      read<{ work_item_id: string; policy_id: string | null }[]>(gaps, "Related work", db.from("endorsements").select("work_item_id, policy_id").eq("organization_id", org).in("work_item_id", rIds)),
      periods.length ? read<{ id: string; policy_id: string }[]>(gaps, "Related work", db.from("policy_periods").select("id, policy_id").eq("organization_id", org).in("id", periods)) : Promise.resolve([]),
    ]);
    const policyOf = (r: (typeof related)[number]) =>
      (cl ?? []).find((x) => x.work_item_id === r.id)?.policy_id ?? (en ?? []).find((x) => x.work_item_id === r.id)?.policy_id ?? (pp ?? []).find((x) => x.id === r.policy_period_id)?.policy_id ?? null;
    relatedOut = related.map((r) => ({
      workItemId: r.id, title: r.title, kind: r.kind,
      status: r.task_status === "with_party" && r.task_party ? `With ${r.task_party}${r.task_since ? ` since ${human(r.task_since)}` : ""}` : r.task_status === "needs_you" ? "Needs someone at the brokerage" : "In progress",
      samePolicy: Boolean(o.policyId && policyOf(r) === o.policyId),
    })).sort((a, b) => Number(b.samePolicy) - Number(a.samePolicy)).slice(0, 8);
  }

  // Handover candidates: active members whose role can hold work, other than the viewer.
  const canManage = hasPermission(env.ctx, "job", "edit");
  let members: { id: string; name: string }[] = [];
  if (canManage && item.task_status !== "done") {
    const [ms, rp] = await Promise.all([
      read<{ user_id: string; role_id: string; users: { display_name: string | null; full_name: string | null } | null }[]>(gaps, "Colleagues", db.from("organization_memberships").select("user_id, role_id, users!organization_memberships_user_id_fkey(display_name, full_name)").eq("organization_id", org).eq("status", "active")),
      read<{ role_id: string }[]>(gaps, "Colleagues", db.from("role_permissions").select("role_id, permissions!inner(object_type, verb)").eq("permissions.object_type", "job").eq("permissions.verb", "edit")),
    ]);
    const roles = new Set((rp ?? []).map((r) => r.role_id));
    members = (ms ?? []).filter((m) => roles.has(m.role_id) && m.user_id !== env.userId).map((m) => ({ id: m.user_id, name: nameOf(m.users) })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 40);
  }

  const h = (handovers ?? [])[0];
  const handover: Handover | null = h ? { id: h.id, fromName: nameOf(h.from_user), toName: nameOf(h.to_user), toUserId: h.to_user_id, at: h.created_at, done: h.done_text, open: h.open_text, watch: h.watch_text, acknowledgedAt: h.acknowledged_at, earlier: (handovers ?? []).length - 1 } : null;

  return { arrivals, handover, members, related: relatedOut, patterns: o.waitingOn.length ? await loadPatterns(env, gaps, o.waitingOn) : [], viewerId: env.userId, canManage, canRecordResponse: o.canRecordResponse, trail: o.trailFor ? await loadTrail(env, gaps, o.trailFor) : null, unavailable: gaps };
}

/** The previous round: its insurers' answers and the client's instruction, each with its evidence. */
export async function loadTrail(env: Env, gaps: Gap[], t: { clientId: string; classOfBusiness: string; excludeOpportunityId: string | null }): Promise<DecisionTrail | null> {
  const { db, organizationId: org } = env;
  let q = db.from("opportunities").select("id, title, created_at, closed_at, closed_outcome, closed_reason").eq("organization_id", org).eq("client_id", t.clientId).eq("class_of_business", t.classOfBusiness);
  if (t.excludeOpportunityId) q = q.neq("id", t.excludeOpportunityId);
  const prev = await read<{ id: string; title: string; created_at: string; closed_at: string | null; closed_outcome: string | null; closed_reason: string | null }[]>(gaps, "The last round", q.order("created_at", { ascending: false }).limit(1));
  const o = prev?.[0];
  if (!o) return null;
  const [resp, instr] = await Promise.all([
    read<{ id: string; outcome: string; received_at: string | null; premium_amount: string | null; premium_currency: string | null; decline_reason: string | null; source_document_id: string | null; opportunity_insurers: { insurers: { name: string } | null } | null }[]>(gaps, "The last round",
      db.from("insurer_responses").select("id, outcome, received_at, premium_amount, premium_currency, decline_reason, source_document_id, opportunity_insurers(insurers(name))").eq("organization_id", org).eq("opportunity_id", o.id).order("received_at")),
    read<{ insurer_response_id: string | null; instructed_at: string; evidence_document_id: string | null; evidence_note: string | null; client_conditions: string | null; outside_comparison: boolean | null; exception_reason: string | null; users: { display_name: string | null; full_name: string | null } | null }[]>(gaps, "The last round",
      db.from("client_instructions").select("insurer_response_id, instructed_at, evidence_document_id, evidence_note, client_conditions, outside_comparison, exception_reason, users!client_instructions_recorded_by_fkey(display_name, full_name)").eq("organization_id", org).eq("opportunity_id", o.id).is("superseded_at", null).order("instructed_at", { ascending: false }).limit(1)),
  ]);
  const insurerOf = (id: string | null) => (resp ?? []).find((r) => r.id === id)?.opportunity_insurers?.insurers?.name ?? null;
  const items: TrailItem[] = [];
  for (const r of resp ?? []) {
    const name = r.opportunity_insurers?.insurers?.name ?? "An insurer";
    if (r.outcome === "declined") items.push({ at: r.received_at, text: `${name} declined${r.decline_reason ? ` — ${cut(r.decline_reason, 300)}` : " (no reason recorded)"}`, by: null, tone: "red", documentId: r.source_document_id });
    else if (r.outcome === "quoted") items.push({ at: r.received_at, text: `${name} quoted ${r.premium_amount && r.premium_currency ? `${r.premium_currency} ${Number(r.premium_amount).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "(premium not recorded)"}`, by: null, tone: "grey", documentId: r.source_document_id });
    else items.push({ at: r.received_at, text: `${name} did not respond`, by: null, tone: "grey", documentId: null });
  }
  const i = instr?.[0];
  if (i) {
    const chosen = insurerOf(i.insurer_response_id);
    const why = [i.client_conditions ? `conditions: ${i.client_conditions}` : null, i.outside_comparison && i.exception_reason ? `outside the comparison: ${i.exception_reason}` : null, i.evidence_note].filter(Boolean).join("; ");
    items.push({ at: i.instructed_at, text: cut(`The client instructed ${chosen ?? "an insurer"}${why ? ` — ${why}` : ""}`, 500), by: i.users ? nameOf(i.users) : null, tone: "green", documentId: i.evidence_document_id });
  }
  if (o.closed_at && o.closed_outcome && !i) items.push({ at: o.closed_at, text: cut(`Closed: ${o.closed_outcome.replace(/_/g, " ")}${o.closed_reason ? ` — ${o.closed_reason}` : ""}`, 500), by: null, tone: "grey", documentId: null });
  return { title: o.title, closedAt: o.closed_at, items: items.slice(0, 10) };
}

/** Delivered requests to each insurer over the last year, and how long their first answer took. */
export async function loadPatterns(env: Env, gaps: Gap[], insurers: string[]): Promise<Pattern[]> {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const rows = await read<{ delivered_at: string; quote_requests: { opportunity_insurer_id: string; opportunity_insurers: { insurers: { name: string } | null; insurer_responses: { received_at: string | null }[] | { received_at: string | null } | null } | null } | null }[]>(gaps, "Response history",
    env.db.from("quote_request_deliveries").select("delivered_at, quote_requests!inner(opportunity_insurer_id, opportunity_insurers!inner(insurers!inner(name), insurer_responses(received_at)))")
      .eq("organization_id", env.organizationId).gte("delivered_at", since).in("quote_requests.opportunity_insurers.insurers.name", insurers).limit(2000));
  if (!rows) return [];
  return insurers.map((party) => {
    const mine = rows.filter((r) => r.quote_requests?.opportunity_insurers?.insurers?.name === party);
    const days = mine.flatMap((r) => {
      const first = many(r.quote_requests?.opportunity_insurers?.insurer_responses).map((x) => x.received_at).filter((x): x is string => !!x).sort()[0];
      return first ? [Math.max(0, (new Date(first).getTime() - new Date(r.delivered_at).getTime()) / 86_400_000)] : [];
    }).sort((a, b) => a - b);
    const median = days.length ? days[Math.floor((days.length - 1) / 2)]! : null;
    return { party, requests: mine.length, answered: days.length, medianDays: median === null ? null : Math.round(median * 10) / 10 };
  });
}

/* Blocks ---------------------------------------------------------------------------------------- */

const block = (id: string, component: LivingBlock["component"], role: LivingBlock["role"], title: string, props: Record<string, unknown>, actions: Command[] = []): LivingBlock =>
  ({ id, component, version: 1, role, title, props, evidence: [], actions: actions.slice(0, 4), hash: hashOf([props, actions]) });

const KIND_STEP: Record<string, string> = {
  quotation: "Record the insurer's answer on the quotes below, from what the email says.",
  renewal: "Record what it says through the step it belongs to.",
  placement: "If it is the insurer's confirmation, record it on the placement.",
  issuance: "If it carries the issued documents, record them on the issuance.",
  claim: "If it carries an outstanding document, record it received below, with the email as the reference.",
  endorsement: "If it is the insurer's written decision, record it on the item below, with the email as the reference.",
};

export function arrivedMailBlock(c: Collaboration): LivingBlock | null {
  if (!c.arrivals.length) return null;
  const actions: Command[] = [];
  const items = c.arrivals.map((a) => {
    const p = a.proposal;
    const summary = p ? (p.outcome === "declined" ? `A decline${p.declineReason ? ` — ${cut(p.declineReason, 200)}` : ""}` : `${p.premiumCurrency ?? ""} ${p.premiumAmount ? Number(p.premiumAmount).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "an amount not read"}${p.validUntil ? `, valid until ${human(p.validUntil)}` : ""}`.trim()) : null;
    if (p && c.canRecordResponse && actions.length < 4)
      actions.push({
        kind: "command", label: `Confirm ${a.party ?? "the insurer"}'s reply as read`.slice(0, 200), command: "quotation.confirm_reading", target: p.opportunityId, tone: "primary", inputs: [],
        payload: { action: "record_response", opportunityInsurerId: p.opportunityInsurerId, fromProposalId: p.id, outcome: p.outcome },
        confirm: { title: `Record ${a.party ?? "the insurer"}'s answer as read?`, body: `${summary} — read from the email's own words${p.words ? `: “${cut(p.words, 200)}”` : ""}. It is recorded with the email as its source. If anything is wrong, record the answer on the quotes instead.`.slice(0, 500) },
      });
    return {
      id: a.messageId,
      from: cut(a.from, 200),
      subject: cut(a.subject || "(no subject)", 500),
      at: a.at,
      party: a.party,
      reading: a.kind && a.kind in INBOUND_KIND_LABELS ? `ASAP's reading: ${INBOUND_KIND_LABELS[a.kind as InboundKind].toLowerCase()}` : null,
      proposal: summary ? { summary: cut(summary, 500), words: p?.words ? cut(p.words, 500) : null } : null,
      proposed: p ? (c.canRecordResponse ? "Confirm it as read, or record it differently on the quotes." : "Someone who can record insurer answers confirms it.") : (KIND_STEP[a.workflow] ?? KIND_STEP["renewal"]!),
    };
  });
  return block("arrived", "ArrivedMail", "main", "Arrived and not yet dealt with", { items, note: "Filed here by ASAP. Filing an email records nothing: what it says counts once a person records it." }, actions);
}

export function handoverBlock(c: Collaboration, item: WorkItemRow): LivingBlock | null {
  const actions: Command[] = [];
  const h = c.handover;
  const forViewer = Boolean(h && h.toUserId === c.viewerId);
  if (h && forViewer && !h.acknowledgedAt)
    actions.push({ kind: "command", label: "I have it", command: "work.acknowledge_handover", target: h.id, tone: "primary", payload: {}, inputs: [], confirm: null });
  if (c.canManage && item.task_status !== "done" && c.members.length)
    actions.push({
      kind: "command", label: h ? "Hand it on" : "Hand over to a colleague", command: "work.hand_over", target: item.id, tone: "default", confirm: null,
      payload: { version: String(item.version) },
      inputs: [
        input("toUserId", "Hand it to", "select", true, { options: c.members.map((m) => ({ value: m.id, label: cut(m.name, 200) })) }),
        input("done", "What is done", "textarea", true, { hint: "What has been sent, received and agreed so far." }),
        input("open", "What is still open", "textarea", true, { hint: "What the next person must do, and for whom." }),
        input("watch", "What to watch (optional)", "textarea", false, { hint: "Promises made, dates, anything sensitive with the client or insurer." }),
      ],
    });
  if (!h && !actions.length) return null;
  if (!h) return block("handover", "HandoverNote", "side", "Handover", { from: null, to: null, at: null, done: null, open: null, watch: null, acknowledgedAt: null, forViewer: false, earlier: 0 }, actions);
  return block("handover", "HandoverNote", forViewer && !h.acknowledgedAt ? "main" : "side", forViewer && !h.acknowledgedAt ? "Handed to you" : "Handover",
    { from: cut(h.fromName, 200), to: cut(h.toName, 200), at: h.at, done: cut(h.done, 2000), open: cut(h.open, 2000), watch: h.watch ? cut(h.watch, 2000) : null, acknowledgedAt: h.acknowledgedAt, forViewer, earlier: h.earlier }, actions);
}

const KIND_WORDS: Record<string, string> = { renewal: "Renewal", claim: "Claim", endorsement: "Policy change", new_business: "New business", placement: "Placement" };
/** Why another piece of work bears on this one: potential on the same policy, context otherwise. */
function whyRelated(thisKind: string, r: Related): { why: string; certainty: "potential" | "context" } {
  if (!r.samePolicy) return { why: "Same client, another policy. Worth knowing when you speak to them.", certainty: "context" };
  const k = `${thisKind}:${r.kind}`;
  const WHY: Record<string, string> = {
    "renewal:claim": "An open claim on the policy being renewed. The insurer may ask about it when quoting; its outcome is not on file yet.",
    "renewal:endorsement": "A change to this policy is still open. Renewal terms are for the cover as it stands; if the change is agreed, the renewed terms must carry it.",
    "claim:renewal": "This policy is being renewed. The claim stays with the period the incident fell in; the renewing insurer may ask about it.",
    "claim:endorsement": "A change to this policy is open. The claim is assessed on the cover in force on the incident date.",
    "endorsement:renewal": "This policy is being renewed. A change agreed now applies to the current period; the renewal must carry it too.",
    "endorsement:claim": "An open claim on this policy. A change does not alter cover for an incident that has already happened.",
  };
  return { why: WHY[k] ?? "Open work on the same policy.", certainty: "potential" };
}

export function relatedWorkBlock(c: Collaboration, thisKind: string): LivingBlock | null {
  if (!c.related.length) return null;
  const items = c.related.map((r) => ({ title: cut(r.title, 200), kind: KIND_WORDS[r.kind] ?? "Work", status: cut(r.status, 500), ...whyRelated(thisKind, r), ref: ["renewal", "claim", "endorsement"].includes(r.kind) ? { ws: "living", workItemId: r.workItemId } : { ws: "workitem", workItemId: r.workItemId } }));
  return block("related", "RelatedWork", "side", "Related work", { items });
}

export function responsePatternsBlock(c: Collaboration): LivingBlock | null {
  if (!c.patterns.length) return null;
  const items = c.patterns.map((p) => {
    const enough = p.requests >= PATTERN_MIN_SAMPLE && p.medianDays !== null;
    const days = (n: number) => (n < 1 ? "within a day" : `about ${Math.round(n)} day${Math.round(n) === 1 ? "" : "s"}`);
    return {
      party: cut(p.party, 200),
      measure: enough ? `Answered ${p.answered} of ${p.requests} requests; the typical first answer came ${days(p.medianDays!)} after delivery.` : `Too little on file to say: ${p.requests} delivered request${p.requests === 1 ? "" : "s"} in the last year.`,
      sample: p.requests,
      enough,
    };
  });
  return block("patterns", "ResponsePatterns", "side", "What usually happens", { items, basis: `Measured from this brokerage's own delivered requests and recorded answers over the last 12 months — an estimate, not a promise. A typical time is stated only with ${PATTERN_MIN_SAMPLE} or more requests.` });
}

export function decisionTrailBlock(c: Collaboration): LivingBlock | null {
  const t = c.trail;
  if (!t || !t.items.length) return null;
  return block("trail", "DecisionTrail", "side", "Decided last time", {
    round: cut(`${t.title}${t.closedAt ? `, closed ${human(t.closedAt)}` : ""}`, 500),
    items: t.items.map((i) => ({ at: i.at, text: cut(i.text, 500), by: i.by ? cut(i.by, 200) : null, tone: i.tone, ref: i.documentId ? { ws: "document", documentId: i.documentId } : null })),
    note: "From the records of that round. What was decided then is a starting point, not this year's decision.",
  });
}
