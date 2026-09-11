import type { Automation, AutomationRun, ConditionResult } from "@asap/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { EmptyState, ErrorState, LoadingList, MissingData } from "../components/states.js";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";

/**
 * A01. The brokerage's standing instructions.
 *
 * What this surface has to make obvious, because it is the screen a person decides whether to
 * trust automation from:
 *
 *  - **What each one will do**, in words: when this happens, and these are true, prepare that.
 *  - **That it prepares rather than acts.** Everything outward-facing says so on its face.
 *  - **What it actually did**, including the times it did nothing and why. A firing that fell
 *    through its conditions is history too, and hiding it is how people stop trusting the feature.
 */
export function Automations() {
  const me = useMe();
  const org = me.data?.active_organization;
  const automations = useQuery({ queryKey: ["automations"], queryFn: api.automations });

  if (automations.isPending) return <LoadingList rows={3} label="Loading automations" />;
  if (automations.isError) {
    return <ErrorState what="Automations could not load" retry={() => void automations.refetch()} />;
  }
  if (automations.data.automations.length === 0) {
    return (
      <EmptyState
        scope={`automations for ${org?.name ?? "your brokerage"}`}
        freshness="Nothing is switched on. Automations prepare work for you to approve; anything that reaches outside the brokerage always needs a person."
      />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-xl font-medium text-ink">Automations</h1>
      <p className="text-sm text-ink-secondary">
        Each one watches for something and prepares the next step. None of them send, approve or
        decide anything by itself.
      </p>
      <ul className="flex flex-col gap-2">
        {automations.data.automations.map((a) => (
          <li key={a.id}>
            <AutomationCard automation={a} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function AutomationCard({ automation }: { automation: Automation }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => api.setAutomationEnabled(automation.id, !automation.enabled),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["automations"] }),
  });

  return (
    <article className="flex flex-col gap-2 rounded-card border border-line-strong bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <Link
            to="/automations/$id"
            params={{ id: automation.id }}
            className="font-medium text-ink hover:underline"
          >
            {automation.name}
          </Link>
          <p className="text-sm text-ink-secondary">{describe(automation)}</p>
        </div>
        <span
          className={`rounded-pill px-2.5 py-0.5 text-xs ${
            automation.enabled
              ? "bg-accent-green-soft text-accent-green-ink"
              : "bg-wash text-ink-muted"
          }`}
        >
          {automation.enabled ? "On" : "Off"}
        </span>
      </div>

      {/* Said on its face, not buried in a settings panel. */}
      <p className="text-xs text-ink-muted">
        {automation.approval === "always"
          ? "Prepares only. You approve before anything happens."
          : "Prepares the step without asking. It still cannot send, approve or decide."}
      </p>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => toggle.mutate()}
          disabled={toggle.isPending}
          aria-pressed={automation.enabled}
          className="rounded-pill border border-line-strong px-3 py-1 text-sm text-ink-secondary hover:border-ink-muted disabled:opacity-60"
        >
          {automation.enabled ? "Switch off" : "Switch on"}
        </button>
        <Link
          to="/automations/$id"
          params={{ id: automation.id }}
          className="text-sm text-ink-secondary hover:underline"
        >
          History
        </Link>
        {toggle.isError && (
          <span className="text-xs text-accent-red">{describeApiError(toggle.error)}</span>
        )}
      </div>
    </article>
  );
}

/** The instruction in one sentence, from its own fields. Never a stored description to drift. */
function describe(a: Automation): string {
  const when = EVENT_WORDS[a.trigger_event] ?? a.trigger_event;
  const conditions =
    a.conditions.length === 0
      ? ""
      : ` and ${a.conditions
          .map((c) =>
            // `equals` contributes no word of its own — "the work is a renewal" reads better than
            // "the work is a equals renewal" — so the parts are joined and the gaps collapsed.
            [
              FACT_WORDS[c.fact] ?? c.fact,
              OPERATOR_WORDS[c.operator] ?? c.operator,
              Array.isArray(c.value) ? c.value.join(" or ") : (c.value ?? ""),
            ]
              .join(" ")
              .replace(/\s+/g, " ")
              .trim(),
          )
          .join(", and ")}`;
  return `When ${when}${conditions}, prepare to ${VERB_WORDS[a.prepared_verb] ?? a.prepared_verb}.`;
}

const EVENT_WORDS: Record<string, string> = {
  "quote.received": "an insurer sends terms",
  "renewal.approaching": "a renewal comes into range",
  "document.received": "a document arrives",
  "payment.received": "a payment lands",
  "cover.confirmed": "an insurer confirms cover",
  "claim.registered": "a claim is registered",
  "check.overdue": "a check falls due",
  "run.could_not_finish": "ASAP could not finish something",
};
const FACT_WORDS: Record<string, string> = {
  task_status: "the item is",
  cover_status: "cover is",
  money_status: "the premium is",
  kind: "the work is a",
  class_of_business: "the class is",
  insurer_name: "the insurer is",
  client_file_status: "the client file is",
  period_end: "the period ends",
  last_touched: "it was last touched",
  exception: "the exception is",
};
const OPERATOR_WORDS: Record<string, string> = {
  equals: "",
  not_equals: "is not",
  is_one_of: "one of",
  is_empty: "not set",
  is_not_empty: "set",
  days_until_less_than: "within days:",
  days_since_more_than: "more days ago than:",
};
const VERB_WORDS: Record<string, string> = {
  prepare: "read the record and get the next step ready",
  draft: "write a draft for you to send",
  record_evidence: "record what the other party sent",
  record_send: "record that it was sent",
  assign: "change who owns it",
  complete: "close the item",
  open: "open the record",
  approve: "put an approval in front of you",
  resolve: "put a conflict in front of you",
  exception: "record an exception",
};

export function AutomationDetail() {
  const { id = "" } = useParams({ strict: false }) as { id?: string };
  const automations = useQuery({ queryKey: ["automations"], queryFn: api.automations });
  const runs = useQuery({
    queryKey: ["automation-runs", id],
    queryFn: () => api.automationRuns(id),
    enabled: id.length > 0,
  });

  if (automations.isPending) return <LoadingList rows={2} label="Loading automation" />;
  const automation = automations.data?.automations.find((a) => a.id === id);
  if (!automation) {
    return (
      <MissingData
        what="No automation with that id"
        why="It may have been removed, or your role in this brokerage cannot see it. Nothing is hidden on purpose without saying so."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-medium text-ink">{automation.name}</h1>
        <p className="text-sm text-ink-secondary">{describe(automation)}</p>
        {automation.description && (
          <p className="text-sm text-ink-muted">{automation.description}</p>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink">What it has done</h2>
        {runs.isPending && <LoadingList rows={2} label="Loading history" />}
        {runs.isError && <ErrorState what="The history could not load" retry={() => void runs.refetch()} />}
        {runs.data?.runs.length === 0 && (
          <p className="text-sm text-ink-muted">
            It has not fired yet. Every firing is recorded here, including the ones that decide to
            do nothing.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {runs.data?.runs.map((run) => (
            <li key={run.id}>
              <RunRow run={run} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function RunRow({ run }: { run: AutomationRun }) {
  return (
    <article className="flex flex-col gap-1 rounded-card border border-line-soft bg-paper p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink">{OUTCOME_WORDS[run.outcome] ?? run.outcome}</span>
        <span className="text-xs text-ink-muted">{new Date(run.started_at).toLocaleString()}</span>
        {run.work_item_id && (
          <Link
            to="/r/$recordId"
            params={{ recordId: run.work_item_id }}
            className="text-xs text-ink-secondary hover:underline"
          >
            Open the work
          </Link>
        )}
      </div>
      {run.reason && <p className="text-ink-secondary">{run.reason}</p>}
      {/* Why it did nothing is the part people actually need. */}
      {run.outcome === "conditions_not_met" && run.condition_results.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-ink-muted">
          {run.condition_results.map((c: ConditionResult, i: number) => (
            <li key={i}>
              {c.held ? "✓" : "✗"} {FACT_WORDS[c.fact] ?? c.fact}{" "}
              {c.actual === null ? "not set" : c.actual}
              {c.held ? "" : ` — expected ${Array.isArray(c.expected) ? c.expected.join(" or ") : String(c.expected)}`}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

const OUTCOME_WORDS: Record<string, string> = {
  working: "Working",
  prepared: "Prepared the step",
  conditions_not_met: "Did nothing — the conditions did not hold",
  needs_approval: "Prepared something for you to approve",
  exception: "Stopped and raised an exception",
  could_not_finish: "Could not finish",
};
