import {
  DEMO_NOTICE,
  demoClient,
  scenarioById,
  type DemoPanel,
  type DemoScenario,
} from "@asap/schema";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api, describeApiError } from "../lib/api.js";
import { AskThread } from "../shell/AskThread.js";
import { EvidenceConditionChip } from "../components/EvidenceCondition.js";
import { useDemo } from "../demo/state.js";
import { DemoBoundary } from "../demo/DemoBoundary.js";

/**
 * Ask ASAP, in full (D-064).
 *
 * The approved demo makes this the centre of the product, so it is a destination as well as the
 * composer docked on every other surface. What it must show, and does:
 *
 *   the context it is working in · the question · a concise answer · the reasoning ·
 *   follow-up questions · the generated Work panel · the evidence behind it · prepared actions
 *
 * The safety rules are unchanged from the real Ask (§45 rules 9, 10, 12). An answer never asserts
 * cover, an approval or a payment; evidence carries one of the six conditions rather than a
 * percentage; a prepared action is prepared, and a person does it.
 *
 * Two ways to answer, and the surface says which it used:
 *
 *  - **A configured model**, through the provider-neutral gateway. Grounded in declared tools,
 *    checked before it is shown, and able to abstain — the real path.
 *  - **The approved scenarios**, when no model is configured. The reasoning shown is the reasoning
 *    the demo was approved with, not a model's improvisation dressed up as one.
 *
 * A free question tries the model first and falls back to the scenarios, so the primary experience
 * is never empty. Which one answered is never hidden.
 */
export function Ask() {
  const { scenario: requested } = useSearch({ strict: false }) as { scenario?: string };
  const demo = useDemo();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const threadEnd = useRef<HTMLDivElement>(null);
  /** Turns answered by the configured model, newest last. Empty when none is configured. */
  const [liveTurns, setLiveTurns] = useState<
    { question: string; response: Awaited<ReturnType<typeof api.askQuestion>> | null }[]
  >([]);

  const live = useMutation({
    mutationFn: (question: string) =>
      api.askQuestion({ question, conversationId: null, scope: { kind: "brokerage", id: null } }),
    onSuccess: (res) =>
      setLiveTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.response === null) next[next.length - 1] = { ...last, response: res };
        return next;
      }),
    onError: () => setLiveTurns((prev) => prev.slice(0, -1)),
  });

  const activeId = requested ?? demo.activeScenarioId;
  const scenario = useMemo(
    () => scenarioById(activeId) ?? demo.scenarios[0],
    [activeId, demo.scenarios],
  );

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [scenario?.id]);

  if (!scenario) return null;
  const client = demoClient(scenario.clientId);

  function open(id: string) {
    void navigate({ to: "/ask", search: { scenario: id } });
    demo.setScenario(id);
  }

  function ask(e: FormEvent) {
    e.preventDefault();
    const question = typed.trim();
    if (!question) return;
    const q = question.toLowerCase();

    // An approved scenario is the better answer when one matches: it is the reasoning this demo
    // was signed off with, and it comes with its panel, evidence and prepared actions.
    const hit =
      demo.scenarios.find((s) => s.ask.toLowerCase().includes(q)) ??
      demo.scenarios.find((s) => s.name.toLowerCase().includes(q)) ??
      demo.scenarios.find((s) =>
        q.split(/\s+/).some((w) => w.length > 3 && s.ask.toLowerCase().includes(w)),
      );
    if (hit) {
      open(hit.id);
      setTyped("");
      return;
    }
    // Nothing matched. Ask the configured model, which grounds its answer in declared tools and
    // abstains when the evidence is not there. With none configured it returns not_configured,
    // and AskThread says so rather than showing an empty answer.
    setLiveTurns((prev) => [...prev, { question, response: null }]);
    live.mutate(question);
    setTyped("");
  }

  return (
    <div className="flex flex-col gap-4">
      <ContextChip scenario={scenario} clientName={client?.name ?? "Your brokerage"} />

      <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <section aria-label="Conversation" className="flex flex-col gap-3">
          <div className="flex items-center gap-2 border-b border-line-soft pb-2">
            <span aria-hidden className="text-lg text-accent-green">✦</span>
            <div>
              <p className="text-sm font-medium text-ink">Ask ASAP</p>
              <p className="text-xs text-ink-muted">
                {client ? `Working with ${client.shortName}` : "Working across the brokerage"}
              </p>
            </div>
          </div>

          <p className="self-end max-w-[85%] rounded-card bg-wash px-3 py-2 text-sm text-ink">
            {scenario.ask}
          </p>

          <div className="flex flex-col gap-2">
            <p className="text-base font-medium text-ink">{scenario.lead}</p>
            <p className="text-sm leading-relaxed text-ink-secondary">{scenario.text}</p>
          </div>

          {scenario.suggest.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {scenario.suggest.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    const next =
                      demo.scenarios.find((x) => x.name.toLowerCase() === s.toLowerCase()) ??
                      demo.scenarios.find((x) => x.ask.toLowerCase().includes(s.toLowerCase()));
                    if (next) open(next.id);
                  }}
                  className="rounded-pill border border-line-strong px-3 py-1 text-sm text-ink-secondary hover:border-ink-muted hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {liveTurns.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
              <p className="text-xs text-ink-muted">Asked of the brokerage's own records</p>
              <AskThread
                turns={liveTurns}
                pending={live.isPending}
                onRetry={() => {
                  const last = liveTurns[liveTurns.length - 1];
                  if (last) live.mutate(last.question);
                }}
              />
              {live.isError && (
                <p className="text-xs text-accent-red">{describeApiError(live.error)}</p>
              )}
            </div>
          )}

          <div ref={threadEnd} />

          <form onSubmit={ask} role="search" aria-label="Ask a question" className="mt-2 flex gap-2">
            <label htmlFor="ask-full" className="sr-only">
              Ask a question
            </label>
            <input
              id="ask-full"
              name="q"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Ask about a client, a policy, a claim or the brokerage…"
              className="min-h-[42px] flex-1 rounded-control border border-line-strong bg-paper px-3 text-sm text-ink"
            />
            <button
              type="submit"
              className="rounded-control bg-navy px-4 text-sm text-paper hover:bg-navy-hover"
            >
              Ask
            </button>
          </form>
          <DemoBoundary>
            {DEMO_NOTICE} Ask answers from the approved scenarios, not from a live model.
          </DemoBoundary>
        </section>

        <WorkPanel panel={scenario.panel} scenario={scenario} />
      </div>

      <ScenarioRail activeId={scenario.id} onOpen={open} />
    </div>
  );
}

