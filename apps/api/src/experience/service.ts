import {
  EXPERIENCE_CONTRACT,
  emptyUiState,
  experienceUiStateSchema,
  validateExperienceSpec,
  type AiProvider,
  type ASAPExperienceSpec,
  type ExperienceResponse,
  type ExperienceSummary,
  type ExperienceUiState,
  type IntentKind,
  type SubjectRef,
  type WorkspaceFocus,
} from "@asap/schema";
import type { Logger } from "pino";
import { HttpError, mapDatabaseError } from "../errors.js";
import { interpretWorkspace } from "../living/ask-workspace.js";
import { loadRenewalLivingFacts } from "../living/facts.js";
import { renewalVocabulary } from "../living/focus.js";
import { loadVocabulary } from "../living/portfolio.js";
import type { Env } from "../placement/service.js";
import { Composition, L, cut } from "./build.js";
import { composeCreateClient, type CreateClientParams } from "./compose-client.js";
import { composeExplore, defaultExplore, refineExplore, type ExploreState } from "./compose-explore.js";
import { adoptSubject, composeRenewal, initialRenewState, type RenewState } from "./compose-renewal.js";
import { interpretIntent, interpretRules, refusal, splitRenewal, type TopIntent } from "./intent.js";
import type { Composed } from "./types.js";

/**
 * The experience pipeline (D-172): one path for every intention.
 *
 *   words (or a record) → interpretation (rules, then the gateway) → session → resolution of
 *   records under the viewer's session → composition → validation against the contract and the
 *   authorized references → response
 *
 * The session keeps what the person asked, the parameters resolved from it and interface state.
 * Every composition re-reads its records, so an experience reopened tomorrow shows tomorrow's facts,
 * and a permission withdrawn since is refused rather than remembered.
 */

export type Deps = { logger: Logger; provider: AiProvider | null };
type Stored = {
  by: "rules" | "model";
  understood: string;
  directionChangedAt: string | null;
  lastActions: string[];
  create?: CreateClientParams;
  explore?: ExploreState;
  renew?: RenewState;
  reason?: string;
};
type Row = {
  id: string; title: string; kind: IntentKind; expression: string; intent: Stored; subjects: SubjectRef[]; progress: string;
  revision: number; ui_state: unknown; ui_version: number; updated_at: string;
};
const COLS = "id, title, kind, expression, intent, subjects, progress, revision, ui_state, ui_version, updated_at";

async function load(env: Env, id: string): Promise<Row> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "not_found", "That work is not available.");
  const r = await env.db.from("experience_sessions").select(COLS).eq("organization_id", env.organizationId).eq("user_id", env.userId).eq("id", id).is("archived_at", null).maybeSingle();
  if (r.error) throw mapDatabaseError(r.error);
  if (!r.data) throw new HttpError(404, "not_found", "That work is not available.");
  return r.data as Row;
}

function stateFor(top: TopIntent, now: Date, vocabText?: (p: ExploreState) => ExploreState): Pick<Stored, "create" | "explore" | "renew" | "reason"> {
  switch (top.kind) {
    case "create_client": return { create: { stage: "form", name: top.name, clientId: null } };
    case "explore_policies": {
      const st: ExploreState = { params: defaultExplore(now), selected: null, unclear: null };
      return { explore: vocabText ? vocabText(st) : st };
    }
    case "renew_policy": return { renew: initialRenewState(top.clientWords, top.coverWords) };
    case "unsupported": return { reason: top.reason };
  }
}

async function exploreFrom(env: Env, text: string, now: Date, base: ExploreState): Promise<ExploreState> {
  const vocab = await loadVocabulary(env);
  const r = refineExplore(base.params, text, now, vocab);
  return { params: r.params, selected: base.selected, unclear: r.unclear };
}

