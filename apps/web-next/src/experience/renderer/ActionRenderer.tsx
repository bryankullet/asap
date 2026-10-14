import type { ActionSpec } from "@asap/schema";
import { useEffect, useRef, useState } from "react";
import type { DispatchExtra } from "../interactions/ActionDispatcher.js";
import { useAction, useExperience } from "../context/ExperienceContext.js";

/**
 * One governed action as a control. Unavailable actions are shown with the reason, never hidden.
 * A protected business operation opens its confirmation first, listing exactly what will happen.
 */
export function ActionButton({ id, extra, small, quiet, labelOverride }: { id: string | null | undefined; extra?: DispatchExtra; small?: boolean; quiet?: boolean; labelOverride?: string }) {
  const action = useAction(id);
  const { run, pending } = useExperience();
  const [confirming, setConfirming] = useState(false);
  if (!action) return null;
  const busy = pending.has(action.id);
  const go = () => (action.confirm ? setConfirming(true) : void run(action.id, extra));
  return (
    <span className="x-action">
      <button
        type="button"
        className={`x-btn${small ? " x-btn-sm" : ""}`}
        data-primary={action.primary && !quiet ? "true" : "false"}
        data-quiet={quiet ? "true" : "false"}
        aria-disabled={action.disabledReason || busy ? "true" : "false"}
        title={action.disabledReason ?? undefined}
        onClick={() => {
          if (!action.disabledReason && !busy) go();
        }}
      >
        {busy ? <span className="x-working">Working</span> : (labelOverride ?? action.label)}
      </button>
      {action.disabledReason ? <span className="x-help" role="note">{action.disabledReason}</span> : null}
      {confirming ? (
        <ConfirmDialog
          action={action}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void run(action.id, extra);
          }}
        />
      ) : null}
    </span>
  );
}

function ConfirmDialog({ action, onCancel, onConfirm }: { action: ActionSpec; onCancel: () => void; onConfirm: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    confirmRef.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onCancel]);
  return (
    <div className="x-dialog-scrim" role="presentation" onClick={onCancel}>
      <div className="x-dialog" role="dialog" aria-modal="true" aria-labelledby={`confirm-${action.id}`} onClick={(e) => e.stopPropagation()}>
        <h2 id={`confirm-${action.id}`}>{action.confirm!.heading}</h2>
        <ul>
          {action.confirm!.effects.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <div className="x-row" style={{ justifyContent: "flex-end" }}>
          <button type="button" className="x-btn" onClick={onCancel}>
            Cancel
          </button>
          <button ref={confirmRef} type="button" className="x-btn" data-primary="true" onClick={onConfirm}>
            {action.label}
          </button>
        </div>
      </div>
    </div>
  );
}
