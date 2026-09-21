import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { SpaceFrameBlock } from "@asap/schema";
import type { ActHandler } from "./parts.js";
import { BlockShell, RelatedSpaces, SpaceActions, SpaceEvidenceList, toneClass } from "./parts.js";

/**
 * The fourteen registered blocks. One component each, and nothing else renders.
 *
 * Every shape here is the prototype's own markup, structure for structure: a `facts` grid is a 1px
 * gap over a line-coloured ground because that is how the prototype draws hairlines between
 * cells, and a `rows` card's first row has no top border because the card's own border is that
 * line. The values are in `apps/web/src/styles/space.css`, measured rather than chosen.
 *
 * What these components do not do, deliberately:
 *
 *  - **They do not fetch.** Content arrives validated, from an adapter over a real API response.
 *  - **They do not mutate.** A business verb calls `onAct`, which the page wires to the validated
 *    action API. Fourteen presentation components with write access is fourteen places for a
 *    mutation to hide (§45 rule 8).
 *  - **They do not derive business facts.** No block computes a total, a status or a percentage.
 *    Progress on an `upload` is a file's own byte count and the only bar in the product.
 */

type Props<T extends SpaceFrameBlock["type"]> = {
  block: Extract<SpaceFrameBlock, { type: T }>;
  onAct?: ActHandler | undefined;
};

function FactsBlock({ block }: Props<"facts">) {
  return (
    <div className="sp-facts">
      {block.facts.map((fact, i) => (
        <div className="sp-fact" key={`${fact.key}-${i}`}>
          <small className="sp-fact-key">{fact.key}</small>
          {/*
           * Abstention is a state, not a blank (§36). A fact nobody has recorded says so in its
           * own tone rather than rendering an empty value that reads as zero.
           */}
          <strong className="sp-fact-value" data-missing={fact.missing}>
            {fact.missing ? fact.value || "Not on file" : fact.value}
          </strong>
          <SpaceEvidenceList evidence={fact.evidence} />
        </div>
      ))}
    </div>
  );
}

/**
 * The unit Today and Work are made of.
 *
 * "Why is this here?" is one click and the answer is the engine's own recorded reason — never
 * composed in React and never by a model. A row that cannot say why it is on the screen is a row
 * a person learns to distrust.
 */
