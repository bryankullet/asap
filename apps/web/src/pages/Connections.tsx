import { DEMO_NOTICE } from "@asap/schema";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { DemoBoundary } from "../demo/DemoBoundary.js";
import { useDemo } from "../demo/state.js";

/**
 * Data and connections (D-064).
 *
 * Where a brokerage connects its mailbox. In demo mode a connection is simulated and says so; in
 * production the buttons begin a real OAuth flow, and until that returns, the mailbox is honestly
 * not connected. There is no state in between, and nothing here ever claims a mailbox is attached
 * when it is not.
 */
const PROVIDERS = [
  {
    id: "gmail",
    name: "Gmail",
    detail: "Google Workspace or a Gmail account. ASAP reads and replies in the same thread.",
  },
  {
    id: "microsoft",
    name: "Microsoft 365",
    detail: "Outlook or Exchange Online, through Microsoft Graph.",
  },
] as const;

export function Connections() {
  const { isDemo } = useDemo();
  const [connected, setConnected] = useState<string | null>(isDemo ? "gmail" : null);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-ink">Data and connections</h1>
        <p className="text-sm text-ink-secondary">
          What ASAP is allowed to read on the brokerage's behalf.
        </p>
      </header>

      <section aria-label="Mailboxes" className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink">Mailbox</h2>
        {PROVIDERS.map((p) => {
          const isOn = connected === p.id;
          return (
            <article
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line-strong bg-paper p-3.5"
            >
              <div className="min-w-0">
                <p className="font-medium text-ink">{p.name}</p>
                <p className="text-xs text-ink-muted">{p.detail}</p>
                {isOn && (
                  <p className="text-xs text-accent-green-ink">
                    Connected as grace@asapbrokers.co.ke
                    {isDemo ? " — simulated for this demonstration" : ""}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setConnected(isOn ? null : p.id)}
                className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-ink-muted"
              >
                {isOn ? "Disconnect" : `Connect ${p.name}`}
              </button>
            </article>
          );
        })}
        {!connected && (
          <p className="rounded-card border border-line-soft bg-wash px-3 py-2 text-sm text-ink-secondary">
            No mailbox is connected. ASAP can still read documents and records; it cannot see or
            send email until one is.
          </p>
        )}
      </section>

      <section aria-label="Elsewhere" className="flex flex-col gap-1.5">
        <h2 className="text-sm font-medium text-ink">Elsewhere</h2>
        <Link to="/email" className="text-sm text-ink underline">
          Email conversations
        </Link>
        <Link to="/documents" className="text-sm text-ink underline">
          Documents on file
        </Link>
      </section>

      <DemoBoundary>
        {DEMO_NOTICE} Connecting here is simulated. Production requires real OAuth, your
        permission, and the provider's own evidence before anything is read or sent.
      </DemoBoundary>
    </div>
  );
}
