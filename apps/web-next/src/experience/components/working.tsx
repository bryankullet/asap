import type { ComponentInstance, ExperienceProps } from "@asap/schema";
import { useEffect, useState } from "react";
import { api } from "../../services/asap-api.js";
import { ActionButton } from "../renderer/ActionRenderer.js";
import { useExperience, useUi } from "../context/ExperienceContext.js";

type P<T> = { instance: ComponentInstance; props: T };

/**
 * A progressive form. Stage 0 fields are asked first; later stages appear only when the person asks
 * for them, or when a value they already typed needs them. Every keystroke is a draft kept with the
 * experience (refresh, Back and another device restore it); nothing is written until the governed
 * submit action runs through its endpoint.
 */
export function ProgressiveForm({ instance, props }: P<ExperienceProps<"ProgressiveForm">>) {
  const { store, formResults, run, pending } = useExperience();
  const ui = useUi();
  const draft = ui.drafts[instance.instance] ?? {};
  const revealedKey = `${instance.instance}-more`;
  const hasLaterValue = props.fields.some((f) => f.stage > 0 && (draft[f.name] ?? "") !== "");
  const [showMore, setShowMore] = useState(ui.revealed.includes(revealedKey) || hasLaterValue);
  const result = formResults[instance.instance];
  const fieldError = (name: string) => (result?.kind === "error" ? result.fields?.[name] : undefined);
  const visible = props.fields.filter((f) => f.stage === 0 || showMore);
  const later = props.fields.some((f) => f.stage > 0);
  const busy = pending.has(props.submit);

  return (
    <form
      className="x-l-stack"
      data-gap="normal"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void run(props.submit, { instance: instance.instance });
      }}
    >
      <div className="x-l-stack" data-gap="tight" style={{ gap: 6 }}>
        <h2>{props.title}</h2>
        {props.intro ? <p className="x-muted">{props.intro}</p> : null}
      </div>
      <div className="x-form-grid">
        {visible.map((f) => {
          const id = `${instance.instance}-${f.name}`;
          const err = fieldError(f.name);
          const value = draft[f.name] ?? "";
          const wide = f.kind === "choice" || f.name === "name";
          return (
            <div key={f.name} className={wide ? "x-wide" : undefined}>
              {f.kind === "choice" ? (
                <fieldset style={{ border: 0, padding: 0, margin: 0 }} aria-describedby={err ? `${id}-err` : undefined}>
                  <legend className="x-label">
                    {f.label}
                    {f.required ? null : <span className="x-muted"> (optional)</span>}
                  </legend>
                  <div className="x-segment" role="radiogroup">
                    {f.options.map((o) => (
                      <label key={o.value}>
                        <input type="radio" name={id} value={o.value} checked={value === o.value} onChange={() => store.setDraft(instance.instance, f.name, o.value)} />
                        <span>{o.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ) : (
                <>
                  <label className="x-label" htmlFor={id}>
                    {f.label}
                    {f.required ? null : <span className="x-muted"> (optional)</span>}
                  </label>
                  <input
                    id={id}
                    className="x-input"
                    type={f.kind === "email" ? "email" : f.kind === "tel" ? "tel" : "text"}
                    autoComplete="off"
                    maxLength={f.maxLength}
                    value={value}
                    aria-invalid={err ? "true" : undefined}
                    aria-describedby={err ? `${id}-err` : f.help ? `${id}-help` : undefined}
                    onChange={(e) => store.setDraft(instance.instance, f.name, e.target.value)}
                  />
                </>
              )}
              {err ? (
                <p className="x-field-error" id={`${id}-err`}>
                  {err}
                </p>
              ) : f.help ? (
                <p className="x-help" id={`${id}-help`}>
                  {f.help}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {later && !showMore && props.revealLabel ? (
        <div>
          <button
            type="button"
            className="x-btn x-btn-sm"
            data-quiet="true"
            onClick={() => {
              setShowMore(true);
              store.reveal(revealedKey);
            }}
          >
            + {props.revealLabel}
          </button>
        </div>
      ) : null}
      {result?.kind === "duplicates" ? (
        <div className="x-notice x-tone-gold" role="alert" style={{ flexDirection: "column" }}>
          <strong>A client with a similar name is already on file.</strong>
          <ul className="x-list" style={{ marginTop: 8 }}>
            {result.candidates.map((c) => (
              <li key={c.ref.id}>
                <div className="x-list-body">
                  <span className="x-list-title">{c.ref.label}</span> <span className="x-muted">{c.detail}</span>
                </div>
                <button type="button" className="x-btn x-btn-sm" onClick={() => void run(props.submit, { instance: instance.instance, useExisting: c.ref })}>
                  Use this client
                </button>
              </li>
            ))}
          </ul>
          <div>
            <button type="button" className="x-btn x-btn-sm" onClick={() => void run(props.submit, { instance: instance.instance, confirmNew: true })}>
              It is a different client — add it
            </button>
          </div>
        </div>
      ) : null}
      {result && result.kind !== "duplicates" ? (
        <p className="x-notice x-tone-red" role="alert">
          {result.message}
        </p>
      ) : null}
      <div className="x-row">
        <SubmitButton id={props.submit} />
      </div>
    </form>
  );
}

function SubmitButton({ id }: { id: string }) {
  const { spec, pending } = useExperience();
  const a = spec.actions.find((x) => x.id === id);
  if (!a) return null;
  return (
    <>
      <button type="submit" className="x-btn" data-primary="true" aria-disabled={a.disabledReason || pending.has(id) ? "true" : "false"} disabled={!!a.disabledReason}>
        {pending.has(id) ? <span className="x-working">Saving</span> : a.label}
      </button>
      {a.disabledReason ? <span className="x-help">{a.disabledReason}</span> : <span className="x-help">Nothing is written until you press this.</span>}
    </>
  );
}

/** A document's own bytes, from a short-lived signed link the API mints for this person. */
export function DocumentViewer({ props }: P<ExperienceProps<"DocumentViewer">>) {
  return <DocumentFrame documentId={props.documentId} title={props.title} />;
}

export function DocumentFrame({ documentId, title }: { documentId: string; title: string }) {
  const [state, setState] = useState<{ url: string | null; name: string; mime: string } | "loading" | "error">("loading");
  useEffect(() => {
    let live = true;
    api
      .document(documentId)
      .then((d) => live && setState({ url: d.fileUrl, name: d.document.filename, mime: d.document.mimeType }))
      .catch(() => live && setState("error"));
    return () => {
      live = false;
    };
  }, [documentId]);
  if (state === "loading") return <div className="x-skeleton" style={{ height: 240 }} aria-label="Loading the document" />;
  if (state === "error") return <p className="x-notice x-tone-red">The document could not be opened for you.</p>;
  if (!state.url) return <p className="x-notice x-tone-gold">The file for {state.name} is not available yet.</p>;
  return state.mime.startsWith("image/") ? (
    <img src={state.url} alt={title} style={{ maxWidth: "100%", borderRadius: 12 }} />
  ) : (
    <iframe title={title} src={state.url} style={{ width: "100%", height: "70vh", border: 0, borderRadius: 12, background: "var(--color-document-paper)" }} />
  );
}

export function GovernedAction({ instance, props }: P<ExperienceProps<"GovernedAction">>) {
  const { formResults } = useExperience();
  const r = formResults[instance.instance];
  return (
    <div className="x-l-stack" data-gap="tight">
      <h2>{props.heading}</h2>
      <p className="x-muted">{props.explanation}</p>
      {props.effects.length ? (
        <ul className="x-list">
          {props.effects.map((e) => (
            <li key={e}>
              <span className="x-dot green" aria-hidden />
              <span className="x-list-detail">{e}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {r && r.kind !== "duplicates" ? (
        <p className="x-notice x-tone-red" role="alert">
          {r.message}
        </p>
      ) : null}
      <div className="x-row">
        <ActionButton id={props.action} extra={{ instance: instance.instance }} />
      </div>
    </div>
  );
}
