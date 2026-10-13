import type { ComponentInstance, ExperienceProps } from "@asap/schema";
import { ActionButton } from "../renderer/ActionRenderer.js";

type P<T> = { instance: ComponentInstance; props: T };
const when = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null);

export function Milestones({ props }: P<ExperienceProps<"Milestones">>) {
  return (
    <div className="x-l-stack" data-gap="tight">
      <ol className="x-milestones" aria-label="Where it stands">
        {props.steps.map((s) => (
          <li key={s.key} data-state={s.state} aria-current={s.state === "now" ? "step" : undefined}>
            {s.label}
          </li>
        ))}
      </ol>
      <p>{props.summary}</p>
    </div>
  );
}

export function NextSteps({ props }: P<ExperienceProps<"NextSteps">>) {
  if (!props.items.length) return <p className="x-muted">{props.empty}</p>;
  return (
    <ul className="x-list">
      {props.items.map((i) => (
        <li key={i.title}>
          <span className={`x-dot ${i.tone}`} aria-hidden />
          <div className="x-list-body">
            <div className="x-list-title">{i.title}</div>
            <div className="x-list-detail">{i.why}</div>
            {i.responsible ? <div className="x-help">Held by {i.responsible}</div> : null}
            {i.blockedBy.length ? <div className="x-help">Blocked by: {i.blockedBy.join("; ")}</div> : null}
            {i.action ? <ActionButton id={i.action} small /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function Obligations({ props }: P<ExperienceProps<"Obligations">>) {
  if (!props.items.length) return <p className="x-muted">{props.empty}</p>;
  return (
    <ul className="x-list">
      {props.items.map((o, n) => (
        <li key={`${o.party}-${n}`}>
          <span className={`x-dot ${o.kind === "outside" ? "gold" : o.kind === "asap" ? "green" : "grey"}`} aria-hidden />
          <div className="x-list-body">
            <div className="x-list-title">{o.kind === "outside" && o.since ? `With ${o.party} since ${when(o.since)}` : o.party}</div>
            <div className="x-list-detail">{o.what}</div>
            {o.due ? <div className="x-help">Next check {when(o.due)}</div> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

const CERTAINTY = { confirmed: ["From the records", "red"], potential: ["Possible", "gold"], missing: ["Not known", "grey"] } as const;
export function Consequences({ props }: P<ExperienceProps<"Consequences">>) {
  return (
    <ul className="x-list">
      {props.items.map((c) => (
        <li key={c.text}>
          <span className={`x-pill x-tone-${CERTAINTY[c.certainty][1]}`} style={{ flex: "none" }}>
            {CERTAINTY[c.certainty][0]}
          </span>
          <span className="x-list-detail">{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

export function Timeline({ props }: P<ExperienceProps<"Timeline">>) {
  if (!props.events.length) return <p className="x-muted">Nothing is recorded yet.</p>;
  return (
    <ol className="x-list">
      {props.events.map((e, n) => (
        <li key={`${e.at}-${n}`}>
          <span className="x-dot grey" aria-hidden />
          <div className="x-list-body">
            <div className="x-list-detail">{e.text}</div>
            <div className="x-help">
              {when(e.at)}
              {e.actor ? ` · ${e.actor}` : ""}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
