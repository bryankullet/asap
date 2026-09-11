import type { AttentionResponse, FocusCardView } from "@asap/schema";
import { Link } from "@tanstack/react-router";
import { ScreenTitle } from "../shell/ScreenTitle.js";
import { describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { useAttention } from "../lib/queries.js";
import { focusCardFromAttention } from "../live/adapters.js";

/**
 * Discover, ported from the approved demo (D-064).
 *
 * The demo's structure exactly: a topbar carrying the screen title and date, then a welcome row —
 * eyebrow greeting, "Here's what matters today.", and the Ask ASAP pill on the right — then a
 * two-column layout of focus cards beside a sticky "ASAP noticed" card with its quick actions.
 *
 * A focus card is: signal pill · client · elapsed time, then the headline, then one sentence, then
 * a hairline footer with the Work type on the left and the action on the right. The first card
 * carries the urgent left border. The last is `quiet`, at 80% opacity, because a settlement that
 * has been accepted is real but not urgent.
 *
 * Every row is one of the brokerage's own attention items, ranked server-side; the classes come
 * from the approved stylesheet, so this can be checked against it rule by rule.
 */

/** The date, in the approved format, from the clock that decided what is due. */
function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function greeting(now: Date, firstName: string): string {
  const hour = now.getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return firstName ? `${part}, ${firstName}` : part;
}

export function Discover() {
  const me = useMe();

  /*
   * A real brokerage's Discover: ranked, capped, reasoned and dated server-side, against the
   * server's clock (§27, D-058). The browser renders what comes back and never re-decides what is
   * urgent — the signals that did the ranking are rows, and the reason is the engine's own.
   */
  const live = useAttention(me.data?.active_organization?.id);
  const generatedAt = live.data?.generatedAt;
  const now = generatedAt ? new Date(generatedAt) : new Date();

  const cards: FocusCardView[] = (live.data?.items ?? []).map((entry, i) =>
    focusCardFromAttention(entry, now, i),
  );

  const person = me.data?.user;
  const firstName =
    (person?.display_name ?? person?.full_name ?? person?.email ?? "").split(/[\s@.]+/)[0] ?? "";

  return (
    <>
      <ScreenTitle title="Discover" meta={generatedAt ? dateLabel(generatedAt) : ""} />

      <section className="page-scroll">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">{greeting(now, firstName)}</div>
            <h2>Here’s what matters today.</h2>
          </div>
          {/* One text node, as the original has it: a flex gap here shifts the glyph. */}
          <Link to="/ask" search={{}} className="ask-floating">
            ✦ Ask ASAP
          </Link>
        </div>

        <div className="discover-layout">
          <div>
            {/* Every system state is designed (§36), and none of them is a blank column. */}
            {live.isPending && (
              <div className="focus-card" style={{ cursor: "default" }}>
                <h3>Reading your book…</h3>
                <p>Ranking what needs attention against the server’s clock.</p>
              </div>
            )}
            {live.isError && (
              <div className="focus-card urgent" style={{ cursor: "default" }}>
                <h3>We could not read what needs attention</h3>
                <p>{describeApiError(live.error)}</p>
                <div className="focus-footer">
                  <span>Nothing has been changed</span>
                  <button type="button" className="link" onClick={() => void live.refetch()}>
                    Try again <span aria-hidden>→</span>
                  </button>
                </div>
              </div>
            )}
            {cards.map((c) => (
              <Link
                key={c.id}
                to={c.href}
                className={`focus-card${c.urgent ? " urgent" : ""}${c.quiet ? " quiet" : ""}`}
              >
                <div className="focus-top">
                  <span className={`signal ${c.tone === "neutral" ? "medium" : c.tone}`}>
                    {c.toneLabel}
                  </span>
                  <span>{c.clientLabel}</span>
                  <time>{c.elapsed}</time>
                </div>
                <h3>{c.headline}</h3>
                <p>{c.detail}</p>
                <div className="focus-footer">
                  <span>{c.workType}</span>
                  <span className="link">
                    {c.action} <span aria-hidden>→</span>
                  </span>
                </div>
              </Link>
            ))}
            {cards.length === 0 &&
              !live.isPending &&
              !live.isError &&
              /*
               * Two different empty screens, because they are two different facts. A brokerage
               * with nothing on file is not up to date — it has not started — and telling it
               * otherwise is a lie of omission (D-068).
               */
              ((live.data?.book.clients ?? 1) === 0 ? (
                <div className="focus-card" style={{ cursor: "default" }}>
                  <h3>Nothing is on file yet</h3>
                  <p>
                    ASAP works from your own clients, policies, documents and email. Put the first
                    one in and this becomes the list of what needs a person today.
                  </p>
                  <div className="focus-footer">
                    <span>Start here</span>
                    <Link to="/new" className="link">
                      Start a piece of work <span aria-hidden>→</span>
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="focus-card" style={{ cursor: "default" }}>
                  <h3>Nothing needs attention</h3>
                  <p>That is a real answer, not an empty screen.</p>
                </div>
              ))}
            {/* A partial read says what it could not see rather than quietly showing less. */}
            {(live.data?.degraded ?? []).map((d) => (
              <div className="warning" key={d.what}>
                <strong>{d.what}:</strong> {d.because} Everything above was read.
              </div>
            ))}
          </div>

          <aside className="noticed-card">
            <div className="noticed-head">
              <span aria-hidden className="asap-orb">
                ✦
              </span>
              <div>
                <strong>ASAP noticed</strong>
                <small>Across your book</small>
              </div>
            </div>
            <Noticed attention={live.data} />
            <hr />
            <div className="quick-title">Quick actions</div>
            <Link to="/ask" search={{}} className="quick">
              Ask about the brokerage <span aria-hidden>→</span>
            </Link>
            <Link to="/new" className="quick">
              Import client records <span aria-hidden>→</span>
            </Link>
            <Link to="/email" className="quick">
              Review connected email <span aria-hidden>→</span>
            </Link>
          </aside>
        </div>
      </section>
    </>
  );
}

/**
 * What ASAP noticed, on a real brokerage: counted from the same answer, never generated.
 *
 * The approved design shows a pattern across the book. There is no endpoint that finds patterns
 * yet, and inventing one here would be a model-authored business claim (§45 rule 9) — so this says
 * the true thing the answer already contains: how much is waiting, and what ASAP ran that stopped.
 */
function Noticed({ attention }: { attention: AttentionResponse | undefined }) {
  if (!attention) return null;
  if (attention.book.clients === 0) {
    return (
      <>
        <h3>Your book is empty</h3>
        <p>
          No clients, no policies, nothing waiting. Add a client, connect the mailbox the brokerage
          already works from, or give ASAP a schedule to read.
        </p>
        <Link to="/files" search={{ view: "blocking" }} className="link">
          Add the first client
        </Link>
      </>
    );
  }
  const needsYou = attention.sections.find((s) => s.key === "needs_you")?.visible ?? 0;
  const checksDue = attention.sections.find((s) => s.key === "checks_due")?.visible ?? 0;
  const stopped = attention.orphanRuns.length;

  if (needsYou === 0 && checksDue === 0 && stopped === 0) {
    return (
      <>
        <h3>Nothing is waiting on anyone</h3>
        <p>No step needs a person, no check is overdue, and every job ASAP ran finished.</p>
      </>
    );
  }
  return (
    <>
      <h3>
        {needsYou} {needsYou === 1 ? "item needs" : "items need"} a person
        {checksDue > 0
          ? `, and ${checksDue} ${checksDue === 1 ? "check is" : "checks are"} overdue`
          : ""}
      </h3>
      <p>
        {stopped > 0
          ? `${stopped} ${stopped === 1 ? "job" : "jobs"} ASAP ran stopped without finishing and belong to no work item yet.`
          : "Every job ASAP ran either finished or is waiting on somebody outside."}
      </p>
      <Link to="/jobs" search={{ filter: "work" }} className="link">
        {stopped > 0 ? "Open what stopped" : "See what ASAP is doing"}
      </Link>
    </>
  );
}