/** Composes for the session's kind; returns the (possibly further resolved) state too. */
async function compose(env: Env, kind: IntentKind, st: Stored, now: Date): Promise<{ composed: Composed; st: Stored }> {
  if (kind === "create_client") return { composed: await composeCreateClient(env, st.create ?? { stage: "form", name: null, clientId: null }), st };
  if (kind === "explore_policies") return { composed: await composeExplore(env, st.explore ?? { params: defaultExplore(now), selected: null, unclear: null }, now), st };
  if (kind === "renew_policy") {
    const r = await composeRenewal(env, st.renew ?? initialRenewState("", null), now);
    return { composed: r.composed, st: { ...st, renew: r.state } };
  }
  return { composed: composeUnsupported(st.reason ?? "ASAP could not tell what to set up from that."), st };
}

function composeUnsupported(reason: string): Composed {
  const c = new Composition();
  const opts = [
    { label: "Add a new client", text: "Add a new client" },
    { label: "Policies expiring this month", text: "Show policies expiring this month" },
  ].map((o, i) => ({ label: o.label, action: c.action(`try-${i}`, o.label, { kind: "experience.refine", text: o.text }) }));
  const ask = c.put("clarify", "Clarification", { question: cut(reason, 500), options: opts, allowText: true }, { actions: opts.map((o) => o.action) });
  return { title: "Not set up yet", progress: "waiting_input", primary: null, layout: L.stack("root", [ask]), composition: c, missing: [], resolution: "unsupported" };
}

function buildSpec(row: Row, st: Stored, composed: Composed, revision: number, now: Date, logger: Logger, reportWithdrawn: boolean): ASAPExperienceSpec {
  const c = composed.composition;
  const offered = new Set(c.actions.filter((a) => !a.disabledReason).map((a) => a.id));
  // Said only when the records changed under the person (a re-read), never after their own step.
  const withdrawn = (reportWithdrawn ? st.lastActions : [])
    .filter((id) => !offered.has(id) && !c.actions.some((a) => a.id === id))
    .filter((id) => !/^(pick-|try-|rm-|doc-)/.test(id))
    .slice(0, 8)
    .map((action) => ({ action, reason: "No longer offered: the records changed since it was shown." }));
  const spec = {
    contract: EXPERIENCE_CONTRACT,
    experienceId: row.id,
    revision,
    composedAt: now.toISOString(),
    title: cut(composed.title, 200),
    intent: {
      kind: row.kind,
      expression: cut(row.expression, 500),
      understood: cut(composed.understood ?? st.understood, 500),
      resolution: composed.resolution ?? (row.kind === "unsupported" ? "unsupported" : "resolved"),
      interpretedBy: st.by,
      missing: composed.missing.slice(0, 8),
      progress: composed.progress,
      directionChangedAt: st.directionChangedAt,
    },
    context: {
      primary: composed.primary,
      related: (composed.related ?? []).slice(0, 20),
      permissions: composed.permissions ?? {},
      constraints: [],
      unresolved: composed.missing.slice(0, 8),
      unavailable: (composed.unavailable ?? []).slice(0, 8),
    },
    layout: composed.layout,
    components: c.components,
    actions: c.actions,
    notices: (composed.notices ?? []).slice(0, 4),
    withdrawn,
  };
  const v = validateExperienceSpec(spec, { authorizedRefs: c.authorized });
  if (!v.ok) {
    logger.error({ issues: v.issues, kind: row.kind }, "experience composition rejected by its validator");
    throw new HttpError(422, "experience_invalid", "This could not be composed safely, so nothing is shown.");
  }
  return v.spec;
}

function uiOf(raw: unknown): ExperienceUiState {
  const p = experienceUiStateSchema.safeParse(raw ?? {});
  return p.success ? p.data : emptyUiState();
}

