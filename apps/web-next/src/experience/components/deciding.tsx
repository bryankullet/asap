import type { ComponentInstance, ExperienceProps } from "@asap/schema";
import { useState } from "react";
import { ActionButton } from "../renderer/ActionRenderer.js";
import { useExperience } from "../context/ExperienceContext.js";

type P<T> = { instance: ComponentInstance; props: T };

/** Exactly what will leave the brokerage, shown in full before the governed decision. */
export function ApprovalReview({ instance, props }: P<ExperienceProps<"ApprovalReview">>) {
  const { formResults } = useExperience();
  const [note, setNote] = useState("");
  const r = formResults[instance.instance];
  return (
    <div className="x-l-stack" data-gap="normal">
      <div className="x-l-stack" data-gap="tight" style={{ gap: 4 }}>
        <h2>{props.heading}</h2>
        <p className="x-muted">{props.why}</p>
      </div>
      {props.items.map((i, n) => (
        <article key={`${i.heading}-${n}`} className="x-bundle">
          <div className="x-eyebrow">{i.heading}</div>
          {i.to ? <div className="x-small">To: {i.to}</div> : null}
          <div style={{ fontWeight: 600, marginTop: 4 }}>{i.subject}</div>
          <pre>{i.body}</pre>
        </article>
      ))}
      <label className="x-label" htmlFor={`${instance.instance}-note`}>
        If you return it, say what needs to change
      </label>
      <textarea id={`${instance.instance}-note`} className="x-textarea" maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
      {r && r.kind !== "duplicates" ? (
        <p className="x-notice x-tone-red" role="alert">
          {r.message}
        </p>
      ) : null}
      <div className="x-row">
        <ActionButton id={props.approve} extra={{ instance: instance.instance }} />
        <ActionButton id={props.ret} extra={{ instance: instance.instance, note: note.trim() }} />
      </div>
    </div>
  );
}

export function Confirmation({ props }: P<ExperienceProps<"Confirmation">>) {
  return (
    <div className="x-l-stack" data-gap="tight" role="status">
      <div className="x-row">
        <span className={`x-pill x-tone-${props.tone}`}>{props.tone === "green" ? "Done" : props.tone === "red" ? "Stopped" : "Noted"}</span>
      </div>
      <h1 style={{ fontSize: 26 }}>{props.heading}</h1>
      {props.lines.map((l) => (
        <p key={l} className="x-muted">
          {l}
        </p>
      ))}
      {props.next.length ? (
        <div className="x-row" style={{ marginTop: 8 }}>
          {props.next.map((a, i) => (
            <ActionButton key={a} id={a} quiet={i > 0} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
