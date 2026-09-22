import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { SpaceEvidence, SpaceFrameAction, SpaceRef, SpaceTone } from "@asap/schema";

/**
 * The pieces every block shares: evidence, actions, and the one component that turns a Space
 * reference into a link.
 *
 * They live here rather than in each block so the fourteen cannot drift apart — an "Open" that is
 * a button on one block and a link on another is two different behaviours a keyboard can tell
 * apart, and thirteen copies of an evidence list is thirteen places to forget the citation.
 */

/** The tone classes, so a badge and a note read the same tone the same way. */
export function toneClass(tone: SpaceTone): string {
  return `sp-tone-${tone}`;
}

/**
 * Where a block action goes, or what it asks for.
 *
 * `open` is navigation and is rendered as a real link: addressable, middle-clickable, and it
 * survives a reload. Every other verb is a business action, and this component does not perform
 * it — it calls `onAct`, which the page wires to the validated action API. A generic presentation
 * component that wrote to the database would put a mutation in fourteen places (§45 rule 8).
 */
export type ActHandler = (action: SpaceFrameAction) => void;

export function SpaceActions(props: {
  actions: SpaceFrameAction[];
  onAct?: ActHandler | undefined;
  /** The first action drawn as the one next step. Rows use it; forms do not. */
  primaryFirst?: boolean;
}) {
  if (props.actions.length === 0) return null;
  return (
    <>
      {props.actions.map((action, i) => {
        const blocked = action.disabledReason ?? action.notPermittedReason;
        const primary = props.primaryFirst === true && action.verb === "open";
        const className = primary ? "sp-btn-primary" : "sp-btn";
        const key = `${action.verb}-${action.label}-${i}`;

        if (action.verb === "open" && action.to && blocked === null) {
          /*
           * Some things the product points at are not routes: a signed file URL, a message with
           * its provider. Handing one of those to the router would navigate inside the
           * application and land nowhere, so an absolute URL opens as a link out — which is what
           * makes "open the original" a real thing rather than a claim.
           */
          if (/^https?:\/\//.test(action.to.path)) {
            return (
              <a
                key={key}
                href={action.to.path}
                className={className}
                target="_blank"
                rel="noopener noreferrer"
              >
                {action.label}
              </a>
            );
          }
          return (
            <Link key={key} to={action.to.path} className={className}>
              {action.label}
            </Link>
          );
        }
        /*
         * A blocked action is shown disabled with the guard's own words beside it, never hidden
         * and never silently enabled (§34). `title` carries the reason for a pointer; the text
         * beside it carries it for everyone else.
         */
        return (
          <span key={key} className="contents">
            <button
              type="button"
              className={className}
              disabled={blocked !== null}
              title={blocked ?? undefined}
              onClick={() => props.onAct?.(action)}
            >
              {action.label}
            </button>
            {blocked !== null && <small className="sp-blocked">{blocked}</small>}
          </span>
        );
      })}
    </>
  );
}

/** Evidence beneath a fact or a row. A citation you cannot open is not a citation. */
export function SpaceEvidenceList({ evidence }: { evidence: SpaceEvidence[] }) {
  if (evidence.length === 0) return null;
  return (
    <ul className="sp-evidence">
      {evidence.map((e, i) => (
        <li key={`${e.reference}-${i}`}>
          <span aria-hidden>▤</span> {e.label} —{" "}
          <span className="sp-evidence-ref">{e.reference}</span>
          {e.recordedBy ? ` · ${e.recordedBy}` : ""}
        </li>
      ))}
    </ul>
  );
}

/** Where else this record is seen. The tab strip reads the same identities. */
export function RelatedSpaces({ related }: { related: SpaceRef[] }) {
  if (related.length === 0) return null;
  return (
    <nav className="sp-related" aria-label="Related">
      {related.map((ref) => (
        <Link
          key={`${ref.spaceKind}|${ref.recordType}|${ref.recordId ?? ""}|${ref.workflowId ?? ""}`}
          to={ref.path}
          className="sp-related-link"
        >
          <span className="sp-related-kind">{ref.label}</span>
          {ref.title}
        </Link>
      ))}
    </nav>
  );
}

/**
 * A block's own label and its own state.
 *
 * One block can be loading while another has already arrived, and one can be unreadable without
 * taking the Space down with it (§36). `empty` carries its own words, because "no rows" and
 * "nothing needs you" are different facts.
 */
export function BlockShell(props: {
  label: string | null;
  state: "ready" | "loading" | "empty" | "error";
  stateNote: string | null;
  children: ReactNode;
}) {
  return (
    <div>
      {props.label !== null && <div className="sp-block-label">{props.label}</div>}
      {props.state === "ready" ? (
        props.children
      ) : props.state === "loading" ? (
        <div className="sp-block-state" data-state="loading" aria-busy="true">
          <span className="sr-only">{props.stateNote ?? "Reading the records."}</span>
          <div className="sp-skeleton" style={{ width: "70%" }} />
          <div className="sp-skeleton" style={{ width: "45%" }} />
          <div className="sp-skeleton" style={{ width: "58%" }} />
        </div>
      ) : (
        <div className="sp-block-state" data-state={props.state}>
          {props.stateNote ??
            (props.state === "empty" ? "Nothing here yet." : "This could not be read.")}
        </div>
      )}
    </div>
  );
}