async function persistAndRespond(env: Env, row: Row, st: Stored, opts: { bump: boolean; now: Date; logger: Logger; redirect?: string | null; uiPatch?: (ui: ExperienceUiState) => ExperienceUiState }): Promise<ExperienceResponse> {
  const { composed, st: resolved } = await compose(env, row.kind, st, opts.now);
  const revision = opts.bump ? row.revision + 1 : row.revision;
  const spec = buildSpec(row, resolved, composed, revision, opts.now, opts.logger, !opts.bump);
  let ui = uiOf(row.ui_state);
  let uiVersion = row.ui_version;
  if (composed.prefill && Object.keys(ui.drafts).length === 0) ui = { ...ui, drafts: composed.prefill };
  if (opts.uiPatch) ui = opts.uiPatch(ui);
  const changedUi = JSON.stringify(ui) !== JSON.stringify(uiOf(row.ui_state));
  if (changedUi) uiVersion = row.ui_version + 1;
  const subjects = [spec.context.primary, ...spec.context.related].filter((s): s is SubjectRef => !!s);
  const next: Stored = { ...resolved, lastActions: spec.actions.map((a) => a.id) };
  const u = await env.db
    .from("experience_sessions")
    .update({ title: spec.title, intent: next, subjects, progress: spec.intent.progress, revision, ...(changedUi ? { ui_state: ui, ui_version: uiVersion } : {}), updated_at: opts.now.toISOString() })
    .eq("organization_id", env.organizationId)
    .eq("user_id", env.userId)
    .eq("id", row.id);
  if (u.error) throw mapDatabaseError(u.error);
  return { spec, ui, uiVersion, redirect: opts.redirect ?? null };
}

async function create(env: Env, deps: Deps, text: string, top: TopIntent, st: Stored, now: Date, ui?: ExperienceUiState): Promise<ExperienceResponse> {
  const ins = await env.db
    .from("experience_sessions")
    .insert({ organization_id: env.organizationId, user_id: env.userId, title: cut(top.understood, 200), kind: top.kind, expression: cut(text, 500), intent: st, subjects: [], progress: "started", revision: 1, ui_state: ui ?? emptyUiState(), ui_version: 0 })
    .select(COLS)
    .single();
  if (ins.error) throw mapDatabaseError(ins.error);
  const row = ins.data as Row;
  if (top.by === "model") await env.audit({ action: "experience.interpreted_by_model", objectType: "experience_session", objectId: row.id, result: "success", newState: { kind: top.kind, understood: top.understood } });
  return persistAndRespond(env, row, st, { bump: false, now, logger: deps.logger });
}

export async function startExperience(env: Env, deps: Deps, text: string, subject: SubjectRef | null, now = new Date()): Promise<ExperienceResponse> {
  if (subject) {
    // Started from a record already on screen: re-read under this session before it is used.
    const renew = await adoptSubject(env, initialRenewState("", null), subject);
    const top: TopIntent = { kind: "renew_policy", clientWords: "", coverWords: null, understood: cut(`Renew: ${subject.label ?? text}`, 200), by: "rules" };
    return create(env, deps, text, top, { by: "rules", understood: top.understood, directionChangedAt: null, lastActions: [], renew }, now);
  }
  const top = await interpretIntent(text, deps.provider, deps.logger);
  const base = stateFor(top, now);
  if (top.kind === "explore_policies") base.explore = await exploreFrom(env, top.text, now, base.explore!);
  return create(env, deps, text, top, { by: top.by, understood: top.understood, directionChangedAt: null, lastActions: [], ...base }, now);
}

export async function getExperience(env: Env, deps: Deps, id: string, now = new Date()): Promise<ExperienceResponse> {
  const row = await load(env, id);
  return persistAndRespond(env, row, row.intent, { bump: false, now, logger: deps.logger });
}

const BACK = /^\s*(go\s+)?back\b|\bprevious (view|comparison)\b|\bundo that\b/i;
const RESET = /\b(show|bring back) (everything|it all|the whole)\b|^\s*(reset|clear( the)? focus)\b/i;
const APPROVALS_ONLY = /\b(only|just|except)\b[^.]*\bapprov/i;

