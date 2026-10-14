import type { ComponentInstance, ExperienceProps } from "@asap/schema";
import { useMemo, useState } from "react";
import { ActionButton } from "../renderer/ActionRenderer.js";
import { useExperience, useUi } from "../context/ExperienceContext.js";
import { Source } from "./understanding.js";

type P<T> = { instance: ComponentInstance; props: T };

export function FilterBar({ props }: P<ExperienceProps<"FilterBar">>) {
  const { run } = useExperience();
  return (
    <div className="x-l-stack" data-gap="tight">
      <div className="x-filterbar" aria-label="Applied filters">
        {props.chips.map((c) => (
          <span key={c.label} className="x-chip" data-fixed={c.removeAction ? "false" : "true"}>
            {c.label}
            {c.removeAction ? (
              <button type="button" aria-label={`Remove ${c.label}`} onClick={() => void run(c.removeAction!)}>
                ×
              </button>
            ) : null}
          </span>
        ))}
        <span className="x-count" aria-live="polite">
          {props.count} {props.count === 1 ? "policy" : "policies"}
        </span>
      </div>
      {props.unclear ? <p className="x-notice x-tone-gold">{props.unclear} Nothing was guessed.</p> : null}
      <p className="x-help">{props.basis}</p>
    </div>
  );
}

export function RecordTable({ instance, props }: P<ExperienceProps<"RecordTable">>) {
  const { run, spec } = useExperience();
  const ui = useUi();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const select = spec.actions.find((a) => instance.actions.includes(a.id) && a.payload.kind === "ui.select") ?? null;
  const selected = ui.selection[instance.instance]?.id ?? null;
  const rows = useMemo(() => {
    if (!sort) return props.rows;
    return [...props.rows].sort((a, b) => (a.cells[sort.key] ?? "").localeCompare(b.cells[sort.key] ?? "", "en", { numeric: true }) * sort.dir);
  }, [props.rows, sort]);
  const choose = (ref: (typeof props.rows)[number]["ref"]) => {
    // Selection is a composed action like any other: a table without one is read-only.
    if (props.selectable && select) void run(select.id, { ref });
  };
  if (!props.rows.length) return <p className="x-empty">{props.emptyText}</p>;
  return (
    <div className="x-table-wrap">
      <table className="x-table">
        <caption>{props.caption}</caption>
        <thead>
          <tr>
            {props.columns.map((c) => (
              <th key={c.key} scope="col" data-align={c.align} aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                <button type="button" className="x-btn x-btn-sm" data-quiet="true" onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: 1 }))}>
                  {c.label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.ref.id}
              data-selectable={props.selectable && select ? "true" : "false"}
              data-tone={r.tone ?? undefined}
              aria-selected={selected === r.ref.id}
              tabIndex={props.selectable && select ? 0 : undefined}
              onClick={() => choose(r.ref)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  choose(r.ref);
                }
              }}
            >
              {props.columns.map((c) => (
                <td key={c.key} data-align={c.align}>
                  {r.cells[c.key] ?? <span className="x-muted">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {props.truncated ? <p className="x-help" style={{ padding: 12 }}>More rows exist than are shown. Narrow the window or the class to see them all.</p> : null}
    </div>
  );
}

export function RecordDetail({ instance, props }: P<ExperienceProps<"RecordDetail">>) {
  return (
    <div className="x-l-stack" data-gap="tight">
      <div className="x-l-stack" data-gap="tight" style={{ gap: 4 }}>
        {props.eyebrow ? <span className="x-eyebrow">{props.eyebrow}</span> : null}
        <h2>{props.heading}</h2>
      </div>
      <dl className="x-facts" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
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
      {props.note ? <p className="x-help">{props.note}</p> : null}
      <div className="x-row">
        {instance.actions.map((a) => (
          <ActionButton key={a} id={a} />
        ))}
      </div>
    </div>
  );
}

export function Comparison({ props }: P<ExperienceProps<"Comparison">>) {
  return (
    <div className="x-l-stack" data-gap="tight">
      {props.hypothetical ? <p className="x-notice x-tone-gold">Hypothetical — nothing here is recorded or sent.</p> : null}
      <div className="x-table-wrap">
        <table className="x-table x-compare">
          <caption>{props.caption}</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="x-sr">Term</span>
              </th>
              {props.columns.map((c) => (
                <th key={c.label} scope="col">
                  {c.label}
                  {c.detail ? <div className="x-help" style={{ fontWeight: 500 }}>{c.detail}</div> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {props.rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {props.columns.map((c, i) => (
                  <td key={c.label} className="x-num">
                    {r.values[i] ?? <span className="x-muted">Not given</span>}
                    {r.unclear[i] ? <span className="x-unclear"> · unclear</span> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="x-help">{props.note}</p>
    </div>
  );
}
