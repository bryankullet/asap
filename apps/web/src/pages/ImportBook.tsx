import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import type { ImportPreviewResponse, ImportRowPreview, PremiumBasis } from "@asap/schema";
import { IMPORT_ROW_LIMIT } from "@asap/schema";
import { api, describeApiError } from "../lib/api.js";
import { useMe } from "../lib/me.js";
import { ScreenTitle } from "../shell/ScreenTitle.js";

/**
 * Bringing an existing book in (D-070).
 *
 * Two steps on one screen, in the order a person actually does them: choose the file and say what
 * its premium column means, then read what it would do before any of it happens.
 *
 * The preview is the point. Every row says what it would create, what it matched, or why it cannot
 * be written — and a row that cannot be written is shown rather than quietly dropped, because a
 * person who uploaded four hundred lines and got three hundred and ninety-eight deserves to know
 * which two and why.
 */
/** How the file was read, in the words the screen uses. */
const SOURCE_WORD: Record<string, string> = {
  csv: "a CSV",
  spreadsheet: "the first sheet of your spreadsheet",
  pdf: "the table printed in that PDF",
};

/**
 * The largest file read in one request.
 *
 * Base64 costs a third on the wire, and the whole thing is parsed in memory, so this is a real
 * limit rather than a guess. Stated on the screen in the file's own terms.
 */
const MAX_FILE_BYTES = 8_000_000;

