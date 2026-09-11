import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";

/**
 * Ask ASAP — the conversation surface (D-064).
 *
 * The approved structure, rule for rule: a crumb topbar, the context strip naming what the
 * question is being asked across, then the two-column `.workspace` — the conversation on the left
 * with its head, thread and docked composer, and the answer's own panel on the right.
 *
 * Every turn is a real `POST /ask` under the caller's session. The answer, its citations and its
 * abstention all come from the server; nothing is improvised in the browser, and no business value
 * on this screen was written by a model (§45 rule 9) — the citations name the record each fact was
 * read from, and an answer with none is an abstention rather than a claim.
 */

type AskAnswer = Awaited<ReturnType<typeof api.askQuestion>>;
type Turn = { question: string; response: AskAnswer | null };

/** Openers a brokerage can actually have answered from its own rows on the first day. */
const OPENERS: readonly string[] = [
  "What needs me today?",
  "Which policies expire in the next 30 days?",
  "What premium is still outstanding?",
  "Which claims are waiting on the insurer?",
];

export function Ask() {
  const me = useMe();
  const navigate = useNavigate();
  const thread = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const live = useMutation({
    mutationFn: (question: string) =>
      api.askQuestion({ question, conversationId, scope: { kind: "brokerage", id: null } }),
    onSuccess: (res) => {
      setConversationId(res.conversationId);
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.response === null) next[next.length - 1] = { ...last, response: res };
        return next;
      });
      // A workspace answer is a Space, not a paragraph: open it where Spaces live.
      if (res.planRecordId) {
        void navigate({
          to: "/r/$recordId",
          params: { recordId: res.planRecordId },
          search: res.planView ? { view: res.planView } : {},
        });
      }
    },
    // The question stays in the composer rather than vanishing into a failed turn.
    onError: () => setTurns((prev) => prev.slice(0, -1)),
  });

  /**
   * Keep the newest turn in view by setting the thread's own scrollTop. Doing it with
   * `scrollIntoView` on a trailing sentinel instead scrolls every scrollable ancestor, which left
   * the thread scrolled at viewports where the conversation actually fits.
   */
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, live.isPending]);

  function ask(question: string) {
    setTurns((prev) => [...prev, { question, response: null }]);
    live.mutate(question);
  }

  function submit(e: FormEvent | KeyboardEvent) {
    e.preventDefault();
    const question = typed.trim();
    if (!question || live.isPending) return;
    ask(question);
    setTyped("");
  }

  const org = me.data?.active_organization;
  const person = me.data?.user;
  const displayName = person?.display_name ?? person?.full_name ?? person?.email ?? "";
  const initials =
    displayName
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "A";
  const orgName = org?.name ?? "your brokerage";
  const last = turns[turns.length - 1]?.response ?? null;
  const suggestions = last?.suggestions.length ? last.suggestions : OPENERS;

  return (
    <>
      <header className="topbar">
        <div className="crumbs">
          <span>{orgName}</span>
          <b>/</b>
          <strong>Ask ASAP</strong>
        </div>
        <div className="top-actions">
          {/* One text node each, as the approved design has them: a flex gap changes both widths. */}
          <Link to="/search" search={{ q: "" }} className="icon-btn" aria-label="Search">
            ⌕
          </Link>
          <Link to="/new" className="new-btn">
            ＋ New
          </Link>
        </div>
      </header>

      <section className="workspace">
        <div className="conversation">
          <div className="conversation-head">
            <div>
              <span className="asap-orb" aria-hidden>
                ✦
              </span>
              <div>
                <strong>Ask ASAP</strong>
                <small>Working across {orgName}</small>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setTurns([]);
                setConversationId(null);
              }}
            >
              ＋ New thread
            </button>
          </div>

          <div className="thread" ref={thread}>
            {/* An empty thread is a designed state (§36), not a blank column. */}
            {turns.length === 0 && !live.isPending && (
              <div className="message ai">
                <div className="mini-avatar" aria-hidden>
                  ✦
                </div>
                <div className="bubble">
                  <p className="answer-lead">Ask anything about {orgName}.</p>
                  <p>
                    ASAP reads only the records, documents and email your role can see, and cites
                    where every figure came from. When the evidence is not there it says so rather
                    than guessing.
                  </p>
                </div>
              </div>
            )}

            {turns.map((turn, i) => (
              <LiveTurn key={i} turn={turn} initials={initials} />
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
                  <p>Nothing was recorded and nothing was sent.</p>
                </div>
              </div>
            )}
          </div>

          <div className="composer-wrap">
            <div className="context-chip">
              <span aria-hidden>{initials}</span> {orgName} · Everything you can see
            </div>
            <form className="composer" onSubmit={submit}>
              <label htmlFor="ask-input" className="sr-only">
                Ask anything about your brokerage
              </label>
              <textarea
                id="ask-input"
                rows={1}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) submit(e);
                }}
                placeholder="Ask anything about your brokerage…"
              />
              <button type="submit" className="send" aria-label="Send" disabled={live.isPending}>
                ↑
              </button>
            </form>
            <div className="suggestions">
              {suggestions.map((s) => (
                <button key={s} type="button" disabled={live.isPending} onClick={() => ask(s)}>
                  {s}
                </button>
              ))}
            </div>
            <small className="disclaimer">
              ASAP can make mistakes. Important decisions always stay with you.
            </small>
          </div>
        </div>

        <aside className="space-panel" aria-label="Evidence">
          <Evidence answer={last} />
        </aside>
      </section>
    </>
  );
}

