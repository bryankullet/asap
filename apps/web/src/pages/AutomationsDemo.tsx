import { DEMO_NOTICE, type DemoAutomation } from "@asap/schema";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
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
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-semibold text-ink">Automations</h1>
          <p className="text-sm text-ink-secondary">
            Standing instructions: when this happens, and these are true, prepare that. None of them
            sends, approves or decides anything by itself.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          aria-expanded={creating}
          className="rounded-control bg-navy px-3 py-1.5 text-sm text-paper hover:bg-navy-hover"
        >
          Teach ASAP something new
        </button>
      </header>

      {creating && (
        <CreateAutomation
          onCancel={() => setCreating(false)}
          onCreate={(draft) => {
            const id = demo.createAutomation(draft);
            setCreating(false);
            void navigate({ to: "/automations/$id", params: { id } });
          }}
        />
      )}

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
  const navigate = useNavigate();
  const [testResult, setTestResult] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftAction, setDraftAction] = useState("");
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
          <button
            type="button"
            onClick={() => setTestResult(demo.testAutomation(a.id))}
            className="rounded-pill border border-line-strong px-3 py-0.5 text-xs text-ink-secondary hover:border-ink-muted"
          >
            Test it
          </button>
          <button
            type="button"
            onClick={() => {
              setDraftAction(a.preparedAction);
              setEditing((v) => !v);
            }}
            aria-expanded={editing}
            className="rounded-pill border border-line-strong px-3 py-0.5 text-xs text-ink-secondary hover:border-ink-muted"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              demo.deleteAutomation(a.id);
              void navigate({ to: "/automations" });
            }}
            className="rounded-pill border border-line-strong px-3 py-0.5 text-xs text-accent-red hover:border-accent-red"
          >
            Delete
          </button>
        </div>
      </header>

      {/* A test says what it *would* prepare. It never performs the action. */}
      {testResult && (
        <p role="status" className="rounded-card border border-line-soft bg-wash px-3 py-2 text-sm text-ink-secondary">
          {testResult}
        </p>
      )}

      {editing && (
        <form
          aria-label="Edit automation"
          className="flex flex-col gap-2 rounded-card border border-line-strong bg-paper p-4"
          onSubmit={(e) => {
            e.preventDefault();
            demo.updateAutomation(a.id, {
              preparedAction: draftAction,
              // Editing what it prepares invalidates the last test. Saying so beats a stale pass.
              lastTest: "Not tested since the last change",
            });
            setEditing(false);
          }}
        >
          <label htmlFor="edit-action" className="text-xs uppercase tracking-wide text-ink-muted">
            Then prepare…
          </label>
          <input
            id="edit-action"
            value={draftAction}
            onChange={(e) => setDraftAction(e.target.value)}
            className="min-h-[38px] rounded-control border border-line-strong px-3 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-control bg-navy px-3 py-1.5 text-sm text-paper hover:bg-navy-hover"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

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

/**
 * Teaching ASAP a new rule, in the sentence the automation actually is.
 *
 * It starts switched off and untested — nothing begins watching a brokerage's mail because
 * somebody filled in a form — and anything that reaches outside always needs a person.
 */
function CreateAutomation({
  onCancel,
  onCreate,
}: {
  onCancel: () => void;
  onCreate: (draft: Omit<DemoAutomation, "id" | "runs" | "lastTest">) => void;
}) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("A client email arrives");
  const [condition, setCondition] = useState("");
  const [action, setAction] = useState("");
  const [external, setExternal] = useState(true);

  return (
    <form
      aria-label="New automation"
      className="flex flex-col gap-3 rounded-card border border-line-strong bg-paper p-4"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate({
          name,
          enabled: false,
          trigger,
          conditions: condition ? [condition] : [],
          skills: ["email.classify", "policy.match"],
          preparedAction: action,
          // The rule that does not bend: anything outward-facing waits for a person.
          approval: external
            ? "A person approves before anything leaves the brokerage"
            : "Prepares without asking. It still cannot send, approve or decide.",
          exceptionHandling: "If ASAP is unsure, it raises it for a person rather than guessing",
        });
      }}
    >
      <Field id="a-name" label="What should this be called?">
        <input
          id="a-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Monitor claims that have stopped moving"
          className="min-h-[38px] w-full rounded-control border border-line-strong px-3 text-sm"
        />
      </Field>
      <Field id="a-trigger" label="When should it look?">
        <select
          id="a-trigger"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value)}
          className="min-h-[38px] w-full rounded-control border border-line-strong px-3 text-sm"
        >
          {[
            "A client email arrives",
            "An insurer sends terms",
            "A claim has no recorded movement for five days",
            "A policy period is 60 days from its end",
            "An insurer statement is received",
            "A payment lands",
          ].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </Field>
      <Field id="a-condition" label="Only when…">
        <input
          id="a-condition"
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder="The client has an active policy"
          className="min-h-[38px] w-full rounded-control border border-line-strong px-3 text-sm"
        />
      </Field>
      <Field id="a-action" label="Then prepare…">
        <input
          id="a-action"
          required
          value={action}
          onChange={(e) => setAction(e.target.value)}
          placeholder="Open claim work and draft the notification"
          className="min-h-[38px] w-full rounded-control border border-line-strong px-3 text-sm"
        />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ink-secondary">
        <input
          type="checkbox"
          checked={external}
          onChange={(e) => setExternal(e.target.checked)}
        />
        This could reach a client or an insurer
      </label>
      {external && (
        <p className="text-xs text-ink-muted">
          Then a person approves every time. That is not a setting.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className="rounded-control bg-navy px-3 py-1.5 text-sm text-paper hover:bg-navy-hover"
        >
          Create, switched off
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
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
