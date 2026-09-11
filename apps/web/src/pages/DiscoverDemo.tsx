import type { DemoWork } from "@asap/schema";
import { Link } from "@tanstack/react-router";
import { ScreenTitle } from "../shell/ScreenTitle.js";
import { useDemo } from "../demo/state.js";

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
 * Every row's copy and ordering comes from the fixtures; the classes come from the demo's own
 * stylesheet, so this can be checked against it rule by rule.
 */

/** The approved priority list, in the demo's own order and wording. */
const PRIORITY: {
  workId: string;
  signal: "high" | "medium" | "resolved";
  signalLabel: string;
  headline: string;
  detail: string;
  workType: string;
  action: string;
  elapsed: string;
  /** The demo names Acme in full and the rest short. Its wording, not a derived label. */
  clientLabel: string;
  urgent?: boolean;
  quiet?: boolean;
}[] = [
  {
    workId: "w-acme-kdn",
    clientLabel: "Acme Manufacturing Ltd",
    signal: "high",
    signalLabel: "High",
    headline: "New vehicle requested on cover today",
    detail:
      "KDN 482Q is not on the latest schedule and Meridian confirmation has not been recorded.",
    workType: "Servicing Work",
    action: "Review servicing",
    elapsed: "12 min ago",
    urgent: true,
  },
  {
    workId: "w-bluewave-renewal",
    clientLabel: "Bluewave Properties",
    signal: "medium",
    signalLabel: "At risk",
    headline: "Property renewal has no usable terms",
    detail: "Updated values and a fire inspection are holding up both approached insurers.",
    workType: "Renewal Work",
    action: "Review renewal",
    elapsed: "34 days",
  },
  {
    workId: "w-mara-balance",
    clientLabel: "Mara Foods",
    signal: "medium",
    signalLabel: "Overdue",
    headline: "KES 860,000 premium remains unpaid",
    detail: "One unmatched receipt may affect the balance and needs a human choice before follow-up.",
    workType: "Money Work",
    action: "Review balance",
    elapsed: "18 days",
  },
  {
    workId: "w-greencare-claim",
    clientLabel: "GreenCare Clinics",
    signal: "resolved",
    signalLabel: "Accepted",
    headline: "Claim settlement is still unpaid",
    detail: "The offer was accepted, but no bank receipt or remittance proves payment.",
    workType: "Claim Work",
    action: "Check settlement",
    elapsed: "3 days",
    quiet: true,
  },
];

export function DiscoverDemo() {
  const demo = useDemo();
  const rows = PRIORITY.map((p) => ({
    ...p,
    work: demo.work.find((w) => w.id === p.workId),
  })).filter((r): r is typeof r & { work: DemoWork } => Boolean(r.work));

  return (
    <>
      <ScreenTitle title="Discover" meta="Thursday, 10 September" />

      <section className="page-scroll">
        <div className="welcome-row">
          <div>
            <div className="eyebrow">Good morning, Grace</div>
            <h2>Here’s what matters today.</h2>
          </div>
          {/* One text node, as the original has it: a flex gap here shifts the glyph. */}
          <Link to="/ask" search={{}} className="ask-floating">
            ✦ Ask ASAP
          </Link>
        </div>

        <div className="discover-layout">
          <div>
            {rows.map((r) => (
                <Link
                  key={r.workId}
                  to="/work/$workId"
                  params={{ workId: r.work.id }}
                  className={`focus-card${r.urgent ? " urgent" : ""}${r.quiet ? " quiet" : ""}`}
                >
                  <div className="focus-top">
                    <span className={`signal ${r.signal}`}>{r.signalLabel}</span>
                    <span>{r.clientLabel}</span>
                    <time>{r.elapsed}</time>
                  </div>
                  <h3>{r.headline}</h3>
                  <p>{r.detail}</p>
                  <div className="focus-footer">
                    <span>{r.workType}</span>
                    <span className="link">
                      {r.action} <span aria-hidden>→</span>
                    </span>
                  </div>
                </Link>
            ))}
            {rows.length === 0 && (
              <div className="focus-card" style={{ cursor: "default" }}>
                <h3>Nothing needs attention</h3>
                <p>That is a real answer, not an empty screen.</p>
              </div>
            )}
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
            <h3>Three motor renewals show premium increases above 18%</h3>
            <p>The increase is mostly from declared values, not claims experience.</p>
            <Link to="/ask" search={{ scenario: "commission-outstanding" }} className="link">
              Investigate pattern
            </Link>
            <hr />
            <div className="quick-title">Quick actions</div>
            <Link to="/ask" search={{ scenario: "brokerage-priorities" }} className="quick">
              Ask about the brokerage <span aria-hidden>→</span>
            </Link>
            <Link to="/ask" search={{ scenario: "import-brokerage-records" }} className="quick">
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
