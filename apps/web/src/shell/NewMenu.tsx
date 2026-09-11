import { Card } from "@asap/ui";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

/**
 * H05 `+ New`. It was a non-interactive label reading "arrives with import in a later phase",
 * which is the one thing an interaction may never be: inert with no way forward.
 *
 * It now offers exactly what the application can actually do today, and says plainly what it
 * cannot. Creating a client and opening a renewal, a claim or an endorsement are real paths
 * through `POST /clients` and `POST /work-items`, and they all run through Ask, which already
 * carries the duplicate-review and ambiguous-client flows (D-050). Uploading a file and importing
 * a batch are not built, so they are listed as unavailable **with the reason**, not hidden — a
 * person should be able to see that ASAP knows the path exists.
 */
type Choice = {
  label: string;
  hint: string;
  /** The words this puts in the Ask composer. Null means the path is not built yet. */
  ask: string | null;
  unavailable?: string;
};

const CHOICES: Choice[] = [
  {
    label: "A client",
    hint: "Names it, checks for a duplicate first, and opens the file.",
    ask: "Add client ",
  },
  {
    label: "A renewal",
    hint: "Opens the renewal for a client and prepares the pack.",
    ask: "Renew ",
  },
  {
    label: "A claim",
    hint: "Records what the client reported. You register it against a period.",
    ask: "Claim for ",
  },
  {
    label: "A change to a policy",
    hint: "An endorsement: what the client asked for, in their words.",
    ask: "Endorse ",
  },
  {
    label: "Upload a file",
    hint: "Documents arrive with extraction.",
    ask: null,
    unavailable:
      "Document storage and extraction are not built yet. Record the reference on the client's file instead, and the document will attach to it when they arrive.",
  },
  {
    label: "Import a batch of records",
    hint: "Clients, policies and periods from a spreadsheet.",
    ask: null,
    unavailable:
      "Import is not built yet. Records can be created one at a time above, and each is checked for a duplicate.",
  },
];

export function NewMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setNote(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={className}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => {
          setOpen((o) => !o);
          setNote(null);
        }}
        className="w-full rounded-compact px-2 py-2 text-left text-sm font-semibold text-ink-secondary hover:bg-wash hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-green"
      >
        + New
      </button>
      {open && (
        <Card
          id={menuId}
          role="menu"
          aria-label="Create"
          className="absolute bottom-full left-0 z-30 mb-2 flex w-[min(320px,80vw)] flex-col gap-1 p-2 shadow-card"
        >
          <p className="px-2 pt-1 pb-2 text-xs font-bold tracking-wide text-ink-muted uppercase">
            What would you like to start?
          </p>
          {CHOICES.map((c) => (
            <button
              key={c.label}
              type="button"
              role="menuitem"
              className={
                "rounded-compact px-2.5 py-2 text-left hover:bg-wash " +
                (c.ask ? "text-ink" : "text-ink-muted")
              }
              onClick={() => {
                if (c.ask) {
                  // Ask already owns creation: it matches the client, reviews duplicates and
                  // opens what it created. + New is a way in, not a second write path.
                  setOpen(false);
                  void navigate({ to: "/discover", search: { ask: c.ask } });
                } else {
                  setNote(c.unavailable ?? null);
                }
              }}
            >
              <span className="block text-sm font-semibold">
                {c.label}
                {!c.ask && <span className="ml-2 font-normal text-ink-muted">— not available yet</span>}
              </span>
              <span className="block text-[0.8125rem] text-ink-muted">{c.hint}</span>
            </button>
          ))}
          {note && (
            <p
              role="status"
              className="mt-1 rounded-card border border-accent-gold/25 bg-accent-gold-soft px-2.5 py-2 text-[0.8125rem] text-accent-gold-ink"
            >
              {note}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