/** Asking inside an experience: refine it, change its direction, or open another (Back returns). */
export async function askExperience(env: Env, deps: Deps, id: string, text: string, now = new Date()): Promise<ExperienceResponse> {
  const row = await load(env, id);
  const st: Stored = { ...row.intent };
  const top = interpretRules(text);

  // A different intention opens its own experience; this one stays as it was.
  const otherClient = top?.kind === "renew_policy" && row.kind === "renew_policy" && top.clientWords && st.renew?.workItemId && !st.renew.clientWords.includes(top.clientWords) && splitRenewal(text).clientWords.split(" ").length > 0 && /\brenew\b/i.test(text);
  if (top && top.kind !== "unsupported" && row.kind !== "unsupported" && (top.kind !== row.kind || otherClient)) {
    const fresh = await startExperience(env, deps, text, null, now);
    return { ...fresh, redirect: fresh.spec.experienceId };
  }

  if (row.kind === "unsupported") {
    const reading = top ?? (await interpretIntent(text, deps.provider, deps.logger));
    const next: Stored = { by: reading.by, understood: reading.understood, directionChangedAt: now.toISOString(), lastActions: st.lastActions, ...stateFor(reading, now) };
    if (reading.kind === "explore_policies") next.explore = await exploreFrom(env, reading.text, now, next.explore!);
    await env.db.from("experience_sessions").update({ kind: reading.kind, expression: cut(text, 500) }).eq("organization_id", env.organizationId).eq("user_id", env.userId).eq("id", row.id);
    return persistAndRespond(env, { ...row, kind: reading.kind, expression: text }, next, { bump: true, now, logger: deps.logger, uiPatch: (u) => ({ ...u, ask: "" }) });
  }

  if (row.kind === "explore_policies") {
    const base = st.explore ?? { params: defaultExplore(now), selected: null, unclear: null };
    st.explore = await exploreFrom(env, text, now, base);
  } else if (row.kind === "renew_policy") {
    const r = st.renew ?? initialRenewState("", null);
    if (!r.workItemId && !r.policyId) {
      // Still finding what is meant: the words name the client and the cover.
      const s = splitRenewal(text);
      st.renew = { ...r, clientWords: s.clientWords || r.clientWords, coverWords: s.coverWords ?? r.coverWords, clientId: s.clientWords ? null : r.clientId };
    } else if (r.workItemId) {
      st.renew = await focusRenewal(env, deps, r, text);
    }
  } else if (row.kind === "create_client") {
    const refused = refusal(text);
    return persistAndRespond(env, row, st, { bump: true, now, logger: deps.logger, uiPatch: (u) => ({ ...u, ask: "" }) }).then((res) => ({
      ...res,
      spec: { ...res.spec, notices: [{ tone: "grey" as const, text: refused ?? "To add the client, fill in the form above; nothing is added until you press Add the client." }] },
    }));
  }
  return persistAndRespond(env, row, st, { bump: true, now, logger: deps.logger, uiPatch: (u) => ({ ...u, ask: "" }) });
}

async function focusRenewal(env: Env, deps: Deps, r: RenewState, text: string): Promise<RenewState> {
  if (BACK.test(text)) {
    // Back from a focus returns to the one before it, or to the whole renewal.
    if (!r.focus && !r.approvalsOnly) return { ...r, question: text, said: { text: "This is already the whole renewal.", refused: false } };
    const stack = [...r.focusStack];
    const prev = stack.pop() ?? null;
    return { ...r, focus: prev, focusStack: stack, approvalsOnly: false, question: null, said: null };
  }
  if (RESET.test(text)) return { ...r, focus: null, focusStack: r.focus ? [...r.focusStack, r.focus].slice(-8) : r.focusStack, approvalsOnly: false, question: null, said: null };
  if (APPROVALS_ONLY.test(text)) return { ...r, approvalsOnly: true, question: text, said: null, focusStack: r.focus ? [...r.focusStack, r.focus].slice(-8) : r.focusStack };
  const facts = await loadRenewalLivingFacts(env, r.workItemId!);
  const reading = await interpretWorkspace(text, "renewal", renewalVocabulary(facts), deps.provider, deps.logger);
  if (reading.source === "model") await env.audit({ action: "experience.interpreted_by_model", objectType: "work_item", objectId: r.workItemId, result: "success", newState: { focus: reading.focus } });
  if (!reading.focus || reading.focus.intent === "reset") {
    const refused = refusal(text);
    return { ...r, question: text, said: { text: cut(refused ?? reading.unclear ?? "ASAP could not tell what to bring forward. Try “compare the quotes”, “what is blocking this” or “show the evidence”.", 500), refused: !!refused } };
  }
  const focus: WorkspaceFocus = reading.focus;
  return { ...r, focus, focusStack: r.focus ? [...r.focusStack, r.focus].slice(-8) : r.focusStack, approvalsOnly: false, question: text, said: null };
}

