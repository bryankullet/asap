import { DEMO_DOCUMENTS, DEMO_NOTICE, demoClient, type DemoDocument } from "@asap/schema";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { EvidenceConditionChip } from "../components/EvidenceCondition.js";
import { MissingData } from "../components/states.js";
import { DemoBoundary } from "../demo/DemoBoundary.js";

/**
 * Documents, the viewer and extraction review (D-064).
 *
 * The rule that shapes this screen: **a citation you cannot open is not a citation.** Every
 * extracted value shows the page it came from and the region on it, and the viewer puts the
 * highlight where the value was read. A value with no position says so instead of pretending.
 *
 * Extraction proposes; a person decides. Accept, correct or reject each field — and a rejected
 * field becomes missing, not known, because rejecting a reading does not tell us the truth.
 */
export function Documents() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-semibold text-ink">Documents</h1>
        <p className="text-sm text-ink-secondary">
          Everything on file, and what ASAP read from it. Nothing here is treated as known until a
          person has accepted it.
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {DEMO_DOCUMENTS.map((d) => {
          const client = demoClient(d.clientId);
          return (
            <li key={d.id}>
              <Link
                to="/documents/$documentId"
                params={{ documentId: d.id }}
                className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line-strong bg-paper p-3.5 hover:border-ink-muted"
              >
                <span className="flex flex-col">
                  <span className="font-medium text-ink">{d.name}</span>
                  <span className="text-xs text-ink-muted">
                    {client?.shortName} · {d.kind} · {d.pages} pages
                  </span>
                </span>
                <EvidenceConditionChip condition={d.highlight.state} />
              </Link>
            </li>
          );
        })}
      </ul>

      <DemoBoundary>{DEMO_NOTICE}</DemoBoundary>
    </div>
  );
}

export function DocumentViewer() {
  const { documentId = "" } = useParams({ strict: false }) as { documentId?: string };
  const doc = DEMO_DOCUMENTS.find((d) => d.id === documentId);
  if (!doc) return <MissingData what="No document with that id" why="It may have been removed." />;
  return <DocumentBody doc={doc} />;
}

function DocumentBody({ doc }: { doc: DemoDocument }) {
  const client = demoClient(doc.clientId);
  const [decision, setDecision] = useState<"proposed" | "accepted" | "corrected" | "rejected">(
    "proposed",
  );
  const [corrected, setCorrected] = useState(doc.highlight.value);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <Link to="/documents" className="text-sm text-ink-secondary hover:underline">
          ← Documents
        </Link>
        <h1 className="font-heading text-lg font-semibold text-ink">{doc.name}</h1>
        <p className="text-xs text-ink-muted">
          {client?.name} · {doc.kind} · {doc.pages} pages
        </p>
      </header>

      <div className="grid gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_22rem]">
        {/* The page, with the region the value was read from marked on it. */}
        <figure className="flex flex-col gap-2">
          <div className="relative aspect-[1/1.414] w-full overflow-hidden rounded-card border border-line-strong bg-paper">
            <div className="absolute inset-0 grid place-items-center text-sm text-ink-muted">
              Page {doc.highlight.page} of {doc.pages}
            </div>
            <div
              aria-label={`Highlighted: ${doc.highlight.field}`}
              className="absolute left-[12%] top-[26%] h-[4%] w-[46%] rounded-[3px] border-2 border-accent-gold bg-accent-gold-soft/60"
            />
          </div>
          <figcaption className="text-xs text-ink-muted">
            The highlight marks where “{doc.highlight.field}” was read, on page {doc.highlight.page}.
          </figcaption>
        </figure>

        <section
          aria-label="Extraction review"
          className="flex h-fit flex-col gap-3 rounded-card border border-line-strong bg-paper p-4"
        >
          <h2 className="text-sm font-medium text-ink">What ASAP read</h2>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-ink-muted">
              {doc.highlight.field}
            </span>
            <span className="text-base font-medium text-ink">{doc.highlight.value}</span>
            <span className="flex items-center gap-2 text-xs text-ink-muted">
              Page {doc.highlight.page}
              <EvidenceConditionChip condition={doc.highlight.state} />
            </span>
          </div>

          {decision === "proposed" ? (
            <>
              <p className="text-xs text-ink-muted">
                This is a reading, not a fact. Accept it, correct it, or reject it.
              </p>
              <label htmlFor="corrected" className="sr-only">
                Corrected value
              </label>
              <input
                id="corrected"
                value={corrected}
                onChange={(e) => setCorrected(e.target.value)}
                className="min-h-[38px] rounded-control border border-line-strong px-3 text-sm"
              />
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDecision("accepted")}
                  className="rounded-control bg-navy px-3 py-1.5 text-sm text-paper hover:bg-navy-hover"
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={() => setDecision("corrected")}
                  disabled={corrected.trim() === doc.highlight.value}
                  className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-ink-muted disabled:opacity-50"
                >
                  Save correction
                </button>
                <button
                  type="button"
                  onClick={() => setDecision("rejected")}
                  className="rounded-control border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-ink-muted"
                >
                  Reject
                </button>
              </div>
            </>
          ) : (
            <p className="rounded-card bg-wash px-3 py-2 text-sm text-ink-secondary">
              {decision === "accepted" && "Accepted. This is now recorded as known, by you."}
              {decision === "corrected" && `Corrected to “${corrected}”. What ASAP read is kept alongside it.`}
              {/* Rejecting a reading does not establish the truth. */}
              {decision === "rejected" &&
                "Rejected. This field is now missing rather than known — rejecting a reading does not tell us the right value."}
            </p>
          )}

          <DemoBoundary>{DEMO_NOTICE}</DemoBoundary>
        </section>
      </div>
    </div>
  );
}
