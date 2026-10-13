import type { ComponentInstance, ExperienceProps } from "@asap/schema";
import { useExperience } from "../context/ExperienceContext.js";

type P<T> = { instance: ComponentInstance; props: T };

/** Every source here opens: a document opens beside the work, a record reference says where it is. */
export function SourceList({ instance, props }: P<ExperienceProps<"SourceList">>) {
  const { spec, run } = useExperience();
  if (!props.items.length) return <p className="x-muted">{props.empty}</p>;
  const open = (documentId: string) => spec.actions.find((a) => instance.actions.includes(a.id) && a.payload.kind === "document.open" && a.payload.documentId === documentId);
  return (
    <ul className="x-list">
      {props.items.map((s, n) => {
        const a = s.documentId ? open(s.documentId) : null;
        return (
          <li key={`${s.label}-${n}`}>
            <span className="x-dot grey" aria-hidden />
            <div className="x-list-body">
              <div className="x-list-title">{s.label}</div>
              <div className="x-list-detail">{s.reference}</div>
            </div>
            {a ? (
              <button type="button" className="x-btn x-btn-sm" onClick={() => void run(a.id)}>
                Open
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export function ChangeList({ props }: P<ExperienceProps<"ChangeList">>) {
  if (!props.items.length) return <p className="x-muted">{props.empty}</p>;
  return (
    <ul className="x-list">
      {props.items.map((c, n) => (
        <li key={`${c.subject}-${c.field}-${n}`}>
          <span className="x-dot gold" aria-hidden />
          <div className="x-list-body">
            <div className="x-list-title">
              {c.subject} · {c.field} <span className="x-muted">(revision {c.revision})</span>
            </div>
            <div className="x-list-detail x-num">
              <s>{c.earlier ?? "Not recorded"}</s> → <strong>{c.revised ?? "Not recorded"}</strong>
            </div>
            {c.affects.map((a) => (
              <div key={a} className="x-help">
                {a}
              </div>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}
