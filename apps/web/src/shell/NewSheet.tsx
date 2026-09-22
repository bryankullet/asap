import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

/**
 * The "+ New" sheet: the prototype's right-side panel of choices.
 *
 * It is a sheet rather than a page for one reason — what is behind it stays mounted and stays in
 * its tab. A person choosing to start a claim has not left the renewal they were reading, and a
 * screen that replaced it would lose their place.
 *
 * **Choosing an option creates nothing.** Every one of these opens a Space where the real form
 * lives, and the creation happens when a person fills it in and submits. A menu that wrote to the
 * database on a click would be a menu you cannot browse.
 */

export type NewOption = {
  id: string;
  icon: string;
  title: string;
  note: string;
  /** Where it opens. Always a route the application already serves. */
  to: string;
  /** Set when this deployment cannot do it yet: shown, disabled, with the reason. */
  unavailable?: string | undefined;
};

/**
 * The ten paths, in the prototype's order.
 *
 * Every one is genuinely supported: each opens either an existing destination or a creation Space
 * over an endpoint that exists. Where one is not, it carries `unavailable` and says so rather than
 * disappearing — a missing option teaches a person the product cannot do something when in fact it
 * has not been built yet.
 */
export const NEW_OPTIONS: NewOption[] = [
  { id: "ask", icon: "✦", title: "Ask ASAP", note: "A question about this brokerage, answered from your own records.", to: "/ask" },
  { id: "import", icon: "⇪", title: "Import records", note: "A spreadsheet of clients, policies or contacts. Nothing is saved until you confirm.", to: "/import" },
  { id: "document", icon: "▤", title: "Upload a document", note: "A schedule, a debit note, a claim form. ASAP reads it and proposes what it says.", to: "/documents" },
  { id: "client", icon: "◍", title: "Add a client", note: "A company or a person. Duplicates are reviewed before anything is created.", to: "/new/client" },
  { id: "policy", icon: "▤", title: "Record existing cover", note: "Cover you already place, so renewals and claims have something to hang on.", to: "/new/policy" },
  { id: "renewal", icon: "↻", title: "Start a renewal", note: "From a policy period that is ending, with the insurers you want approached.", to: "/new/renewal" },
  {
    id: "quote",
    icon: "◇",
    title: "Start quotation work",
    note: "New business: what the client needs, and who you are asking.",
    to: "/new/quote",
    /*
     * No endpoint yet: `POST /work-items` accepts renewal, claim and endorsement. Shown disabled
     * with the reason rather than removed, because a missing option teaches a person the product
     * cannot do it at all.
     */
    unavailable: "Quotation work is not stored as its own record yet, so there is nothing to start. Renewals and claims are.",
  },
  { id: "claim", icon: "⚑", title: "Register a claim", note: "What happened and when. The cover check comes next, against the policy.", to: "/new/claim" },
  { id: "endorsement", icon: "✎", title: "Start a policy change", note: "A mid-term change: a vehicle added, a sum insured raised.", to: "/new/endorsement" },
  { id: "automation", icon: "⌘", title: "Create an automation", note: "A standing instruction. Saved automations start paused, and test mode writes nothing.", to: "/automations" },
];

export function NewSheet({ onClose }: { onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null);

  /*
   * Escape closes it and focus starts on the close button, because a sheet that traps a keyboard
   * user is worse than no sheet. The scrim is a button for the same reason: clicking away is an
   * action, and an action needs to be reachable without a mouse.
   */
  useEffect(() => {
    close.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onClose]);

  return (
    <div className="sp-scrim sp-space">
      {/* The scrim: clicking away closes, and it is labelled so it is not a mystery target. */}
      <button type="button" aria-label="Close" onClick={onClose} style={{ position: "absolute", inset: 0, border: 0, background: "transparent" }} />
      <section className="sp-sheet" role="dialog" aria-modal="true" aria-label="Start something new">
        <header className="sp-sheet-head">
          <div style={{ minWidth: 0 }}>
            <span className="sp-sheet-kicker">START SOMETHING</span>
            <h2 className="sp-sheet-title">What are we working on?</h2>
          </div>
          <button ref={close} type="button" className="sp-sheet-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="sp-sheet-body">
          <p className="sp-sheet-copy">
            Choosing one opens the place it happens. Nothing is created until you fill that in and
            say so.
          </p>
          <div className="sp-choices-list">
            {NEW_OPTIONS.map((option) =>
              option.unavailable === undefined ? (
                <Link key={option.id} to={option.to} className="sp-sheet-option" onClick={onClose}>
                  <span className="sp-sheet-icon" aria-hidden>
                    {option.icon}
                  </span>
                  <span className="sp-sheet-option-text">
                    <strong>{option.title}</strong>
                    <small>{option.note}</small>
                  </span>
                  <b className="sp-sheet-arrow" aria-hidden>
                    →
                  </b>
                </Link>
              ) : (
                /* Offered, disabled, with the reason — never hidden (§34). */
                <button
                  key={option.id}
                  type="button"
                  className="sp-sheet-option"
                  disabled
                  title={option.unavailable}
                >
                  <span className="sp-sheet-icon" aria-hidden>
                    {option.icon}
                  </span>
                  <span className="sp-sheet-option-text">
                    <strong>{option.title}</strong>
                    <small>{option.unavailable}</small>
                  </span>
                </button>
              ),
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
