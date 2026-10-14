import type { ComponentInstance, ExperienceProps, SourceRef } from "@asap/schema";
import { useState } from "react";
import { ActionButton } from "../renderer/ActionRenderer.js";
import { useExperience, useExperienceAsk } from "../context/ExperienceContext.js";

type P<T> = { instance: ComponentInstance; props: T };

/** A source named beside a fact: the record or document it comes from. */
export function Source({ source }: { source: SourceRef | null }) {
  if (!source) return null;
  return (
    <button type="button" className="x-source" title={`${source.label}: ${source.reference}`} aria-label={`Source: ${source.label}, ${source.reference}`}>
      source
    </button>
  );
}

export function Clarification({ instance, props }: P<ExperienceProps<"Clarification">>) {
  const { ask } = useExperienceAsk();
  const [text, setText] = useState("");
  return (
    <div className="x-l-stack" data-gap="tight">
      <h2>{props.question}</h2>
      {props.options.length ? (
        <div className="x-row">
          {props.options.map((o) => (
            <ActionButton key={o.action} id={o.action} />
          ))}
        </div>
      ) : null}
      {props.allowText ? (
        <form
          className="x-row"
          onSubmit={(e) => {
            e.preventDefault();
            const t = text.trim();
            if (!t) return;
            setText("");
            // Answering in words refines this experience through the same path as the Ask bar.
            void ask(t);
          }}
        >
          <label className="x-sr" htmlFor={`${instance.instance}-answer`}>
            Your answer
          </label>
          <input id={`${instance.instance}-answer`} className="x-input" style={{ flex: 1, minWidth: 200 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type the client's name" maxLength={500} />
          <button type="submit" className="x-btn" data-primary="true">
            Continue
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function RecordChoice({ props }: P<ExperienceProps<"RecordChoice">>) {
  const { run, pending } = useExperience();
  return (
    <div className="x-l-stack" data-gap="tight">
      <h2>{props.prompt}</h2>
      <div className="x-choices" role="list">
        {props.choices.map((c) => (
          <button key={c.action} type="button" role="listitem" className="x-choice" aria-busy={pending.has(c.action)} onClick={() => void run(c.action)}>
            <span>{c.ref.label ?? "Choose"}</span>
            {c.detail ? <span className="x-help">{c.detail}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ContextSummary({ instance, props }: P<ExperienceProps<"ContextSummary">>) {
  return (
    <div className="x-l-stack" data-gap="tight">
      <div className="x-row" style={{ justifyContent: "space-between" }}>
        <div className="x-l-stack" data-gap="tight" style={{ gap: 4 }}>
          {props.eyebrow ? <span className="x-eyebrow">{props.eyebrow}</span> : null}
          <h1 style={{ fontSize: 24 }}>{props.heading}</h1>
        </div>
        {props.status ? <span className={`x-pill x-tone-${props.status.tone}`}>{props.status.label}</span> : null}
      </div>
      {props.facts.length ? (
        <dl className="x-facts">
          {props.facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd className="x-num">
                {f.value}
                <Source source={f.source} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="x-row">
        {instance.actions.map((a) => (
          <ActionButton key={a} id={a} small />
        ))}
      </div>
    </div>
  );
}

export function Answer({ props }: P<ExperienceProps<"Answer">>) {
  return (
    <div className="x-l-stack" data-gap="tight" role="status">
      {props.question ? <p className="x-muted x-small">You asked: “{props.question}”</p> : null}
      <p className={props.refused ? "x-notice x-tone-gold" : undefined} style={{ fontSize: 16, fontWeight: props.refused ? 500 : 600 }}>
        {props.text}
      </p>
      {props.items.length ? (
        <ul className="x-list">
          {props.items.map((i, n) => (
            <li key={`${i.label}-${n}`}>
              <span className={`x-dot ${i.tone}`} aria-hidden />
              <div className="x-list-body">
                <div className="x-list-title">{i.label}</div>
                {i.detail ? <div className="x-list-detail">{i.detail}</div> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="x-help">{props.source === "model" ? "Read with the AI model; every value above is from the records." : "From the brokerage's records."}</p>
    </div>
  );
}
