import type {
  LivingAction,
  LivingBlock,
  LivingComponent,
  LivingEvidence,
  changeComparisonProps,
  consequencePanelProps,
  contextHeaderProps,
  coverageEffectiveStateProps,
  evidenceInspectorProps,
  obligationTrackerProps,
  placementProgressProps,
  progressOpportunityProps,
  quoteComparisonProps,
  renewalJourneyProps,
  timelineProps,
} from "@asap/schema";
import type { ReactNode } from "react";
import type { z } from "zod";
import type { Ref } from "../shell/routes.js";

/**
 * The browser half of the Living registry (D-156). One React component per registered block, typed
 * from the same Zod schemas the server validated against — never a hand-written duplicate. A block
 * whose component is not in this map does not render: the server would have rejected it anyway.
 *
 * Every value shown here arrived in the block's props, which the server read from records. These
 * components format; they do not decide. Status colours keep their fixed meanings.
 */

export type BlockEnv = { open: (ref: Ref) => void; ask: (text: string) => void };
type P<S extends z.ZodTypeAny> = { props: z.infer<S>; block: LivingBlock; env: BlockEnv };

const day = (iso: string | null | undefined) => {
  if (!iso) return null;
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

function ContextHeader({ props }: P<typeof contextHeaderProps>) {
  return (
    <header className="lv-header">
      <div className="lv-header-main">
        <div className="lv-eyebrow">{props.eyebrow}{props.client ? <> · <span>{props.client.name}</span></> : null}</div>
        <h1 className="lv-title">{props.title}</h1>
        <div className="lv-header-meta">
          <span className={`lv-pill lv-${props.status.tone}`}><span className="lv-pill-dot" aria-hidden />{props.status.label}</span>
          {props.owner ? <span className="lv-owner"><span className="lv-avatar" aria-hidden>{props.owner.slice(0, 1).toUpperCase()}</span>{props.owner}</span> : null}
        </div>
      </div>
      {props.facts.length ? (
        <dl className="lv-facts">
          {props.facts.map((f) => (
            <div key={f.label} className="lv-fact"><dt>{f.label}</dt><dd>{f.value}</dd></div>
          ))}
        </dl>
      ) : null}
    </header>
  );
}

function RenewalJourney({ props }: P<typeof renewalJourneyProps>) {
  return (
    <div className="lv-journey">
      <ol className="lv-stages" aria-label="Renewal stages">
        {props.stages.map((s, i) => (
          <li key={s.key} className={`lv-stage lv-${s.state}`} aria-current={s.state === "now" ? "step" : undefined}>
            <span className="lv-stage-mark" aria-hidden>{s.state === "done" ? "✓" : i + 1}</span>
            <span className="lv-stage-label">{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="lv-journey-summary">{props.summary}</p>
    </div>
  );
}

function ProgressOpportunity({ props }: P<typeof progressOpportunityProps>) {
  return (
    <ul className="lv-opps">
      {props.items.map((o) => (
        <li key={o.id} className={`lv-opp lv-tone-${o.tone}`}>
          <div className="lv-opp-head">
            <span className={`lv-dot lv-${o.tone}`} aria-hidden />
            <strong>{o.title}</strong>
            {o.requiresApproval ? <span className="lv-chip lv-gold">Needs approval</span> : null}
            {o.actionableNow ? <span className="lv-chip lv-green">You can act now</span> : <span className="lv-chip lv-grey">Not yours yet</span>}
          </div>
          <p className="lv-why">{o.why}</p>
          <div className="lv-opp-meta">
            {o.responsible ? <span>Held by <b>{o.responsible}</b></span> : null}
            {o.deadline ? <span>By <b>{day(o.deadline)}</b></span> : null}
          </div>
          {o.blockedBy.length ? (
            <ul className="lv-blockers" aria-label="What blocks it">
              {o.blockedBy.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

const KIND_MARK = { outside: "↗", brokerage: "◎", asap: "✦" } as const;
function ObligationTracker({ props }: P<typeof obligationTrackerProps>) {
  return (
    <ul className="lv-obligations">
      {props.items.map((o, i) => (
        <li key={`${o.party}-${i}`} className={`lv-ob lv-ob-${o.kind}`}>
          <span className="lv-ob-mark" aria-hidden>{KIND_MARK[o.kind]}</span>
          <div>
            <strong>{o.kind === "asap" ? "ASAP is handling" : o.since ? `With ${o.party} since ${day(o.since)}` : `With ${o.party}`}</strong>
            <p>{o.what}</p>
            {o.due ? <small>Next check {day(o.due)}</small> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ChangeComparison({ props }: P<typeof changeComparisonProps>) {
  return (
    <ul className="lv-changes">
      {props.items.map((c, i) => (
        <li key={i} className="lv-change">
          <div className="lv-change-head">
            <strong>{c.subject} · {c.field}</strong>
            <span className="lv-chip lv-gold">Revision {c.revision}</span>
            {c.receivedAt ? <small>{day(c.receivedAt)}</small> : null}
          </div>
          <div className="lv-change-values">
            <span className="lv-earlier"><small>Earlier</small><s>{c.earlier ?? "Not recorded"}</s></span>
            <span className="lv-arrow" aria-hidden>→</span>
            <span className="lv-revised"><small>Revised</small><b>{c.revised ?? "Not recorded"}</b></span>
          </div>
          {c.affects.length ? <ul className="lv-affects">{c.affects.map((a, j) => <li key={j}>{a}</li>)}</ul> : null}
        </li>
      ))}
    </ul>
  );
}

const CERTAINTY = { confirmed: ["Confirmed", "red"], potential: ["Potential", "gold"], missing: ["Unknown", "grey"] } as const;
function ConsequencePanel({ props }: P<typeof consequencePanelProps>) {
  return (
    <ul className="lv-consequences">
      {props.items.map((c, i) => (
        <li key={i}>
          <span className={`lv-chip lv-${CERTAINTY[c.certainty][1]}`}>{CERTAINTY[c.certainty][0]}</span>
          <p>{c.text}</p>
        </li>
      ))}
    </ul>
  );
}

function CoverageEffectiveState({ props }: P<typeof coverageEffectiveStateProps>) {
  const urgent = props.daysToExpiry !== null && props.daysToExpiry <= 14;
  return (
    <div className="lv-cover">
      {props.expiring ? (
        <div className="lv-cover-row">
          <small>Current cover</small>
          <strong>{props.expiring.insurerName}{props.expiring.policyNumber ? ` · ${props.expiring.policyNumber}` : ""}</strong>
          <span>{day(props.expiring.periodStart)} – {day(props.expiring.periodEnd)}</span>
          {props.daysToExpiry !== null ? (
            <span className={`lv-countdown ${urgent ? "lv-red" : props.daysToExpiry <= 30 ? "lv-gold" : "lv-green"}`}>
              {props.daysToExpiry >= 0 ? `${props.daysToExpiry} day${props.daysToExpiry === 1 ? "" : "s"} left` : `Ended ${-props.daysToExpiry} day${props.daysToExpiry === -1 ? "" : "s"} ago`}
            </span>
          ) : null}
        </div>
      ) : <p className="lv-missing">No policy period is linked, so the expiry is not known.</p>}
      <div className="lv-cover-row">
        <small>Renewed cover</small>
        {props.renewed ? <strong className={props.renewed.state === "confirmed" || props.renewed.state === "active" ? "lv-ok" : ""}>{props.renewed.line}</strong> : <strong className="lv-missing">Not confirmed</strong>}
      </div>
      <p className="lv-note">{props.statement}</p>
    </div>
  );
}

function QuoteComparison({ props }: P<typeof quoteComparisonProps>) {
  const labels = [...new Set(props.insurers.flatMap((i) => i.terms.map((t) => t.label)))].slice(0, 12);
  return (
    <div className="lv-quotes">
      <div className="lv-table-wrap">
        <table className="lv-table">
          <thead>
            <tr><th scope="col"><span className="lv-sr">Term</span></th>{props.insurers.map((i) => <th key={i.name} scope="col">{i.name}<small>{i.stage}</small></th>)}</tr>
          </thead>
          <tbody>
            <tr><th scope="row">Premium</th>{props.insurers.map((i) => <td key={i.name} className="lv-num">{i.premium ?? (i.declineReason ? <span className="lv-missing">Declined</span> : <span className="lv-missing">Awaited</span>)}</td>)}</tr>
            <tr><th scope="row">Valid until</th>{props.insurers.map((i) => <td key={i.name}>{day(i.validUntil) ?? "—"}</td>)}</tr>
            <tr><th scope="row">Revision</th>{props.insurers.map((i) => <td key={i.name}>{i.revision && i.revision > 1 ? <span className="lv-chip lv-gold">Revised · {i.revision}</span> : i.revision ? "Original" : "—"}</td>)}</tr>
            {labels.map((l) => (
              <tr key={l}><th scope="row">{l}</th>{props.insurers.map((i) => { const t = i.terms.find((x) => x.label === l); return <td key={i.name}>{t ? <>{t.value ?? "—"}{t.unclear ? <span className="lv-chip lv-gold" title="ASAP could not read this clearly">Check</span> : null}</> : <span className="lv-missing">Not stated</span>}</td>; })}</tr>
            ))}
            {props.insurers.some((i) => i.declineReason) ? <tr><th scope="row">Declined because</th>{props.insurers.map((i) => <td key={i.name}>{i.declineReason ?? ""}</td>)}</tr> : null}
          </tbody>
        </table>
      </div>
      {props.note ? <p className="lv-note">{props.note}</p> : null}
    </div>
  );
}

function PlacementProgress({ props }: P<typeof placementProgressProps>) {
  return (
    <div className="lv-placement">
      <ol className="lv-vsteps">
        {props.steps.map((s, i) => (
          <li key={i} className={`lv-vstep lv-${s.state}`}>
            <span className="lv-vstep-mark" aria-hidden>{s.state === "done" ? "✓" : s.state === "blocked" ? "!" : ""}</span>
            <div><strong>{s.label}</strong>{s.note ? <small>{s.note}</small> : null}</div>
          </li>
        ))}
      </ol>
      <p className="lv-cover-line"><b>{props.insurerName}</b> · {props.coverLine}</p>
      {props.blockers.length ? <ul className="lv-blockers">{props.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul> : null}
    </div>
  );
}

function EvidenceList({ items, env }: { items: LivingEvidence[]; env: BlockEnv }) {
  return (
    <ul className="lv-evidence">
      {items.map((e, i) => (
        <li key={i}>
          {e.documentId ? (
            <button type="button" className="lv-evidence-link" onClick={() => env.open({ ws: "document", documentId: e.documentId })}>
              <span aria-hidden>▧</span><span><strong>{e.label}</strong><small>{e.reference}{e.recordedAt ? ` · ${day(e.recordedAt)}` : ""}</small></span>
            </button>
          ) : (
            <span className="lv-evidence-ref"><span aria-hidden>•</span><span><strong>{e.label}</strong><small>{e.reference}{e.recordedAt ? ` · ${day(e.recordedAt)}` : ""}</small></span></span>
          )}
        </li>
      ))}
    </ul>
  );
}

function EvidenceInspector({ props, env }: P<typeof evidenceInspectorProps>) {
  return <EvidenceList items={props.items} env={env} />;
}

function Timeline({ props }: P<typeof timelineProps>) {
  return (
    <ol className="lv-timeline">
      {props.events.map((e, i) => (
        <li key={i}>
          <time dateTime={e.at}>{day(e.at)}</time>
          <span>{e.text}{e.actor ? <small> · {e.actor}</small> : null}</span>
        </li>
      ))}
    </ol>
  );
}

/** Component id → renderer. The registry's browser half; anything absent does not render. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- props are validated per component on the server and typed per renderer above
export const LIVING_RENDERERS: Record<LivingComponent, (p: { props: any; block: LivingBlock; env: BlockEnv }) => ReactNode> = {
  ContextHeader,
  RenewalJourney,
  ProgressOpportunity,
  ObligationTracker,
  ChangeComparison,
  ConsequencePanel,
  CoverageEffectiveState,
  QuoteComparison,
  PlacementProgress,
  EvidenceInspector,
  Timeline,
};

export function BlockActions({ actions, env }: { actions: LivingAction[]; env: BlockEnv }) {
  if (!actions.length) return null;
  return (
    <div className="lv-actions">
      {actions.map((a, i) => (
        <button key={i} type="button" className={a.kind === "open" && a.primary ? "lv-btn lv-btn-primary" : "lv-btn"} onClick={() => (a.kind === "open" ? env.open(a.ref as Ref) : env.ask(a.text))}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

export { EvidenceList };