function ContextChip({ scenario, clientName }: { scenario: DemoScenario; clientName: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-pill border border-line-strong bg-paper px-3 py-1.5 text-xs text-ink-secondary">
      <span className="font-medium text-ink">{clientName}</span>
      <span aria-hidden>·</span>
      <span>{scenario.group}</span>
      <span aria-hidden>·</span>
      <span>{scenario.name}</span>
    </div>
  );
}

/** The generated Work panel: facts, what is wrong, the evidence, and what can be prepared. */
function WorkPanel({ panel, scenario }: { panel: DemoPanel; scenario: DemoScenario }) {
  return (
    <aside
      aria-label="Generated work panel"
      className="flex h-fit flex-col gap-3 rounded-card border border-line-strong bg-paper p-4"
    >
      <div>
        <p className="text-[0.6875rem] font-semibold tracking-[0.12em] text-ink-muted">{panel.type}</p>
        <h2 className="font-heading text-base font-semibold text-ink">{panel.title}</h2>
        {panel.desc && <p className="text-sm text-ink-secondary">{panel.desc}</p>}
      </div>

      {panel.warning && (
        <p className="rounded-card border border-accent-gold bg-accent-gold-soft px-3 py-2 text-sm text-accent-gold-ink">
          {panel.warning}
        </p>
      )}

      {panel.facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-2">
          {panel.facts.map(([k, v]) => (
            <div key={k} className="rounded-card bg-wash px-2.5 py-2">
              <dt className="text-[0.6875rem] uppercase tracking-wide text-ink-muted">{k}</dt>
              <dd className="text-sm font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      {panel.issues.length > 0 && (
        <ul className="flex flex-col gap-2">
          {panel.issues.map(([tone, text, meta], i) => (
            <li
              key={i}
              className={`rounded-card border-l-2 bg-wash px-3 py-2 text-sm ${
                tone === "red"
                  ? "border-accent-red"
                  : tone === "green"
                    ? "border-accent-green"
                    : "border-accent-gold"
              }`}
            >
              <p className="text-ink">{text}</p>
              {meta && <p className="text-xs text-ink-muted">{meta}</p>}
            </li>
          ))}
        </ul>
      )}

      {panel.calc.length > 0 && (
        <table className="w-full text-sm">
          <caption className="sr-only">The calculation, line by line</caption>
          <tbody>
            {panel.calc.map(([label, value], i) => (
              <tr key={i} className="border-b border-line-soft last:border-0 last:font-medium">
                <th scope="row" className="py-1 text-left font-normal text-ink-secondary">
                  {label}
                </th>
                <td className="py-1 text-right tabular-nums text-ink">{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {panel.diff.length > 0 && (
        <dl className="flex flex-col gap-1.5">
          {panel.diff.map(([what, how], i) => (
            <div key={i} className="flex flex-wrap justify-between gap-2 text-sm">
              <dt className="text-ink-secondary">{what}</dt>
              <dd className="text-ink">{how}</dd>
            </div>
          ))}
        </dl>
      )}

      {panel.evidence.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-ink-muted">What this rests on</h3>
          <ul className="flex flex-col gap-1.5">
            {panel.evidence.map((e, i) => (
              <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-ink-secondary">
                  <span className="text-ink">{e.source}</span> — {e.finding}
                </span>
                <EvidenceConditionChip condition={e.state} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {panel.timeline.length > 0 && (
        <ol className="flex flex-col gap-1.5 text-sm">
          {panel.timeline.map(([when, what], i) => (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 text-ink-muted">{when}</span>
              <span className="text-ink-secondary">{what}</span>
            </li>
          ))}
        </ol>
      )}

      {panel.draft && (
        <section className="flex flex-col gap-1.5 rounded-card border border-line-soft bg-wash p-3">
          <h3 className="text-xs font-medium text-ink-muted">Prepared, not sent</h3>
          {panel.draft.to && (
            <p className="text-xs text-ink-secondary">
              <span className="text-ink-muted">To</span> {panel.draft.to}
            </p>
          )}
          {panel.draft.subject && <p className="text-sm font-medium text-ink">{panel.draft.subject}</p>}
          <p className="whitespace-pre-line text-sm text-ink-secondary">{panel.draft.body}</p>
          <Link
            to="/email"
            search={{ scenario: scenario.id }}
            className="self-start text-sm text-ink underline"
          >
            Open it in the mailbox to review and send
          </Link>
        </section>
      )}

      {panel.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {panel.actions.map((a) => (
            <Link
              key={a}
              to="/work"
              search={{ view: "active" }}
              className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-ink-muted"
            >
              {a}
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
}

/** Every scenario, grouped, so nothing in the approved catalogue is unreachable. */
function ScenarioRail({ activeId, onOpen }: { activeId: string; onOpen: (id: string) => void }) {
  const demo = useDemo();
  const groups = useMemo(() => {
    const out: { group: string; items: DemoScenario[] }[] = [];
    for (const s of demo.scenarios) {
      const g = out.find((x) => x.group === s.group);
      if (g) g.items.push(s);
      else out.push({ group: s.group, items: [s] });
    }
    return out;
  }, [demo.scenarios]);

  return (
    <section aria-label="Scenarios" className="flex flex-col gap-2 border-t border-line-soft pt-3">
      <h2 className="text-xs font-medium text-ink-muted">Everything ASAP can show you</h2>
      <div className="flex flex-col gap-2">
        {groups.map((g) => (
          <div key={g.group} className="flex flex-wrap items-center gap-1.5">
            <span className="w-full text-[0.6875rem] uppercase tracking-wide text-ink-muted min-[700px]:w-auto min-[700px]:pr-2">
              {g.group}
            </span>
            {g.items.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onOpen(s.id)}
                aria-current={s.id === activeId ? "true" : undefined}
                className={`rounded-pill px-2.5 py-1 text-xs ${
                  s.id === activeId
                    ? "bg-navy text-paper"
                    : "border border-line-strong text-ink-secondary hover:border-ink-muted"
                }`}
              >
                {s.name}
              </button>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
