import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { ScreenTitle } from "../shell/ScreenTitle.js";
import { EvidenceConditionChip } from "../components/EvidenceCondition.js";
import { ErrorState, LoadingList, MissingData } from "../components/states.js";
import type { DocumentField } from "@asap/schema";

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
  const me = useMe();
  const qc = useQueryClient();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);

  /* A real brokerage's own files, under its own session. Nothing here is a fixture. */
  const live = useQuery({
    queryKey: ["documents", me.data?.active_organization?.id],
    enabled: Boolean(me.data?.active_organization?.id),
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

        {live.isPending ? (
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

/**
 * One document: the pages ASAP read, and every value it proposes, each awaiting a person.
 *
 * Extraction proposes; a person decides (Phase 3 gate). Accept, correct or reject each field — and
 * a rejected field becomes *missing*, not known, because rejecting a reading does not tell us what
 * the truth is. Nothing here is a business value until somebody accepted it.
 */
export function DocumentViewer() {
  const { documentId = "" } = useParams({ strict: false }) as { documentId?: string };
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ["document", documentId],
    queryFn: () => api.document(documentId),
    enabled: Boolean(documentId),
    retry: false,
  });
  const review = useMutation({
    mutationFn: (input: {
      fieldId: string;
      decision: "accept" | "correct" | "reject";
      value: string | null;
    }) =>
      api.reviewDocumentField(documentId, input.fieldId, {
        decision: input.decision,
        value: input.value,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["document", documentId] }),
  });

  if (detail.isPending) return <LoadingList rows={3} label="Opening the document" />;
  if (detail.isError) {
    return (
      <ErrorState
        what={`We could not open this document. ${describeApiError(detail.error)}`}
        retry={() => void detail.refetch()}
      />
    );
  }
  if (!detail.data) {
    return (
      <MissingData
        what="No document with that id"
        why="It may have been removed, or your role in this brokerage cannot see it."
      />
    );
  }
  const { document: doc, fields, pages, fileUrl } = detail.data;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <Link to="/documents" className="text-sm text-ink-secondary hover:underline">
          ← Documents
        </Link>
        <h1 className="font-heading text-lg font-semibold text-ink">{doc.filename}</h1>
        <p className="text-xs text-ink-muted">
          {doc.kind.replace(/_/g, " ")} ·{" "}
          {doc.pageCount === null ? "not read yet" : `${doc.pageCount} pages`} ·{" "}
          {new Date(doc.createdAt).toLocaleDateString()}
        </p>
        {doc.extractionError && (
          <p className="text-sm text-accent-red">ASAP could not read it: {doc.extractionError}</p>
        )}
      </header>

      <div className="grid gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_22rem]">
        <figure className="flex flex-col gap-2">
          {fileUrl ? (
            <object
              data={fileUrl}
              type={doc.mimeType}
              aria-label={`${doc.filename}, as filed`}
              className="aspect-[1/1.414] w-full rounded-card border border-line-strong bg-paper"
            >
              <a href={fileUrl}>Open {doc.filename}</a>
            </object>
          ) : (
            <div className="grid aspect-[1/1.414] w-full place-items-center rounded-card border border-line-strong bg-paper p-6 text-center text-sm text-ink-muted">
              The file itself is not available to open right now. What ASAP read from it is still
              here.
            </div>
          )}
          {pages.length > 0 && (
            <figcaption className="text-xs text-ink-muted">
              {pages.length} {pages.length === 1 ? "page" : "pages"} read.
            </figcaption>
          )}
        </figure>

        <section aria-label="What ASAP read" className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-ink">What ASAP read</h2>
          {fields.length === 0 ? (
            <p className="text-sm text-ink-muted">
              {doc.extractionState === "queued" || doc.extractionState === "working"
                ? "ASAP is still reading this. Values appear here for review as it finds them."
                : "Nothing was proposed from this document. That is an answer, not an empty list."}
            </p>
          ) : (
            fields.map((field) => (
              <FieldReview
                key={field.id}
                field={field}
                busy={review.isPending}
                onDecide={(decision, value) =>
                  review.mutate({ fieldId: field.id, decision, value })
                }
              />
            ))
          )}
          {review.isError && (
            <p role="alert" className="text-sm text-accent-red">
              That decision was not recorded: {describeApiError(review.error)} The field is still as
              it was.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

/** One proposed value, and the three things a person can do with it. */
function FieldReview({
  field,
  busy,
  onDecide,
}: {
  field: DocumentField;
  busy: boolean;
  onDecide: (decision: "accept" | "correct" | "reject", value: string | null) => void;
}) {
  const [corrected, setCorrected] = useState(field.correctedValue ?? field.proposedValue ?? "");
  const decided = field.state !== "proposed";

  return (
    <article className="flex flex-col gap-2 rounded-card border border-line-strong bg-paper p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-ink-muted">
          {field.fieldKey.replace(/_/g, " ")}
        </span>
        <EvidenceConditionChip condition={field.condition} />
      </div>
      <p className="text-sm text-ink">
        {field.state === "rejected"
          ? "Rejected — this value is missing, not known."
          : (field.correctedValue ?? field.proposedValue ?? "Nothing was read for this field.")}
      </p>
      <p className="text-xs text-ink-muted">
        {field.page === null ? "ASAP could not place this on a page." : `Page ${field.page}`}
        {field.reviewedAt ? ` · decided ${new Date(field.reviewedAt).toLocaleDateString()}` : ""}
      </p>
      {!decided && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            aria-label={`Correct ${field.fieldKey.replace(/_/g, " ")}`}
            value={corrected}
            onChange={(e) => setCorrected(e.target.value)}
            className="min-h-[34px] min-w-[8rem] flex-1 rounded-control border border-line-strong px-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || !field.proposedValue}
            onClick={() => onDecide("accept", null)}
            className="rounded-control bg-navy px-3 py-1 text-sm text-paper hover:bg-navy-hover"
          >
            Accept
          </button>
          <button
            type="button"
            disabled={busy || corrected.trim() === ""}
            onClick={() => onDecide("correct", corrected.trim())}
            className="rounded-control border border-line-strong px-3 py-1 text-sm text-ink hover:border-ink-muted"
          >
            Correct
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide("reject", null)}
            className="rounded-control border border-line-strong px-3 py-1 text-sm text-accent-red hover:border-accent-red"
          >
            Reject
          </button>
        </div>
      )}
    </article>
  );
}
