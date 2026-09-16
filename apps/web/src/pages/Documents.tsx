import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { ScreenTitle } from "../shell/ScreenTitle.js";
import { EvidenceConditionChip } from "../components/EvidenceCondition.js";
import { ErrorState, LoadingList, MissingData } from "../components/states.js";
import { ApplyToRecord } from "../features/documents/ApplyToRecord.js";
import { readingStatus, type DocumentField, type PageRegion } from "@asap/schema";

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
  /*
   * The upload's own state, because a mutation's `isPending` cannot say *how far*.
   *
   * `sent`/`total` come from the transport and are only shown when it reports them: a percentage
   * nobody measured is worse than no percentage. `controller` is what Cancel aborts.
   */
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [inFlight, setInFlight] = useState<XMLHttpRequest | null>(null);
  const [lastFile, setLastFile] = useState<File | null>(null);

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setLastFile(file);
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

      /*
       * XHR rather than fetch, for two things fetch cannot do: report how many bytes have
       * actually gone, and be aborted mid-transfer. Both are things a person uploading a 30MB
       * scan on a Nairobi mobile connection needs.
       *
       * Retrying re-PUTs the same object path, so a retry cannot make a second document: the row
       * and its path were allocated once, before any byte moved.
       */
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        setInFlight(xhr);
        xhr.open("PUT", asked.uploadUrl, true);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          // Only when the transport actually knows. `lengthComputable` false means no percentage.
          if (e.lengthComputable) setProgress({ sent: e.loaded, total: e.total });
        };
        xhr.onload = () =>
          xhr.status >= 200 && xhr.status < 300
            ? resolve()
            : reject(new Error("The file store would not accept the file."));
        xhr.onerror = () => reject(new Error("The file store could not be reached."));
        xhr.onabort = () => reject(new Error("upload_cancelled"));
        xhr.send(bytes);
      }).finally(() => {
        setInFlight(null);
        setProgress(null);
      });
      /*
       * The upload went straight to storage, so the API has not seen it and does not know it
       * finished. Telling it is what puts the document in the queue to be read — without this the
       * file sits in the bucket and "ASAP reads it next" is not true.
       */
      const filed = await api.documentFiled(asked.document.id);
      return { ...asked, document: filed.document };
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
    onError: (e) => {
      const message = e instanceof Error ? e.message : describeApiError(e);
      // Cancelling is not a failure, and the file is genuinely not on file either way.
      setUploadError(
        message === "upload_cancelled"
          ? "Upload cancelled. Nothing was filed."
          : `${message} Nothing was filed — the file is not on file.`,
      );
      setUploaded(null);
    },
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
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <label className="secondary" style={{ display: "inline-block", cursor: "pointer" }}>
                {upload.isPending ? "Uploading…" : "Choose a file"}
                <input
                  type="file"
                  className="sr-only"
                  disabled={upload.isPending}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setUploadError(null);
                      setUploaded(null);
                      upload.mutate(file);
                    }
                    e.target.value = "";
                  }}
                />
              </label>

              {/* Cancel stops the transfer itself, not just the waiting. */}
              {upload.isPending && (
                <button type="button" className="secondary" onClick={() => inFlight?.abort()}>
                  Cancel
                </button>
              )}

              {/*
                  Retry re-sends the same file to the same allocated path, so it cannot make a
                  second document. Only offered after a failure, and only while we still hold the
                  file the person chose.
                */}
              {!upload.isPending && uploadError && lastFile && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setUploadError(null);
                    upload.mutate(lastFile);
                  }}
                >
                  Try again
                </button>
              )}
            </div>

            {/*
                While bytes are moving. The percentage appears only when the transport reported
                both numbers — a progress bar nobody measured is a lie that looks like progress.
              */}
            {upload.isPending && (
              <p style={{ fontSize: 11, color: "#3e4941", marginTop: 10 }} role="status">
                {progress
                  ? `Uploading — ${Math.floor((progress.sent / progress.total) * 100)}% of ${Math.ceil(progress.total / 1024)}KB sent.`
                  : "Uploading. Nothing is on file until this finishes."}
              </p>
            )}
            {uploaded && !upload.isPending && (
              <p style={{ fontSize: 11, color: "#3e4941", marginTop: 10 }} role="status">
                {uploaded}
              </p>
            )}
            {uploadError && (
              <div className="warning" style={{ marginTop: 10 }} role="alert">
                {uploadError}
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
                {/*
                    The state a person reads, derived from where the machine got to *and* what it
                    read (D-076). `extractionState` alone cannot tell "ready to check" from "two
                    pages disagree" from "nothing could be read", and those are three jobs.
                  */}
                <span className={`pill ${d.extractionState === "failed" ? "high" : ""}`}>
                  {readingStatus({ extractionState: d.extractionState, fields: [] }).label}
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
  /* Reading it again, after a failure. Only a failure offers this; see the route's own comment. */
  const retry = useMutation({
    mutationFn: () => api.retryExtraction(documentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["document", documentId] });
      void qc.invalidateQueries({ queryKey: ["documents"] });
    },
  });
  /** Which value the page panel is showing the region of. A citation you cannot open is not one. */
  const [shown, setShown] = useState<string | null>(null);

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
  const status = readingStatus({ extractionState: doc.extractionState, fields });
  const shownField = fields.find((f) => f.id === shown) ?? null;

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
        <p className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`pill ${status.state === "failed" ? "high" : ""}`}>{status.label}</span>
          {status.awaiting > 0 && (
            <span className="text-ink-secondary">
              {status.awaiting} {status.awaiting === 1 ? "value" : "values"} waiting for you
            </span>
          )}
        </p>
        {doc.extractionError && (
          <p className="text-sm text-accent-red">ASAP could not read it: {doc.extractionError}</p>
        )}
        {status.retryable && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="secondary"
              disabled={retry.isPending}
              onClick={() => retry.mutate()}
            >
              {retry.isPending ? "Asking for another read…" : "Try reading it again"}
            </button>
            <span className="text-xs text-ink-muted">
              The file is already on file. Nothing is uploaded again.
            </span>
          </div>
        )}
        {retry.isError && (
          <p role="alert" className="text-sm text-accent-red">
            It could not be queued again: {describeApiError(retry.error)}
          </p>
        )}
        {retry.data?.retried === false && (
          <p className="text-sm text-ink-secondary">
            Nothing was queued — this document is {readingStatus({ extractionState: retry.data.document.extractionState, fields: [] }).label.toLowerCase()} already.
          </p>
        )}
      </header>

      <div className="grid gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_22rem]">
        <figure className="flex flex-col gap-2">
          {shownField && shownField.page !== null && shownField.region && (
            <PageHighlight
              page={pages.find((p) => p.pageNumber === shownField.page) ?? null}
              pageNumber={shownField.page}
              region={shownField.region}
              label={shownField.fieldKey.replace(/_/g, " ")}
              {...(fileUrl === null ? {} : { fileUrl })}
            />
          )}
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
                shown={field.id === shown}
                onShow={() => setShown(field.id === shown ? null : field.id)}
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

          {/*
              Applying is offered once a person has decided at least one value. Before that there
              is nothing to apply: an unreviewed reading is still a proposal, and the API refuses
              it (§45 rule 8).
            */}
          {fields.some((f) => f.state === "accepted" || f.state === "corrected") && (
            <ApplyToRecord documentId={doc.id} />
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
  shown,
  onShow,
  onDecide,
}: {
  field: DocumentField;
  busy: boolean;
  shown: boolean;
  onShow: () => void;
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
      <p className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
        {field.page === null || !field.region ? (
          // Honest about it, rather than a link that opens nothing.
          <span>ASAP could not place this on a page.</span>
        ) : (
          <button
            type="button"
            onClick={onShow}
            aria-pressed={shown}
            className="rounded-pill border border-line-strong px-2 py-0.5 text-xs text-ink-secondary hover:border-line-hover"
          >
            {shown ? "Hide where it was read" : `Show where it was read · page ${field.page}`}
          </button>
        )}
        {field.reviewedAt ? <span>decided {new Date(field.reviewedAt).toLocaleDateString()}</span> : null}
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

/**
 * Where on the page a value was read.
 *
 * **A citation you cannot open is not a citation.** The screen claimed to put a highlight where a
 * value came from and never drew one, so every "Page 1" was a number a person had to take on
 * trust. This draws the rectangle the extractor recorded, in that page's own coordinates, over a
 * plain outline of the page — which places correctly on any rendering of it, including none.
 *
 * It is deliberately not a rendering of the document. The bytes are behind a short-lived signed
 * URL and shown by the browser's own viewer below; overlaying that is not something we can do
 * honestly across viewers. What this answers is the question the citation raises: *whereabouts on
 * the page should I be looking?* — with a link to open the file itself at that page.
 */
function PageHighlight({
  page,
  pageNumber,
  region,
  label,
  fileUrl,
}: {
  page: { pageNumber: number; width: number; height: number; text: string } | null;
  pageNumber: number;
  region: PageRegion;
  label: string;
  fileUrl?: string;
}) {
  // A page we have no dimensions for cannot be drawn to scale. A4 at 72dpi is the extractor's
  // own default and is stated as an assumption rather than presented as the page's real size.
  const width = page?.width ?? 595;
  const height = page?.height ?? 842;
  return (
    <div className="flex flex-col gap-1 rounded-card border border-line-strong bg-paper p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-ink-muted">
          {label} · page {pageNumber}
        </span>
        {fileUrl && (
          <a
            href={`${fileUrl}#page=${pageNumber}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-ink-secondary underline"
          >
            Open the file at this page
          </a>
        )}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Page ${pageNumber}, with the region ${label} was read from marked`}
        className="max-h-[22rem] w-full rounded-control border border-line-soft bg-wash"
        preserveAspectRatio="xMidYMin meet"
      >
        <rect x={0} y={0} width={width} height={height} fill="var(--color-paper, #ffffff)" />
        <rect
          x={region.x}
          y={region.y}
          width={region.width}
          height={region.height}
          fill="var(--color-accent-gold-soft, #fbf4dc)"
          stroke="var(--color-accent-gold, #d9a62e)"
          strokeWidth={2}
        />
      </svg>
      {!page && (
        <p className="text-xs text-ink-muted">
          The page's own size was not recorded, so this is drawn against a standard page. The
          region is exactly what was recorded.
        </p>
      )}
    </div>
  );
}
