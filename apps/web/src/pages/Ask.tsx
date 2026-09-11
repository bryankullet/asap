import { scenarioById, type DemoPanel } from "@asap/schema";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, describeApiError } from "../lib/api.js";
import { useDemo } from "../demo/state.js";

/**
 * Ask ASAP, ported from the approved demo (D-064).
 *
 * The demo's own structure, rule for rule: a crumb topbar, the policy strip naming the record the
 * question is being asked inside, then the two-column `.workspace` — the conversation on the left
 * with its head, thread and docked composer, and the generated Work panel on the right.
 *
 * The panel body is built in the demo's order, which is the order a person reads it in:
 *
 *   facts · attention · current state · the calculation · meaningful changes · what happened ·
 *   the evidence · the prepared draft · the prepared actions
 *
 * Note `.issue`: the demo puts the **meta** in the `<h4>` and the **sentence** in the `<p>`, so the
 * severity reads first. That is not a transcription slip, it is the design.
 *
 * The safety rules are unchanged (§45 rules 9, 10, 12). An answer never asserts cover, an approval
 * or a payment; evidence carries a condition rather than a percentage; a prepared action is
 * prepared, and a person performs it.
 *
 * Two ways to answer, and the surface says which it used:
 *
 *  - **A configured model**, through the provider-neutral gateway — grounded in declared tools,
 *    checked before it is shown, and able to abstain.
 *  - **The approved scenarios**, when no model is configured. The reasoning shown is the reasoning
 *    the demo was approved with, not a model's improvisation dressed up as one.
 */
type AskAnswer = Awaited<ReturnType<typeof api.askQuestion>>;
type LiveTurnState = { question: string; response: AskAnswer | null };