/** One question and its answer, in the approved message shape. */
function LiveTurn({ turn, initials }: { turn: Turn; initials: string }) {
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
          {initials}
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
                  ? "Ask is not configured to answer on this server yet. Everything else in ASAP works without it."
                  : "Ask could not answer that from the permitted records."}
              </p>
            )}
            {response.clarify && (
              <>
                <p>{response.clarify.question}</p>
                <ul>
                  {response.clarify.options.map((o) => (
                    <li key={o.id}>
                      {o.label}
                      {o.hint ? ` — ${o.hint}` : ""}
                    </li>
                  ))}
                </ul>
              </>
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
 * Where the last answer came from.
 *
 * Every citation is openable — a citation you cannot open is not a citation — and the panel shows
 * which declared tools ran, so "how does it know that?" has an answer on the screen rather than in
 * a log.
 */
function Evidence({ answer }: { answer: AskAnswer | null }) {
  const message = answer?.message ?? null;
  if (!message) {
    return (
      <article className="space-card">
        <div className="section-label">EVIDENCE</div>
        <p>
          Ask a question and everything it read appears here: the record each figure came from, the
          document and page behind it, and which of ASAP’s declared tools ran.
        </p>
      </article>
    );
  }
  return (
    <article className="space-card">
      <div className="section-label">EVIDENCE</div>
      {message.citations.length === 0 ? (
        <p>
          This answer cites nothing, so it is not a claim about your book. ASAP says what it could
          not establish rather than filling the gap.
        </p>
      ) : (
        <ul className="evidence-list">
          {message.citations.map((c, i) => (
            <li key={i}>
              {c.recordId ? (
                <Link to="/r/$recordId" params={{ recordId: c.recordId }} search={{}}>
                  {c.label}
                </Link>
              ) : (
                <span>{c.label}</span>
              )}
              <small>
                {c.recordKind}
                {c.reference ? ` · ${c.reference}` : ""}
                {c.page !== null ? ` · page ${c.page}` : ""}
              </small>
            </li>
          ))}
        </ul>
      )}
      {message.tools_used.length > 0 && (
        <>
          <div className="section-label">WHAT IT RAN</div>
          <ul className="evidence-list">
            {message.tools_used.map((t, i) => (
              <li key={i}>{t.name}</li>
            ))}
          </ul>
        </>
      )}
      <Link to="/audit" className="source-link">
        ▱ Everything recorded about this answer
      </Link>
    </article>
  );
}
