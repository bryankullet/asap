import { DEMO_NOTICE } from "@asap/schema";
import { DemoBoundary } from "../demo/DemoBoundary.js";
import { useDemo } from "../demo/state.js";

/**
 * Audit history (D-064).
 *
 * §45 rule 15: AI actions, automation runs and job failures are never hidden from the history.
 * This is the brokerage-wide view of that — everything done in this session, in order, including
 * the things that were only prepared and the things that were simulated.
 *
 * In production the same surface reads `audit_log`, which is written server-side under the
 * caller's own session and carries who, what, which record, and what changed.
 */
export function AuditHistory() {
  const demo = useDemo();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-ink">Audit history</h1>
        <p className="text-sm text-ink-secondary">
          Everything that happened, in order — including what ASAP only prepared, and what a person
          decided.
        </p>
      </header>

      {demo.events.length === 0 ? (
        <p className="rounded-card border border-line-soft bg-paper p-4 text-sm text-ink-secondary">
          Nothing has happened in this session yet. Approve something, send a message or switch an
          automation on, and it will be recorded here.
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {demo.events.map((e, i) => (
            <li
              key={i}
              className="flex flex-wrap items-baseline gap-3 rounded-card border border-line-soft bg-paper px-3 py-2 text-sm"
            >
              <span className="shrink-0 text-xs tabular-nums text-ink-muted">{e.at}</span>
              <span className="text-ink-secondary">{e.text}</span>
            </li>
          ))}
        </ol>
      )}

      <DemoBoundary>
        {DEMO_NOTICE} In production this reads the audit log, written server-side with who did what
        to which record.
      </DemoBoundary>
    </div>
  );
}
