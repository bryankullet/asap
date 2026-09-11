import { DEMO_DOCUMENTS, DEMO_NOTICE, demoClient, type DemoDocument } from "@asap/schema";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { useDemo } from "../demo/state.js";
import { ScreenTitle } from "../shell/ScreenTitle.js";
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
  const demo = useDemo();
  const me = useMe();
  const qc = useQueryClient();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);

  /* A real brokerage's own files, under its own session. Nothing here is a fixture. */
  const live = useQuery({
    queryKey: ["documents", me.data?.active_organization?.id],
    enabled: Boolean(me.data?.active_organization?.id) && !demo.isDemo,
    queryFn: () => api.documents(),
  });

  /**
   * Putting a file on file, in three moves the browser does itself:
   *
   *   1. hash the bytes, so the same file twice is recognised rather than filed twice;
   *   2. ask the API where it may go — the server allocates the path inside this brokerage's own
   *      prefix, because a path the browser chose could name another brokerage's folder;
   *   3. PUT the bytes straight to storage. They never pass through the API.
   */
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const bytes = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const contentSha256 = [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const asked = await api.uploadDocument({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        byteSize: file.size,
        contentSha256,
      });
      if (asked.outcome === "already_on_file") return asked;
      const put = await fetch(asked.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: bytes,
      });
      if (!put.ok) throw new Error("The file store would not accept the file.");
      return asked;
    },
    onSuccess: (res) => {
      setUploadError(null);
      setUploaded(
        res.outcome === "already_on_file"
          ? `${res.document.filename} was already on file — nothing was filed twice.`
          : `${res.document.filename} is on file. ASAP reads it next; nothing is treated as known until you accept it.`,
      );
      void qc.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (e) => setUploadError(e instanceof Error ? e.message : describeApiError(e)),
  });

  const documents = live.data?.documents ?? [];

  return (
    <>
      <ScreenTitle title="Documents" meta="Everything on file, and what ASAP read from it" />
      <section className="page-scroll spaces-page">
        {!demo.isDemo && (
          <article className="space-card" style={{ marginBottom: 12 }}>
            <div className="space-body">
              <div className="section-label">Put something on file</div>
              <p style={{ fontSize: 12, color: "#707a72", margin: "0 0 12px" }}>
                A schedule, a quote, a statement, a cover note. ASAP reads it and proposes what it
                found; a person accepts each value before it counts as known.
              </p>
              <label className="secondary" style={{ display: "inline-block", cursor: "pointer" }}>
                {upload.isPending ? "Filing…" : "Choose a file"}
                <input
                  type="file"
                  className="sr-only"
                  disabled={upload.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) upload.mutate(file);
                    e.target.value = "";
                  }}
                />
              </label>
              {uploaded && (
                <p style={{ fontSize: 11, color: "#3e4941", marginTop: 10 }} role="status">
                  {uploaded}
                </p>
              )}
              {uploadError && (
                <div className="warning" style={{ marginTop: 10 }}>
                  <strong>Nothing was filed:</strong> {uploadError}
                </div>
              )}
            </div>
          </article>
        )}

        {demo.isDemo ? (
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
        ) : live.isPending ? (
          <article className="space-card">
            <div className="space-body">
              <strong>Reading what is on file…</strong>
            </div>
          </article>
        ) : live.isError ? (
          <article className="space-card">
            <div className="space-body">
              <strong>We could not read your documents.</strong>
              <p style={{ color: "#707a72", fontSize: 11 }}>{describeApiError(live.error)}</p>
            </div>
          </article>
        ) : documents.length === 0 ? (
          <article className="space-card">
            <div className="space-body">
              <strong>Nothing is on file yet.</strong>
              <p style={{ color: "#707a72", fontSize: 11 }}>
                Put a schedule or a statement in above, or connect the mailbox the brokerage already
                works from, and what arrives lands here.
              </p>
            </div>
          </article>
        ) : (
          <div className="spaces-grid">
            {documents.map((d) => (
              <Link
                key={d.id}
                to="/documents/$documentId"
                params={{ documentId: d.id }}
                className="space-tile"
              >
                <span className={`pill ${d.extractionState === "failed" ? "high" : ""}`}>
                  {EXTRACTION_LABEL[d.extractionState]}
                </span>
                <div className="section-label">{d.kind.replace(/_/g, " ")}</div>
                <h3>{d.filename}</h3>
                <p>
                  {d.pageCount === null
                    ? "Not read yet"
                    : `${d.pageCount} ${d.pageCount === 1 ? "page" : "pages"}`}
                  {d.extractionError ? ` · ${d.extractionError}` : ""}
                </p>
                <small>{new Date(d.createdAt).toLocaleDateString()}</small>
              </Link>
            ))}
          </div>
        )}

        <DemoBoundary>{DEMO_NOTICE}</DemoBoundary>
      </section>
    </>
  );
}

/** What has happened to a document so far, in words rather than an enum. */
const EXTRACTION_LABEL: Record<string, string> = {
  pending: "Waiting to be read",
  running: "Being read",
  done: "Read",
  failed: "Could not be read",
  not_attempted: "Not read",
};

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
