import type { SubjectRef } from "@asap/schema";
import { useEffect, useState } from "react";
import { api } from "../services/asap-api.js";

type Row = { id: string; title: string; client: string | null; why: string; kind: string; tone: "green" | "gold" | "red" | "grey" };
type Change = { key: string; text: string; tone: "green" | "gold" | "red" | "grey"; subject: string | null };
type Load<T> = T | "loading" | "error";

/** What needs the person, what ASAP is handling, and what changed since they last looked. */
export function Attention({ onOpen }: { onOpen: (text: string, subject: SubjectRef | null) => void }) {
  const [needs, setNeeds] = useState<Load<Row[]>>("loading");
  const [handling, setHandling] = useState<Load<Row[]>>("loading");
  const [changes, setChanges] = useState<Load<Change[]>>("loading");

  useEffect(() => {
    let live = true;
    api
      .attention()
      .then((r) => live && setNeeds(r.items.filter((i) => i.section === "needs_you").slice(0, 6).map((i) => ({ id: i.item.id, title: i.item.title, client: i.client?.name ?? null, why: i.next.what, kind: i.item.kind, tone: i.runFailure ? "red" : "gold" }))))
      .catch(() => live && setNeeds("error"));
    api
      .handling()
      .then((r) => live && setHandling(r.items.slice(0, 5).map((i) => ({ id: i.item.id, title: i.item.title, client: null, why: i.next.what, kind: i.item.kind, tone: "green" }))))
      .catch(() => live && setHandling("error"));
    api
      .changes()
      .then((r) => live && setChanges(r.changes.slice(0, 6).map((c) => ({ key: c.key, text: c.text, tone: c.tone, subject: c.subject }))))
      .catch(() => live && setChanges("error"));
    return () => {
      live = false;
    };
  }, []);

  const open = (r: Row) => (r.kind === "renewal" ? onOpen(`Renew: ${r.title}`.slice(0, 500), { type: "work_item", id: r.id, label: r.title.slice(0, 200) }) : undefined);

  return (
    <div className="x-l-stack" data-gap="normal">
      <Section title="Needs you" state={needs} empty="Nothing needs you right now." render={(rows) => <Rows rows={rows} onOpen={open} />} />
      <Section title="ASAP is handling" state={handling} empty="ASAP is not running anything for you right now." render={(rows) => <Rows rows={rows} onOpen={open} />} />
      <Section
        title="Since you last looked"
        state={changes}
        empty="Nothing has changed since your last visit."
        render={(rows) => (
          <ul className="x-list">
            {rows.map((c) => (
              <li key={c.key}>
                <span className={`x-dot ${c.tone}`} aria-hidden />
                <div className="x-list-body">
                  <div className="x-list-detail">{c.text}</div>
                  {c.subject ? <div className="x-help">{c.subject}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      />
    </div>
  );
}

function Rows({ rows, onOpen }: { rows: Row[]; onOpen: (r: Row) => void }) {
  return (
    <ul className="x-list" style={{ gap: 2 }}>
      {rows.map((r) => {
        const opens = r.kind === "renewal";
        return (
          <li key={r.id}>
            <button type="button" className="x-work-row" aria-disabled={opens ? "false" : "true"} onClick={() => opens && onOpen(r)} title={opens ? undefined : "This kind of work opens in the current ASAP app for now."}>
              <span className={`x-dot ${r.tone}`} aria-hidden />
              <span className="x-list-body">
                <span className="x-list-title">{r.title}</span>
                <span className="x-list-detail" style={{ display: "block" }}>
                  {r.why}
                </span>
                {!opens ? <span className="x-help">Opens in the current ASAP app for now</span> : null}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Section<T extends unknown[]>({ title, state, empty, render }: { title: string; state: Load<T>; empty: string; render: (rows: T) => React.ReactNode }) {
  return (
    <section className="x-card" aria-labelledby={`h-${title}`}>
      <div className="x-card-head">
        <h2 id={`h-${title}`} className="x-card-title">
          {title}
        </h2>
      </div>
      {state === "loading" ? (
        <div aria-busy="true" aria-label={`Loading ${title}`}>
          <div className="x-skeleton" style={{ width: "70%" }} />
          <div className="x-skeleton" style={{ width: "50%", marginTop: 10 }} />
        </div>
      ) : state === "error" ? (
        <p className="x-muted">This could not be read right now.</p>
      ) : state.length === 0 ? (
        <p className="x-muted">{empty}</p>
      ) : (
        render(state)
      )}
    </section>
  );
}