function RowsBlock({ block, onAct }: Props<"rows">) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="sp-rows">
      {block.rows.map((row) => (
        <div className="sp-row" key={row.id}>
          <div className="sp-row-grid">
            <div className="sp-row-main">
              {row.related ? (
                <Link to={row.related.path} className="sp-row-title">
                  {row.title}
                </Link>
              ) : (
                <strong className="sp-row-title">{row.title}</strong>
              )}
              {row.note !== "" && <small className="sp-row-note">{row.note}</small>}
              {row.why !== null && open[row.id] === true && (
                <small className="sp-row-why">{row.why}</small>
              )}
              <SpaceEvidenceList evidence={row.evidence} />
            </div>
            <div className="sp-row-actions">
              {row.badge !== null && (
                <span className={`sp-badge ${toneClass(row.badgeTone)}`}>{row.badge}</span>
              )}
              {row.why !== null && (
                <button
                  type="button"
                  className="sp-btn"
                  aria-expanded={open[row.id] === true}
                  onClick={() => setOpen((s) => ({ ...s, [row.id]: s[row.id] !== true }))}
                >
                  Why is this here?
                </button>
              )}
              <SpaceActions actions={row.actions} onAct={onAct} primaryFirst />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function MissingBlock({ block }: Props<"missing">) {
  return (
    <div className="sp-missing">
      {block.items.map((item, i) => (
        <div className="sp-missing-item" key={i}>
          <span className="sp-missing-mark" aria-hidden>
            !
          </span>
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}

function NoteBlock({ block }: Props<"note">) {
  return (
    <div className="sp-note" data-tone={block.tone}>
      <strong className="sp-note-title">{block.title}</strong>
      <p className="sp-note-text">{block.text}</p>
    </div>
  );
}

/** Terms side by side. Unclear and missing terms stay visible rather than being scored away. */
function CompareBlock({ block }: Props<"compare">) {
  const columns = `minmax(0,1.1fr) repeat(${block.columns.length}, minmax(0,1fr))`;
  return (
    <div className="sp-grid">
      <div className="sp-grid-head" style={{ gridTemplateColumns: columns }}>
        <div>{block.termHeading}</div>
        {block.columns.map((c, i) => (
          <div key={`${c.label}-${i}`}>{c.label}</div>
        ))}
      </div>
      {block.rows.map((row, i) => (
        <div
          className="sp-grid-row"
          key={`${row.label}-${i}`}
          style={{ gridTemplateColumns: columns }}
        >
          <div className="sp-grid-term">{row.label}</div>
          {row.cells.map((cell, j) => (
            <div key={j} className={cell.tone === "neutral" ? undefined : toneClass(cell.tone)}>
              {cell.value}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function TableBlock({ block }: Props<"table">) {
  const columns = `repeat(${block.columns.length}, minmax(0,1fr))`;
  return (
    <div className="sp-grid">
      <div className="sp-grid-head" style={{ gridTemplateColumns: columns }}>
        {block.columns.map((c, i) => (
          <div key={`${c.label}-${i}`}>{c.label}</div>
        ))}
      </div>
      {block.rows.map((row) => (
        <div className="sp-grid-row" key={row.id} style={{ gridTemplateColumns: columns }}>
          {row.cells.map((cell, j) => (
            <div key={j} className={cell.tone === "neutral" ? undefined : toneClass(cell.tone)}>
              {cell.value}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A money calculation, line by line, so the total can be checked rather than believed. */
function CalculationBlock({ block }: Props<"calculation">) {
  return (
    <div className="sp-calc">
      {block.lines.map((line, i) => (
        <div className="sp-calc-line" key={`${line.key}-${i}`} data-emphasis={line.emphasis}>
          <span className="sp-calc-key">{line.key}</span>
          <span>{line.value}</span>
        </div>
      ))}
    </div>
  );
}

/** A source document with the lines that were read out of it highlighted. */
function DocumentBlock({ block, onAct }: Props<"document">) {
  return (
    <div>
      <div className="sp-doc-head">
        <div>
          <strong className="sp-doc-name">{block.name}</strong>
          <small className="sp-doc-kind">{block.documentKind}</small>
        </div>
        <span className="sp-badge sp-tone-active">SOURCE</span>
      </div>
      <div className="sp-doc-paper">
        {block.title !== "" && <h3>{block.title}</h3>}
        {block.lines.map((line, i) => (
          <p className="sp-doc-line" key={i}>
            {line.parts.map((part, j) => (
              <span key={j} className={part.highlighted ? "sp-doc-hit" : undefined}>
                {part.text}
              </span>
            ))}
          </p>
        ))}
      </div>
      {block.note !== "" && <p className="sp-doc-note">{block.note}</p>}
      {block.actions.length > 0 && (
        <div className="sp-email-actions">
          <SpaceActions actions={block.actions} onAct={onAct} />
        </div>
      )}
    </div>
  );
}

/**
 * A message, drafted or received.
 *
 * Nothing here sends anything. The verb on a draft is `record_send` — a person sends it and ASAP
 * records that they did, with the evidence. Uncontrolled external communication is forbidden
 * (§45 rule 13), and a "Send" button in a generic block is exactly how that rule gets broken.
 */
function EmailBlock({ block, onAct }: Props<"email">) {
  return (
    <div className="sp-email">
      <div className={`sp-email-head ${toneClass(block.tone)}`}>
        <span className="sp-email-label">{block.headLabel}</span>
        {block.headMeta !== "" && <span className="sp-email-meta">{block.headMeta}</span>}
      </div>
      <div className="sp-email-body">
        {block.to !== "" && <div className="sp-email-to">To · {block.to}</div>}
        <strong className="sp-email-subject">{block.subject}</strong>
        <p className="sp-email-text">{block.body}</p>
        {block.attachments.length > 0 && (
          <div className="sp-attachments">
            {block.attachments.map((a, i) => (
              <span className="sp-attachment" key={`${a.name}-${i}`}>
                <span aria-hidden>⎘</span> {a.name}
              </span>
            ))}
          </div>
        )}
        <div className="sp-email-actions">
          <SpaceActions actions={block.actions} onAct={onAct} />
        </div>
      </div>
    </div>
  );
}

/** Files are read from the device. Nothing is saved until a person confirms. */
function UploadBlock({ block, onAct }: Props<"upload">) {
  return (
    <div className="sp-upload">
      <strong className="sp-upload-prompt">{block.prompt}</strong>
      <small className="sp-upload-note">
        Real files are read from your device. Nothing is saved until you confirm.
      </small>
      <div className="sp-email-actions">
        <SpaceActions actions={block.actions} onAct={onAct} />
      </div>
      {block.progress.length > 0 && (
        <div className="sp-progress">
          {block.progress.map((p, i) => (
            <div key={`${p.name}-${i}`}>
              <div className="sp-progress-row">
                <span>{p.name}</span>
                <span>{p.state}</span>
              </div>
              {/*
               * A file's own byte count, and the only bar in the product. Not a Space's progress
               * (§45 rule 10 keeps that derived from job steps) and never a confidence.
               */}
              <div className="sp-progress-track">
                <i className="sp-progress-fill" style={{ width: `${p.percent}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Owner and due date.
 *
 * Assignment changes owner; it never grants data access — which is a row-level-security question
 * and is not decided here. The block collects the two values and hands them to `onAct`.
 */
function AssignmentBlock({ block, onAct }: Props<"assignment">) {
  const [ownerId, setOwnerId] = useState<string>(block.ownerId ?? "");
  const [dueAt, setDueAt] = useState<string>(block.dueAt ?? "");
  const save = block.actions.find((a) => a.verb === "assign") ?? null;
  const blocked =
    save === null
      ? "You cannot change the owner of this item."
      : (save.notPermittedReason ?? save.disabledReason);

  return (
    <div className="sp-form">
      <div className="sp-field">
        <label className="sp-label" htmlFor={`${block.id}-owner`}>
          OWNER
        </label>
        <select
          id={`${block.id}-owner`}
          className="sp-input"
          value={ownerId}
          disabled={blocked !== null}
          onChange={(e) => setOwnerId(e.target.value)}
        >
          <option value="">Unassigned</option>
          {block.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="sp-field sp-field-narrow">
        <label className="sp-label" htmlFor={`${block.id}-due`}>
          DUE
        </label>
        <input
          id={`${block.id}-due`}
          type="date"
          className="sp-input"
          value={dueAt}
          disabled={blocked !== null}
          onChange={(e) => setDueAt(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="sp-btn-solid"
        disabled={blocked !== null}
        title={blocked ?? undefined}
        onClick={() => save !== null && onAct?.(save)}
      >
        Save assignment
      </button>
      <small className="sp-form-note">{blocked ?? block.permissionNote}</small>
    </div>
  );
}

/** Saved automations start paused, and test mode writes nothing. */
function AutomationBuilderBlock({ block, onAct }: Props<"automation_builder">) {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(block.fields.map((f) => [f.name, f.value])),
  );
  const save = block.actions[0] ?? null;
  const blocked = save === null ? null : (save.notPermittedReason ?? save.disabledReason);
  return (
    <div className="sp-form sp-form-stack">
      {block.fields.map((field) => (
        <div key={field.name}>
          <label className="sp-label" htmlFor={`${block.id}-${field.name}`}>
            {field.label}
          </label>
          <input
            id={`${block.id}-${field.name}`}
            className="sp-input"
            value={values[field.name] ?? ""}
            placeholder={field.placeholder}
            onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
          />
        </div>
      ))}
      <div className="sp-form-actions">
        {save !== null && (
          <button
            type="button"
            className="sp-btn-solid"
            disabled={blocked !== null}
            title={blocked ?? undefined}
            onClick={() => onAct?.(save)}
          >
            {save.label}
          </button>
        )}
        <small className="sp-form-note" style={{ width: "auto" }}>
          Saved automations start paused. Test mode writes nothing.
        </small>
      </div>
    </div>
  );
}

/**
 * The one place an approval is offered.
 *
 * The payload is frozen elsewhere; this block shows what is being permitted and, when it is
 * blocked, the guard's own reason rather than a grey button with no explanation (§34).
 */
function ApprovalGateBlock({ block, onAct }: Props<"approval_gate">) {
  const action = block.actions[0] ?? null;
  const blocked =
    block.blockedNote ??
    (action === null ? null : (action.notPermittedReason ?? action.disabledReason));
  return (
    <div className="sp-gate">
      <strong className="sp-gate-heading">{block.heading}</strong>
      {block.detail !== "" && <p className="sp-gate-detail">{block.detail}</p>}
      <div className="sp-gate-actions">
        {action !== null && (
          <button
            type="button"
            className="sp-btn-gate"
            disabled={blocked !== null}
            title={blocked ?? undefined}
            onClick={() => onAct?.(action)}
          >
            {action.label}
          </button>
        )}
        {blocked !== null && <small className="sp-blocked">{blocked}</small>}
      </div>
    </div>
  );
}

function TimelineBlock({ block }: Props<"timeline">) {
  return (
    <div className="sp-timeline">
      {block.events.map((event) => {
        const body = (
          <>
            <span className="sp-tl-rail" aria-hidden>
              <span className="sp-tl-dot" data-tone={event.tone} />
              <span className="sp-tl-line" />
            </span>
            <span style={{ minWidth: 0 }}>
              <small className="sp-tl-when">{event.when}</small>
              <strong className="sp-tl-text">{event.text}</strong>
              {event.link !== null && <small className="sp-tl-link">{event.link}</small>}
            </span>
          </>
        );
        return event.related !== null ? (
          <Link key={event.id} to={event.related.path} className="sp-tl-event">
            {body}
          </Link>
        ) : (
          <div key={event.id} className="sp-tl-event">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The registry. A block type not in this map does not render — §45 rule 9, as a lookup.
 *
 * The map is exhaustive over `SpaceFrameBlock["type"]` by construction: the type annotation makes
 * a missing entry a compile error and an extra one impossible, so the registry cannot fall behind
 * the contract in either direction.
 */
const REGISTRY: {
  [T in SpaceFrameBlock["type"]]: (props: Props<T>) => React.JSX.Element;
} = {
  facts: FactsBlock,
  rows: RowsBlock,
  missing: MissingBlock,
  note: NoteBlock,
  compare: CompareBlock,
  table: TableBlock,
  calculation: CalculationBlock,
  document: DocumentBlock,
  email: EmailBlock,
  upload: UploadBlock,
  assignment: AssignmentBlock,
  automation_builder: AutomationBuilderBlock,
  approval_gate: ApprovalGateBlock,
  timeline: TimelineBlock,
};

/**
 * The blocks that draw their own actions, because where the control belongs is part of the block:
 * a row's "Open" sits beside its badge, a draft's beside the message, a gate's under its detail.
 * Every other block gets its actions from the shell below, in one place, so they cannot appear
 * twice.
 */
const OWNS_ITS_ACTIONS: ReadonlySet<SpaceFrameBlock["type"]> = new Set([
  "rows",
  "document",
  "email",
  "upload",
  "assignment",
  "automation_builder",
  "approval_gate",
]);

/** True when the renderer has a component for this type. */
export function isRenderableBlock(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, type);
}

/**
 * Render one block, or an error state if it is not in the registry.
 *
 * The unknown case is not defensive noise. A plan reaches the browser after server-side
 * validation, but "the validator and the renderer agree" is the assumption that fails quietly when
 * a component is deprecated and stored blocks still name it. A Space that says so is honest; a
 * Space that renders nothing looks like missing data (§45 rule 9, §36).
 */
export function SpaceBlockView({
  block,
  onAct,
}: {
  block: SpaceFrameBlock;
  onAct?: ActHandler | undefined;
}) {
  if (!isRenderableBlock(block.type)) {
    return (
      <div className="sp-block-state" data-state="error">
        This part of the workspace cannot be shown in this version of ASAP. Nothing is missing from
        the record itself.
      </div>
    );
  }
  // The union is discriminated and the registry is exhaustive over it, so the component and the
  // block always agree; the cast is the one place that fact cannot be expressed to the checker.
  const Component = REGISTRY[block.type] as (props: {
    block: SpaceFrameBlock;
    onAct?: ActHandler | undefined;
  }) => React.JSX.Element;
  return (
    <BlockShell label={block.label} state={block.state} stateNote={block.stateNote}>
      <Component block={block} onAct={onAct} />
      <SpaceEvidenceList evidence={block.evidence} />
      {!OWNS_ITS_ACTIONS.has(block.type) && block.actions.length > 0 && (
        <div className="sp-email-actions">
          <SpaceActions actions={block.actions} onAct={onAct} />
        </div>
      )}
    </BlockShell>
  );
}

export { RelatedSpaces };