export function ImportBook() {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [file, setFile] = useState<{ name: string; base64: string; type: string } | null>(null);
  const [basis, setBasis] = useState<PremiumBasis | "">("");
  const [preview, setPreview] = useState<ImportPreviewResponse | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [readError, setReadError] = useState<string | null>(null);

  const past = useQuery({
    queryKey: ["imports", me.data?.active_organization?.id],
    queryFn: () => api.imports(),
    enabled: Boolean(me.data?.active_organization?.id),
    retry: false,
  });

  const read = useMutation({
    mutationFn: () =>
      api.previewImport({
        filename: file!.name,
        content: file!.base64,
        mimeType: file!.type,
        premiumBasis: basis === "" ? null : basis,
      }),
    onSuccess: (res) => {
      setPreview(res);
      setSkipped(new Set());
    },
  });

  const commit = useMutation({
    mutationFn: () =>
      api.commitImport(preview!.batch.id, { skipLineNumbers: [...skipped] }),
    onSuccess: () => {
      void qc.invalidateQueries();
      void navigate({ to: "/files", search: { view: "blocking" } });
    },
  });

  async function chooseFile(f: File) {
    setReadError(null);
    setPreview(null);
    if (f.size > MAX_FILE_BYTES) {
      setReadError(
        `That file is ${Math.round(f.size / 1_000_000)}MB. Files up to ${MAX_FILE_BYTES / 1_000_000}MB can be read in one go — split it, or export fewer columns.`,
      );
      return;
    }
    try {
      // The bytes, whatever kind of file it is: the server decides how to read it, so a CSV, a
      // spreadsheet and a PDF all reach the same validation and the browser never interprets a
      // cell. Chunked so a few megabytes do not blow the argument limit of String.fromCharCode.
      const buffer = new Uint8Array(await f.arrayBuffer());
      let binary = "";
      for (let i = 0; i < buffer.length; i += 8192) {
        binary += String.fromCharCode(...buffer.subarray(i, i + 8192));
      }
      setFile({ name: f.name, base64: btoa(binary), type: f.type || "application/octet-stream" });
    } catch {
      setReadError("That file could not be read from your computer. Try choosing it again.");
    }
  }

  const summary = preview?.summary;
  const writable = (preview?.rows ?? []).filter(
    (r) => (r.outcome === "create" || r.outcome === "match") && !skipped.has(r.lineNumber),
  ).length;
  const ready = preview !== null && preview.blocking.length === 0 && writable > 0;

  return (
    <>
      <ScreenTitle
        title="Import your book"
        meta="Clients, the people at them, and the cover you already place"
      />

      <section className="page-scroll spaces-page">
        <article className="space-card" style={{ marginBottom: 12 }}>
          <div className="space-head">
            <div className="space-type">
              <span>STEP ONE</span>
            </div>
            <h2>The book you already have</h2>
            <p>
              A spreadsheet, a CSV, or a PDF your old system printed — one row per policy, or one
              per client if you are starting with names. ASAP works out what the column headings
              mean itself, and you can correct it before anything is written. Up to{" "}
              {IMPORT_ROW_LIMIT.toLocaleString()} rows and {MAX_FILE_BYTES / 1_000_000}MB at a time.
            </p>
          </div>
          <div className="space-body">
            <label className="secondary" style={{ display: "inline-block", cursor: "pointer" }}>
              {file ? "Choose a different file" : "Choose a file"}
              <input
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,.xlsm,.xls,.pdf,text/csv,application/pdf"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void chooseFile(f);
                  e.target.value = "";
                }}
              />
            </label>
            {file && (
              <p style={{ fontSize: 12, color: "#3e4941", marginTop: 10 }}>
                <strong>{file.name}</strong> is ready to read.
              </p>
            )}
            {readError && (
              <div className="warning" style={{ marginTop: 10 }}>
                {readError}
              </div>
            )}

            {/*
              Asked once, and never inferred. The two differ by the statutory levies and cannot be
              told apart from the numbers — recording one as the other is silent until commission
              stops reconciling.
            */}
            <div className="form-row" style={{ marginTop: 14 }}>
              <label htmlFor="premium-basis">IF YOUR FILE HAS A PREMIUM COLUMN, WHAT IS IN IT?</label>
              <select
                id="premium-basis"
                value={basis}
                onChange={(e) => setBasis(e.target.value as PremiumBasis | "")}
              >
                <option value="">My file has no premium column</option>
                <option value="gross">Gross premium, before the levies</option>
                <option value="total_payable">The total the client pays</option>
              </select>
            </div>

            <button
              type="button"
              className="new-btn"
              disabled={!file || read.isPending}
              onClick={() => read.mutate()}
            >
              {read.isPending ? "Reading…" : "Read the file"}
            </button>
            {read.isError && (
              <div className="warning" style={{ marginTop: 10 }}>
                <strong>Nothing was read:</strong> {describeApiError(read.error)}
              </div>
            )}
          </div>
        </article>

        {preview && (
          <article className="space-card" style={{ marginBottom: 12 }}>
            <div className="space-head">
              <div className="space-type">
                <span>STEP TWO</span>
              </div>
              <h2>What this would do</h2>
              <p>
                Nothing below has been written yet. {summary?.rows ?? 0} rows read from{" "}
                {preview.source === "spreadsheet" && preview.sheetName
                  ? `the “${preview.sheetName}” sheet of your spreadsheet`
                  : SOURCE_WORD[preview.source]}
                {summary ? `, ${writable} of them ready` : ""}.
              </p>
            </div>
            <div className="space-body">
              {preview.blocking.map((b) => (
                <div className="warning" key={b} style={{ marginBottom: 10 }}>
                  {b}
                </div>
              ))}

              <div className="policy-facts" style={{ marginBottom: 14 }}>
                <div>
                  <small>NEW CLIENTS</small>
                  <strong>{summary?.clientsToCreate ?? 0}</strong>
                </div>
                <div>
                  <small>CONTACTS</small>
                  <strong>{summary?.contactsToCreate ?? 0}</strong>
                </div>
                <div>
                  <small>POLICIES</small>
                  <strong>{summary?.policiesToCreate ?? 0}</strong>
                </div>
                <div>
                  <small>NEED A DECISION</small>
                  <strong>{summary?.needsReview ?? 0}</strong>
                </div>
                <div>
                  <small>CANNOT BE READ</small>
                  <strong>{summary?.invalid ?? 0}</strong>
                </div>
              </div>

              {/* What each heading was taken to mean. A guess, shown as one. */}
              <div className="section-label">HOW YOUR COLUMNS WERE READ</div>
              {preview.mappedByModel.length > 0 && (
                <p className="quiet-line" style={{ marginBottom: 8 }}>
                  ASAP worked out {preview.mappedByModel.join(", ")} from the heading alone. Check
                  {preview.mappedByModel.length === 1 ? " it" : " them"} before importing — it read
                  the headings, never the values.
                </p>
              )}
              <ul className="evidence-list" style={{ marginBottom: 14 }}>
                {preview.columns.map((c) => (
                  <li key={c.header}>
                    <strong>{c.header}</strong>
                    <small>
                      {c.meaning
                        ? c.meaning.replace(/_/g, " ")
                        : "not used — ASAP does not have a place for this column"}
                    </small>
                  </li>
                ))}
              </ul>

              <div className="section-label">EVERY ROW</div>
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                <table className="import-table">
                  <thead>
                    <tr>
                      <th scope="col">Line</th>
                      <th scope="col">What would happen</th>
                      <th scope="col">Client</th>
                      <th scope="col">Cover</th>
                      <th scope="col">Leave out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <Row
                        key={`${r.lineNumber}-${r.id}`}
                        row={r}
                        skipped={skipped.has(r.lineNumber)}
                        onToggle={() =>
                          setSkipped((prev) => {
                            const next = new Set(prev);
                            if (next.has(r.lineNumber)) next.delete(r.lineNumber);
                            else next.add(r.lineNumber);
                            return next;
                          })
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
                <button
                  type="button"
                  className="new-btn"
                  disabled={!ready || commit.isPending}
                  onClick={() => commit.mutate()}
                >
                  {commit.isPending ? "Writing…" : `Import ${writable} rows`}
                </button>
                <button type="button" className="secondary" onClick={() => setPreview(null)}>
                  Start again
                </button>
              </div>
              {commit.isError && (
                <div className="warning" style={{ marginTop: 10 }}>
                  <strong>The import did not finish:</strong> {describeApiError(commit.error)}
                </div>
              )}
              {commit.data && commit.data.failures.length > 0 && (
                <div className="warning" style={{ marginTop: 10 }}>
                  <strong>{commit.data.failures.length} rows could not be written:</strong>{" "}
                  {commit.data.failures
                    .slice(0, 5)
                    .map((f) => `line ${f.lineNumber}`)
                    .join(", ")}
                </div>
              )}
            </div>
          </article>
        )}

        {(past.data?.batches ?? []).length > 0 && (
          <article className="space-card">
            <div className="space-head">
              <div className="space-type">
                <span>ALREADY IMPORTED</span>
              </div>
              <h2>What has come in before</h2>
            </div>
            <div className="space-body">
              <ul className="evidence-list">
                {past.data!.batches.map((b) => (
                  <li key={b.id}>
                    <strong>{b.filename}</strong>
                    <small>
                      {b.status === "committed"
                        ? `${b.clientsCreated} clients, ${b.policiesCreated} policies, ${b.rowsSkipped} left out · ${new Date(b.createdAt).toLocaleDateString()}`
                        : `${b.status} · ${new Date(b.createdAt).toLocaleDateString()}`}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        )}

        <p style={{ fontSize: 11, color: "#707a72", marginTop: 12 }}>
          Everything here goes in under your own sign-in, through the same checks as adding a client
          by hand. <Link to="/new">Add one at a time instead</Link>.
        </p>
      </section>
    </>
  );
}

/** One line of the file, and what would become of it. */
function Row({
  row,
  skipped,
  onToggle,
}: {
  row: ImportRowPreview;
  skipped: boolean;
  onToggle: () => void;
}) {
  const writable = row.outcome === "create" || row.outcome === "match";
  const tone =
    row.outcome === "invalid" ? "high" : row.outcome === "needs_review" ? "" : "good";
  const word =
    row.outcome === "create"
      ? "New client"
      : row.outcome === "match"
        ? "Adds to a client on file"
        : row.outcome === "needs_review"
          ? "Needs a decision"
          : "Cannot be read";

  return (
    <tr style={skipped ? { opacity: 0.45 } : undefined}>
      <td>{row.lineNumber}</td>
      <td>
        <span className={`pill ${tone}`}>{word}</span>
        {row.problem && (
          <div style={{ fontSize: 11, color: "#707a72", marginTop: 4 }}>{row.problem}</div>
        )}
        {row.candidates.length > 0 && (
          <div style={{ fontSize: 11, color: "#707a72", marginTop: 4 }}>
            Could be: {row.candidates.map((c) => c.name).join(", ")}
          </div>
        )}
      </td>
      <td>
        {row.clientName ?? "—"}
        {row.contactName && (
          <div style={{ fontSize: 11, color: "#707a72" }}>
            {row.contactName}
            {row.contactEmail ? ` · ${row.contactEmail}` : ""}
          </div>
        )}
      </td>
      <td>
        {row.policyNumber ? (
          <>
            {row.policyNumber}
            <div style={{ fontSize: 11, color: "#707a72" }}>
              {row.insurerName ?? "no insurer"}
              {row.periodEnd ? ` · to ${row.periodEnd}` : ""}
            </div>
          </>
        ) : (
          "—"
        )}
      </td>
      <td>
        {writable && (
          <label className="sr-only" htmlFor={`skip-${row.lineNumber}`}>
            Leave line {row.lineNumber} out
          </label>
        )}
        {writable && (
          <input
            id={`skip-${row.lineNumber}`}
            type="checkbox"
            checked={skipped}
            onChange={onToggle}
          />
        )}
      </td>
    </tr>
  );
}