export function Ask() {
  const { scenario: requested } = useSearch({ strict: false }) as { scenario?: string };
  const demo = useDemo();
  const navigate = useNavigate();
  const thread = useRef<HTMLDivElement>(null);

  const activeId = requested ?? demo.activeScenarioId;
  const scenario = useMemo(
    () => scenarioById(activeId) ?? demo.scenarios[0],
    [activeId, demo.scenarios],
  );

  /**
   * The demo pre-fills the composer with the question it is answering, so a person can edit and
   * re-ask it. Typing replaces it; changing scenario restores it.
   */
  const [typed, setTyped] = useState(scenario?.ask ?? "");
  const askText = scenario?.ask;
  useEffect(() => {
    setTyped(askText ?? "");
  }, [askText]);

  /** Turns answered by the configured model, newest last. Empty when none is configured. */
  const [liveTurns, setLiveTurns] = useState<LiveTurnState[]>([]);

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

  /**
   * The demo keeps the newest turn in view by setting the thread's own scrollTop. Doing it with
   * `scrollIntoView` on a trailing sentinel instead scrolls every scrollable ancestor, which left
   * the thread scrolled at viewports where the conversation actually fits.
   */
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeId, liveTurns.length]);

  if (!scenario) return null;
  const ctx = scenario.context;

  function open(id: string) {
    void navigate({ to: "/ask", search: { scenario: id } });
    demo.setScenario(id);
    setLiveTurns([]);
  }

  function askModel(question: string) {
    setLiveTurns((prev) => [...prev, { question, response: null }]);
    live.mutate(question);
  }

  function submit(e: FormEvent | KeyboardEvent) {
    e.preventDefault();
    const question = typed.trim();
    if (!question) return;
    const q = question.toLowerCase();

    // An approved scenario is the better answer when one matches: it is the reasoning this demo
    // was signed off with, and it arrives with its panel, evidence and prepared actions.
    const hit =
      demo.scenarios.find((s) => s.ask.toLowerCase() === q) ??
      demo.scenarios.find((s) => s.ask.toLowerCase().includes(q)) ??
      demo.scenarios.find((s) => s.name.toLowerCase().includes(q)) ??
      demo.scenarios.find((s) =>
        q.split(/\s+/).some((w) => w.length > 3 && s.ask.toLowerCase().includes(w)),
      );
    if (hit) {
      open(hit.id);
      return;
    }
    // Nothing matched. Ask the configured model, which grounds its answer in declared tools and
    // abstains when the evidence is not there. With none configured it answers not_configured,
    // and the thread says so rather than showing an empty answer.
    askModel(question);
    setTyped("");
  }

  return (
    <>
      <header className="topbar">
        <div className="crumbs">
          <span>Policies</span>
          <b>/</b>
          <strong>{ctx.title}</strong>
        </div>
        <div className="top-actions">
          {/* One text node each, as the original has them: a flex gap changes both widths. */}
          <Link to="/search" search={{ q: "" }} className="icon-btn" aria-label="Search">
            ⌕
          </Link>
          <Link to="/new" className="new-btn">
            ＋ New
          </Link>
        </div>
      </header>

      <section className="policy-strip" aria-label="The record this question is about">
        <div className="client-logo" aria-hidden>
          {ctx.initials}
        </div>
        <div className="policy-title">
          <div className="eyebrow">{ctx.client}</div>
          <h1>{ctx.title}</h1>
          <div className="policy-meta">
            <span>{ctx.number}</span>
            <i aria-hidden />
            <span>{ctx.insurer}</span>
            <i aria-hidden />
            <span>{ctx.period}</span>
          </div>
        </div>
        <div className="policy-facts">
          {ctx.facts.map(([label, value]) => (
            <div key={label}>
              <small>{label}</small>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <Link to="/audit" className="more-btn" aria-label="Everything recorded about this record">
          •••
        </Link>
      </section>

      <section className="workspace">
        <div className="conversation">
          <div className="conversation-head">
            <div>
              <span className="asap-orb" aria-hidden>
                ✦
              </span>
              <div>
                <strong>Ask ASAP</strong>
                <small>Working with {ctx.client.replace(/ LTD| LIMITED/, "")} context</small>
              </div>
            </div>
            <button type="button" onClick={() => setLiveTurns([])}>
              ＋ New thread
            </button>
          </div>

          <div className="thread" ref={thread}>
            <div className="message user">
              <div className="bubble">{scenario.ask}</div>
              <div className="mini-avatar" aria-hidden>
                GW
              </div>
            </div>
            <div className="message ai">
              <div className="mini-avatar" aria-hidden>
                ✦
              </div>
              <div className="bubble">
                <p className="answer-lead">{scenario.lead}</p>
                <p>{scenario.text}</p>
                <div className="inline-status">
                  <span className="pill good">Policy context matched</span>
                  <span className="pill">Evidence retained</span>
                  {(scenario.name.includes("Coverage") || scenario.name.includes("Claim")) && (
                    <span className="pill high">Human decision required</span>
                  )}
                </div>
                <Link to="/audit" className="source-link">
                  ▱ View reasoning and sources
                </Link>
              </div>
            </div>

            {liveTurns.map((turn, i) => (
              <LiveTurn key={i} turn={turn} />
            ))}
            {live.isPending && (
              <div className="message ai">
                <div className="mini-avatar" aria-hidden>
                  ✦
                </div>
                <div className="bubble thinking">
                  <i aria-hidden />
                  <i aria-hidden />
                  <i aria-hidden />
                  <span>Reading permitted records, documents and email…</span>
                </div>
              </div>
            )}
            {live.isError && (
              <div className="message ai">
                <div className="mini-avatar" aria-hidden>
                  ✦
                </div>
                <div className="bubble">
                  <p>{describeApiError(live.error)}</p>
                  <button
                    type="button"
                    className="source-link"
                    onClick={() => {
                      const last = liveTurns[liveTurns.length - 1];
                      if (last) live.mutate(last.question);
                    }}
                  >
                    Try that question again
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="composer-wrap">
            <div className="context-chip">
              <span aria-hidden>{ctx.initials}</span>{" "}
              {ctx.client.replace(/ LTD| LIMITED| EXPORTERS/, "")} · {ctx.title}{" "}
              <button type="button" aria-label="Change context" onClick={() => open(scenario.id)}>
                ×
              </button>
            </div>
            <form className="composer" onSubmit={submit}>
              <label htmlFor="ask-input" className="sr-only">
                Ask anything about this policy
              </label>
              <textarea
                id="ask-input"
                rows={1}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) submit(e);
                }}
                placeholder="Ask anything about this policy…"
              />
              <button type="button" className="attach" aria-label="Attach">
                ⌕
              </button>
              <button type="submit" className="send" aria-label="Send">
                ↑
              </button>
            </form>
            <div className="suggestions">
              {scenario.suggest.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    const next =
                      demo.scenarios.find((x) => x.ask.toLowerCase() === s.toLowerCase()) ??
                      demo.scenarios.find((x) => x.name.toLowerCase() === s.toLowerCase());
                    if (next) open(next.id);
                    else askModel(s);
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <small className="disclaimer">
              ASAP can make mistakes. Important decisions always stay with you.
            </small>
          </div>
        </div>

        <aside className="space-panel" aria-label="Generated work">
          <WorkPanel panel={scenario.panel} />
        </aside>
      </section>
    </>
  );
}

/** A question answered by the configured model, in the demo's own message shape. */
function LiveTurn({ turn }: { turn: LiveTurnState }) {
  const response = turn.response;
  const message = response?.message ?? null;
  /** The first paragraph leads; the rest is the reasoning. The server wrote both. */
  const paragraphs = message ? message.body.split(/\n{2,}/).filter(Boolean) : [];
  const [lead, ...rest] = paragraphs;
  const abstained = message?.abstained ?? null;

  return (
    <>
      <div className="message user">
        <div className="bubble">{turn.question}</div>
        <div className="mini-avatar" aria-hidden>
          GW
        </div>
      </div>
      {response && (
        <div className="message ai">
          <div className="mini-avatar" aria-hidden>
            ✦
          </div>
          <div className="bubble">
            {lead && <p className="answer-lead">{lead}</p>}
            {rest.map((paragraph, i) => (
              <p key={i}>{paragraph}</p>
            ))}
            {!message && (
              <p className="answer-lead">
                {response.state === "not_configured"
                  ? "Ask is not configured to answer freely on this server yet. The approved questions below still answer in full."
                  : "Ask could not answer that from the permitted records."}
              </p>
            )}
            {abstained && abstained.missing.length > 0 && (
              <p>Still missing: {abstained.missing.join(", ")}.</p>
            )}
            <div className="inline-status">
              <span className="pill">Answered from permitted records</span>
              {abstained && <span className="pill medium">Evidence incomplete</span>}
              {message?.served_by && <span className="pill good">{message.served_by}</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * The generated Work panel — the demo's `.space-card`, built in its own order. Every business
 * value here comes from the fixture, never from model text (§45 rule 9).
 */
function WorkPanel({ panel }: { panel: DemoPanel }) {
  return (
    <article className="space-card">
      <div className="space-head">
        <div className="space-type">
          <span>{panel.type}</span>
          <span className="live">● Live</span>
        </div>
        <h2>{panel.title}</h2>
        <p>{panel.desc}</p>
      </div>
      <div className="space-body">
        {panel.facts.length > 0 && (
          <div className="fact-grid">
            {panel.facts.map(([label, value]) => (
              <div className="fact" key={label}>
                <small>{label}</small>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        )}

        {panel.warning && (
          <div className="warning">
            <strong>Attention:</strong> {panel.warning}
          </div>
        )}

        {panel.issues.length > 0 && (
          <>
            <div className="section-label">Current state</div>
            {panel.issues.map(([tone, text, meta], i) => (
              <div className={`issue ${tone}`} key={i}>
                <span className="sev" aria-hidden />
                <div>
                  <h4>{meta}</h4>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </>
        )}

        {panel.calc.length > 0 && (
          <div className="calc">
            {panel.calc.map(([label, value], i) => (
              <div className={`calc-row ${i === panel.calc.length - 1 ? "total" : ""}`} key={i}>
                <span>{label}</span>
                <b>{value}</b>
              </div>
            ))}
          </div>
        )}

        {panel.diff.length > 0 && (
          <>
            <div className="section-label">Meaningful changes</div>
            {panel.diff.map(([what, how], i) => (
              <div className="diff" key={i}>
                <span>{what}</span>
                <b>{how}</b>
              </div>
            ))}
          </>
        )}

        {panel.timeline.length > 0 && (
          <div className="timeline">
            {panel.timeline.map(([when, what], i) => (
              <div className="event" key={i}>
                <small>{when}</small>
                <strong>{what}</strong>
              </div>
            ))}
          </div>
        )}

        {panel.evidence.length > 0 && (
          <>
            <div className="section-label">Evidence</div>
            <div className="evidence-row header">
              <span>Source / fact</span>
              <span>Finding</span>
              <span>State</span>
            </div>
            {panel.evidence.map((row, i) => (
              <div className="evidence-row" key={i}>
                <span>{row.source}</span>
                <span>{row.finding}</span>
                {/* The condition, in words. Never a confidence percentage. */}
                <span className="confidence">{row.freshness}</span>
              </div>
            ))}
          </>
        )}

        {panel.draft && (
          <>
            <div className="section-label" style={{ marginTop: 14 }}>
              Prepared draft
            </div>
            <div className="draft">
              {panel.draft.to ? `To: ${panel.draft.to}\n` : ""}
              {panel.draft.subject ? `Subject: ${panel.draft.subject}\n\n` : ""}
              {panel.draft.body}
            </div>
          </>
        )}

        <div className="actions">
          {panel.actions.map((a, i) => (
            <Link
              key={a}
              to="/work"
              search={{ view: "active" }}
              className={i === 0 ? "primary" : "secondary"}
            >
              {a}
            </Link>
          ))}
        </div>
      </div>
    </article>
  );
}
