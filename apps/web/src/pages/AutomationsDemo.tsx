import { DEMO_NOTICE, type DemoAutomation } from "@asap/schema";
import { Link, useParams } from "@tanstack/react-router";
import { MissingData } from "../components/states.js";
import { DemoBoundary } from "../demo/DemoBoundary.js";
import { useDemo } from "../demo/state.js";

/**
 * Automations — what the brokerage has taught ASAP to watch for (D-064).
 *
 * Each one reads as the sentence it is: trigger, conditions, skills, prepared action, approval
 * rule, exception handling. The toggle is real within the demo, and every run is listed —
 * including the ones that decided to do nothing, because "why did nothing happen?" is the
 * question people actually have.
 *
 * The rule that does not bend: an automation prepares. Approval stays with a person for anything
 * that leaves the brokerage, and the card says so on its face.
 */
export function AutomationsDemo() {
  const demo = useDemo();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-ink">Automations</h1>
        <p className="text-sm text-ink-secondary">
          Standing instructions: when this happens, and these are true, prepare that. None of them
          sends, approves or decides anything by itself.
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {demo.automations.map((a) => (
          <li key={a.id}>
            <AutomationCard automation={a} onToggle={() => demo.toggleAutomation(a.id)} />
          </li>
        ))}
      </ul>

      <DemoBoundary>{DEMO_NOTICE} Switching one on changes demonstration state only.</DemoBoundary>
    </div>
  );
}

function AutomationCard({
  automation,
  onToggle,
}: {
  automation: DemoAutomation;
  onToggle: () => void;
}) {
  return (
    <article className="flex flex-col gap-2 rounded-card border border-line-strong bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link
          to="/automations/$id"
          params={{ id: automation.id }}
          className="font-medium text-ink hover:underline"
        >
          {automation.name}
        </Link>
        <span
          className={`rounded-pill px-2.5 py-0.5 text-xs ${
            automation.enabled
              ? "bg-accent-green-soft text-accent-green-ink"
              : "bg-wash text-ink-muted"
          }`}
        >
          {automation.enabled ? "On" : "Paused"}
        </span>
      </div>
      <p className="text-sm text-ink-secondary">
        When {automation.trigger.toLowerCase()}, prepare: {automation.preparedAction.toLowerCase()}.
      </p>
      <p className="text-xs text-ink-muted">{automation.approval}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={automation.enabled}
          className="rounded-pill border border-line-strong px-3 py-1 text-sm text-ink-secondary hover:border-ink-muted"
        >
          {automation.enabled ? "Pause" : "Switch on"}
        </button>
        <Link
          to="/automations/$id"
          params={{ id: automation.id }}
          className="text-sm text-ink-secondary hover:underline"
        >
          Detail and history
        </Link>
      </div>
    </article>
  );
}

export function AutomationDemoDetail() {
  const { id = "" } = useParams({ strict: false }) as { id?: string };
  const demo = useDemo();
  const a = demo.automations.find((x) => x.id === id);
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
            onClick={() => demo.toggleAutomation(a.id)}
            className="rounded-pill border border-line-strong px-3 py-0.5 text-xs text-ink-secondary hover:border-ink-muted"
          >
            {a.enabled ? "Pause" : "Switch on"}
          </button>
        </div>
      </header>

      <dl className="flex flex-col gap-3 rounded-card border border-line-strong bg-paper p-4">
        <Row label="Trigger">{a.trigger}</Row>
        <Row label="Conditions">
          <ul className="list-disc pl-4">
            {a.conditions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Row>
        <Row label="Skills ASAP uses">{a.skills.join(" · ")}</Row>
        <Row label="Prepared action">{a.preparedAction}</Row>
        <Row label="Approval">{a.approval}</Row>
        <Row label="If something is wrong">{a.exceptionHandling}</Row>
        <Row label="Last test">{a.lastTest}</Row>
      </dl>

      <section aria-label="Run history" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink">What it has done</h2>
        {a.runs.length === 0 ? (
          <p className="text-sm text-ink-muted">
            It has not fired yet. Every firing is recorded here, including the ones that decide to
            do nothing.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {a.runs.map((r, i) => (
              <li
                key={i}
                className="flex flex-wrap items-baseline gap-2 rounded-card border border-line-soft bg-paper px-3 py-2 text-sm"
              >
                <span className="text-ink">{r.outcome}</span>
                <span className="text-ink-secondary">{r.detail}</span>
                <span className="ml-auto text-xs text-ink-muted">{r.at}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DemoBoundary>{DEMO_NOTICE}</DemoBoundary>
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
