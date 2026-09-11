import {
  AutomationTrigger,
  EXTERNALLY_SENDING_VERBS,
  type ActionVerb,
  type AutomationCardView,
  type CreateAutomationRequest,
} from "@asap/schema";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { MissingData } from "../components/states.js";
import { ScreenTitle } from "../shell/ScreenTitle.js";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { automationKeys, useAutomations } from "../lib/queries.js";
import { useQuery } from "@tanstack/react-query";
import { ErrorState, LoadingList } from "../components/states.js";
import { TRIGGER_LABELS, VERB_LABELS, automationCardFromRow } from "../live/adapters.js";

/**
 * Automations — what the brokerage has taught ASAP to watch for (D-064).
 *
 * Each one reads as the sentence it is: trigger, conditions, skills, prepared action, approval
 * rule, exception handling. The toggle writes to the brokerage's own record, and every firing is
 * listed — including the ones that decided to do nothing, because "why did nothing happen?" is the
 * question people actually have.
 *
 * The rule that does not bend: an automation prepares. Approval stays with a person for anything
 * that leaves the brokerage, and the card says so on its face.
 */
export function Automations() {
  const me = useMe();
  const navigate = useNavigate();
  const invalidate = useQueryClient();
  const [creating, setCreating] = useState(false);
  const orgId = me.data?.active_organization?.id;

  /* A real brokerage's standing instructions, and every firing counted from its own run rows. */
  const live = useAutomations(orgId);
  const create = useMutation({
    mutationFn: (input: CreateAutomationRequest) => api.createAutomation(input),
    onSuccess: () =>
      void invalidate.invalidateQueries({ queryKey: automationKeys.list(orgId ?? "none") }),
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.setAutomationEnabled(id, enabled),
    onSuccess: () =>
      void invalidate.invalidateQueries({ queryKey: automationKeys.list(orgId ?? "none") }),
  });

  const cards: AutomationCardView[] = (live.data?.automations ?? []).map((a) =>
    automationCardFromRow(a, undefined),
  );
  const active = cards.filter((c) => c.enabled).length;

  return (
    <>
      <ScreenTitle
        title="Automations"
        meta="Teach ASAP what to watch for and prepare"
        actions={
          <div className="top-actions">
            <button
              type="button"
              className="new-btn"
              aria-expanded={creating}
              onClick={() => setCreating((v) => !v)}
            >
              ＋ New automation
            </button>
          </div>
        }
      />

      <section className="page-scroll automation-page">
        <div className="automation-intro">
          <div>
            <span className="eyebrow">
              {active} ACTIVE AUTOMATION{active === 1 ? "" : "S"}
            </span>
            <h2>ASAP watches. Your team decides.</h2>
            <p>
              Automations prepare the next step using your records, documents and email.
              Consequential actions still wait for human approval.
            </p>
          </div>
          {/* The rule that does not bend, on the face of the screen rather than in a setting. */}
          <div className="safety-card">
            <span aria-hidden>✓</span>
            <div>
              <strong>Human approval is on</strong>
              <small>External messages and policy changes are never automatic.</small>
            </div>
          </div>
        </div>

        {creating && (
          <CreateLiveAutomation
            busy={create.isPending}
            error={create.isError ? describeApiError(create.error) : null}
            onCancel={() => setCreating(false)}
            onCreate={(input) =>
              create.mutate(input, {
                onSuccess: (res) => {
                  setCreating(false);
                  void navigate({ to: "/automations/$id", params: { id: res.automation.id } });
                },
              })
            }
          />
        )}

        {live.isPending && (
          <article className="automation-card">
            <h3>Reading your automations…</h3>
          </article>
        )}
        {live.isError && (
          <article className="automation-card">
            <h3>We could not read your automations.</h3>
            <p>{describeApiError(live.error)}</p>
            <footer>
              <span>Nothing has been changed</span>
              <button type="button" onClick={() => void live.refetch()}>
                Try again
              </button>
            </footer>
          </article>
        )}
        {toggle.isError && (
          <article className="warning">
            <strong>That switch did not take:</strong> {describeApiError(toggle.error)} The
            automation is still as it was.
          </article>
        )}

        <div className="automation-grid">
          {cards.map((c) => (
            <AutomationCard
              key={c.id}
              card={c}
              busy={toggle.isPending}
              onToggle={() => toggle.mutate({ id: c.id, enabled: !c.enabled })}
            />
          ))}
          <button type="button" className="new-automation" onClick={() => setCreating(true)}>
            <span aria-hidden>＋</span>
            <strong>Create an automation</strong>
            <small>Describe what ASAP should watch for</small>
          </button>
        </div>
      </section>
    </>
  );
}