export type EventBody =
  | { kind: "action_result"; action: string; ref: SubjectRef | null; outcome: "done" | "already" | "blocked" | "refused" }
  | { kind: "select"; ref: SubjectRef }
  | { kind: "deselect" };

/** A governed action finished, or a record was chosen: re-read what it names, then recompose. */
export async function experienceEvent(env: Env, deps: Deps, id: string, e: EventBody, now = new Date()): Promise<ExperienceResponse> {
  const row = await load(env, id);
  const st: Stored = { ...row.intent };
  if (e.kind === "action_result" && e.ref && (e.outcome === "done" || e.outcome === "already")) {
    if (row.kind === "create_client" && e.ref.type === "client") {
      const r = await env.db.from("clients").select("id").eq("organization_id", env.organizationId).eq("id", e.ref.id).is("deleted_at", null).maybeSingle();
      if (!r.data) throw new HttpError(404, "not_found", "That client is not available.");
      st.create = { stage: "created", name: st.create?.name ?? null, clientId: e.ref.id };
    } else if (row.kind === "renew_policy" && e.ref.type === "work_item") {
      st.renew = await adoptSubject(env, st.renew ?? initialRenewState("", null), e.ref);
    }
  } else if (e.kind === "select") {
    if (row.kind === "renew_policy") st.renew = await adoptSubject(env, st.renew ?? initialRenewState("", null), e.ref);
    else if (row.kind === "explore_policies" && e.ref.type === "policy_period") st.explore = { ...(st.explore ?? { params: defaultExplore(now), unclear: null, selected: null }), selected: e.ref.id };
  } else if (e.kind === "deselect" && row.kind === "explore_policies" && st.explore) {
    st.explore = { ...st.explore, selected: null };
  }
  return persistAndRespond(env, row, st, { bump: true, now, logger: deps.logger });
}

export async function saveUiState(env: Env, id: string, baseVersion: number, ui: ExperienceUiState): Promise<{ uiVersion: number; ui: ExperienceUiState; conflict: boolean }> {
  const row = await load(env, id);
  if (row.ui_version !== baseVersion) return { uiVersion: row.ui_version, ui: uiOf(row.ui_state), conflict: true };
  const u = await env.db
    .from("experience_sessions")
    .update({ ui_state: ui, ui_version: baseVersion + 1, updated_at: new Date().toISOString() })
    .eq("organization_id", env.organizationId)
    .eq("user_id", env.userId)
    .eq("id", id)
    .eq("ui_version", baseVersion)
    .select("ui_version")
    .maybeSingle();
  if (u.error) throw mapDatabaseError(u.error);
  if (!u.data) {
    const again = await load(env, id);
    return { uiVersion: again.ui_version, ui: uiOf(again.ui_state), conflict: true };
  }
  return { uiVersion: baseVersion + 1, ui, conflict: false };
}

export async function listExperiences(env: Env): Promise<ExperienceSummary[]> {
  const r = await env.db.from("experience_sessions").select("id, title, kind, progress, subjects, updated_at").eq("organization_id", env.organizationId).eq("user_id", env.userId).is("archived_at", null).order("updated_at", { ascending: false }).limit(20);
  if (r.error) throw mapDatabaseError(r.error);
  return ((r.data ?? []) as { id: string; title: string; kind: IntentKind; progress: ExperienceSummary["progress"]; subjects: SubjectRef[]; updated_at: string }[]).map((x) => ({
    id: x.id, title: cut(x.title, 200), kind: x.kind, progress: x.progress, primary: Array.isArray(x.subjects) && x.subjects[0] ? x.subjects[0] : null, updatedAt: x.updated_at,
  }));
}

export async function archiveExperience(env: Env, id: string): Promise<void> {
  await load(env, id);
  const u = await env.db.from("experience_sessions").update({ archived_at: new Date().toISOString() }).eq("organization_id", env.organizationId).eq("user_id", env.userId).eq("id", id);
  if (u.error) throw mapDatabaseError(u.error);
}