/**
 * One automation on the grid, in the approved card: the icon and its switch, the name, one
 * sentence, the flow line from trigger to prepared step, and what it has done lately.
 *
 * The switch is the real state, and a paused card says it is paused rather than looking identical
 * to a running one.
 */
function AutomationCard({
  card,
  busy,
  onToggle,
}: {
  card: AutomationCardView;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <article className="automation-card" data-state={card.enabled ? "active" : "paused"}>
      <div className="auto-top">
        <span className="auto-icon" aria-hidden>
          {card.icon}
        </span>
        <label className="switch">
          <span className="sr-only">
            {card.enabled ? `Pause ${card.headline}` : `Switch on ${card.headline}`}
          </span>
          <input type="checkbox" checked={card.enabled} disabled={busy} onChange={onToggle} />
          <i aria-hidden />
        </label>
      </div>
      <h3>{card.headline}</h3>
      <p>{card.summary}</p>
      <div className="flow-line">
        <span>{card.flowFrom}</span>
        <b aria-hidden>→</b>
        <span>{card.flowTo}</span>
      </div>
      <footer>
        <span>{card.activity}</span>
        <Link to={card.href} className="link">
          Open
        </Link>
      </footer>
    </article>
  );
}

export function AutomationDetail() {
  const { id = "" } = useParams({ strict: false }) as { id?: string };
  const me = useMe();
  const orgId = me.data?.active_organization?.id;
  const invalidate = useQueryClient();
  const list = useAutomations(orgId);
  const runs = useQuery({
    queryKey: ["automation_runs", id],
    queryFn: () => api.automationRuns(id),
    enabled: Boolean(id),
    retry: false,
  });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => api.setAutomationEnabled(id, enabled),
    onSuccess: () =>
      void invalidate.invalidateQueries({ queryKey: automationKeys.list(orgId ?? "none") }),
  });

  if (list.isPending) return <LoadingList rows={3} label="Loading the automation" />;
  if (list.isError) {
    return (
      <ErrorState
        what={`We could not read your automations. ${describeApiError(list.error)}`}
        retry={() => void list.refetch()}
      />
    );
  }
  const a = list.data?.automations.find((x) => x.id === id);
  if (!a) {
    return (
      <MissingData
        what="No automation with that id"
        why="It may have been removed, or your role in this brokerage cannot see it."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <Link to="/automations" className="text-sm text-ink-secondary hover:underline">
          ← Automations
        </Link>
        <h1 className="font-heading text-xl font-semibold text-ink">{a.name}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-pill px-2.5 py-0.5 text-xs ${
              a.enabled ? "bg-accent-green-soft text-accent-green-ink" : "bg-wash text-ink-muted"
            }`}
          >
            {a.enabled ? "On" : "Paused"}
          </span>
          <button
            type="button"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(!a.enabled)}
            className="rounded-pill border border-line-strong px-3 py-0.5 text-xs text-ink-secondary hover:border-ink-muted"
          >
            {a.enabled ? "Pause" : "Switch on"}
          </button>
        </div>
        {toggle.isError && (
          <p role="alert" className="text-xs text-accent-red">
            That switch did not take: {describeApiError(toggle.error)} The automation is still as it
            was.
          </p>
        )}
      </header>

      <dl className="flex flex-col gap-3 rounded-card border border-line-strong bg-paper p-4">
        <Row label="Trigger">{TRIGGER_LABELS[a.trigger_event] ?? a.trigger_event}</Row>
        <Row label="Conditions">
          {a.conditions.length === 0 ? (
            "Every firing of the trigger."
          ) : (
            <ul className="list-disc pl-4">
              {a.conditions.map((c, i) => (
                <li key={i}>
                  {c.fact} {c.operator} {String(c.value)}
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row label="Skill ASAP uses">{a.skill}</Row>
        <Row label="Prepared action">{VERB_LABELS[a.prepared_verb] ?? a.prepared_verb}</Row>
        <Row label="Approval">
          {a.approval === "always" ? "A person approves every time." : "Runs unattended."}
        </Row>
        <Row label="Reaches outside the brokerage">
          {a.sends_externally
            ? "Yes — a person always approves before anything leaves."
            : "No. It only prepares work inside ASAP."}
        </Row>
      </dl>

      <section aria-label="Run history" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink">What it has done</h2>
        {runs.isPending && <p className="text-sm text-ink-muted">Reading its history…</p>}
        {runs.isError && (
          <p role="alert" className="text-sm text-accent-red">
            We could not read its history. {describeApiError(runs.error)}
          </p>
        )}
        {runs.data && runs.data.runs.length === 0 && (
          <p className="text-sm text-ink-muted">
            It has not fired yet. Every firing is recorded here, including the ones that decide to
            do nothing.
          </p>
        )}
        {runs.data && runs.data.runs.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {runs.data.runs.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-baseline gap-2 rounded-card border border-line-soft bg-paper px-3 py-2 text-sm"
              >
                <span className="text-ink">{OUTCOME_WORD[r.outcome] ?? r.outcome}</span>
                <span className="text-ink-secondary">
                  {r.reason ?? `Fired on ${r.event_name}.`}
                </span>
                <time className="ml-auto text-xs text-ink-muted" dateTime={r.started_at}>
                  {new Date(r.started_at).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** A firing's outcome, in the words a broker reads. The enum is a database value. */
const OUTCOME_WORD: Readonly<Record<string, string>> = {
  prepared: "Prepared an action",
  held_for_approval: "Waiting for approval",
  conditions_not_met: "Did nothing",
  skipped: "Did nothing",
  failed: "Could not finish",
};

/**
 * Teaching ASAP a new rule, in the sentence the automation actually is.
 *
 * It starts switched off and untested — nothing begins watching a brokerage's mail because
 * somebody filled in a form — and anything that reaches outside always needs a person.
 */

/**
 * The real automation builder.
 *
 * It offers only what it can honestly set: a name, a trigger from the events the system actually
 * emits, the step it should prepare, and whether a person approves. There is no free-text trigger
 * here — an instruction the engine cannot evaluate is not an instruction — and a new automation is
 * always created switched off, so nothing starts watching a brokerage's mail because a form was
 * submitted.
 *
 * Whether it reaches outside the brokerage is decided by the server from the verb, never sent from
 * the browser: a field the browser could set would be a way around §45 rule 13.
 */
function CreateLiveAutomation({
  busy,
  error,
  onCancel,
  onCreate,
}: {
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onCreate: (input: CreateAutomationRequest) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [triggerEvent, setTriggerEvent] = useState<AutomationTrigger>("document.received");
  const [preparedVerb, setPreparedVerb] = useState<ActionVerb>("prepare");

  const outward = EXTERNALLY_SENDING_VERBS.includes(preparedVerb);

  return (
    <form
      aria-label="New automation"
      className="automation-card"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({
          name,
          description,
          triggerEvent,
          conditions: [],
          /*
           * The named capability that will do the work. Until the skill catalogue in
           * docs/skill-map.md §2 is a typed enum, this records the step the person actually chose
           * rather than a capability name invented in the browser.
           */
          skill: preparedVerb,
          preparedVerb,
          approval: "always",
          enabled: false,
        });
      }}
    >
      <Field id="la-name" label="What should this be called?">
        <input
          id="la-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Monitor claims that have stopped moving"
          className="min-h-[38px] w-full rounded-control border border-line-strong px-3 text-sm"
        />
      </Field>
      <Field id="la-description" label="What is it for?">
        <input
          id="la-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Reconstruct the timeline and prepare a follow-up"
          className="min-h-[38px] w-full rounded-control border border-line-strong px-3 text-sm"
        />
      </Field>
      <Field id="la-trigger" label="When should it look?">
        <select
          id="la-trigger"
          value={triggerEvent}
          onChange={(e) => setTriggerEvent(e.target.value as AutomationTrigger)}
          className="min-h-[38px] w-full rounded-control border border-line-strong px-3 text-sm"
        >
          {AutomationTrigger.options.map((t) => (
            <option key={t} value={t}>
              {TRIGGER_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field id="la-verb" label="Then prepare…">
        <select
          id="la-verb"
          value={preparedVerb}
          onChange={(e) => setPreparedVerb(e.target.value as ActionVerb)}
          className="min-h-[38px] w-full rounded-control border border-line-strong px-3 text-sm"
        >
          {BUILDABLE_VERBS.map((v) => (
            <option key={v} value={v}>
              {VERB_LABELS[v] ?? v}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-xs text-ink-muted">
        {outward
          ? "This could reach a client or an insurer, so a person approves every time. That is not a setting."
          : "It prepares only. It cannot send, approve or decide, whatever it finds."}
      </p>
      {error && <p className="text-xs text-accent-red">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Creating…" : "Create, switched off"}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** The verbs a standing instruction may prepare. Approving and completing are a person's, always. */
const BUILDABLE_VERBS: readonly ActionVerb[] = [
  "prepare",
  "draft",
  "record_evidence",
  "record_send",
];

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs uppercase tracking-wide text-ink-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-[700px]:flex-row min-[700px]:gap-4">
      <dt className="w-44 shrink-0 text-xs uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-sm text-ink-secondary">{children}</dd>
    </div>
  );
}
