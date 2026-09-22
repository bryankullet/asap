import {
  READING_STATE_LABELS,
  readingStatus,
  type DocumentDetail,
  type DocumentSummary,
  type FieldState,
  type DocumentsResponse,
  type ImportCommitResponse,
  type ImportPreviewResponse,
  type ImportRowOutcome,
  type SpaceFrame,
  type SpaceFrameAction,
  type SpaceFrameBlock,
  type SpaceRef,
  type SpaceRow,
  type SpaceTone,
} from "@asap/schema";
import { formatSince } from "../components/status/slots.js";

/**
 * Import and Document: one ingestion lifecycle, two Spaces.
 *
 * They are the same pipeline seen from two ends — a file arrives, something reads it, a person
 * decides what it says, and only then does anything become a business fact. Neither Space ever
 * describes a file as read because it was uploaded, and neither treats a proposed value as known
 * because it was proposed.
 *
 * Every state below is derived from what the server returned. `readingStatus` in the contract does
 * the deriving for documents, so the browser cannot invent a state the database does not support.
 */

const PLAIN = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ---- Import ------------------------------------------------------------------------------ */

/** What each row's outcome is called, and how it reads. */
const OUTCOME: Readonly<Record<ImportRowOutcome, { label: string; tone: SpaceTone }>> = {
  create: { label: "Will create", tone: "active" },
  match: { label: "Will add to", tone: "active" },
  needs_review: { label: "Needs a decision", tone: "waiting" },
  invalid: { label: "Cannot be written", tone: "attention" },
  skipped: { label: "Left out", tone: "neutral" },
  committed: { label: "Written", tone: "done" },
  failed: { label: "Did not write", tone: "attention" },
};

export function importSpace(
  preview: ImportPreviewResponse | undefined,
  receipt: ImportCommitResponse | undefined,
  state: {
    busy: boolean;
    error: string | null;
    limits: { maxBytes: number; readableMimeTypes: string[] } | null;
    /** Line numbers a person has chosen to leave out. */
    skipped: number[];
    /** What a premium column means, when a person has said. Null asks the server not to read one. */
    premiumBasis: string | null;
  },
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "route",
    recordType: "import",
    recordId: preview?.batch.id ?? null,
    workflowId: null,
    path: "/import",
    title: "Import",
    label: "IMPORT",
  };
  const base = {
    self,
    title: "Bring records into ASAP",
    context:
      "ASAP reads the file, shows what it found and waits. Nothing is written until you confirm, and uncertain rows are shown rather than hidden.",
    filters: [],
    related: [] as SpaceRef[],
    region: null,
    actions: [] as SpaceFrameAction[],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
    degraded: [],
  };

  const upload: SpaceFrameBlock = {
    id: "upload",
    type: "upload",
    label: null,
    prompt: "Choose a file — CSV or Excel",
    multiple: false,
    accept: ".csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    maxBytes: state.limits?.maxBytes ?? null,
    busy: state.busy,
    progress: [],
    evidence: [],
    actions: [
      {
        verb: "prepare",
        label: "Choose a file",
        to: null,
        stepId: "pick",
        disabledReason: null,
        notPermittedReason: null,
      },
    ],
    state: "ready",
    stateNote: null,
  };

  /*
   * What a premium column means, asked before the file is read rather than guessed from it.
   * "Gross" and "total payable" differ by the levies, and reading one as the other misstates every
   * premium in the book.
   */
  const basis: SpaceFrameBlock = {
    id: "basis",
    type: "form",
    label: null,
    submitLabel: "Use this",
    busy: false,
    fields: [
      {
        name: "premiumBasis",
        label: "IF YOUR FILE HAS A PREMIUM COLUMN, WHAT IS IN IT?",
        kind: "select",
        value: state.premiumBasis ?? "",
        placeholder: "",
        required: false,
        options: [
          { value: "gross", label: "Gross premium, before levies" },
          { value: "total_payable", label: "The total payable, levies included" },
        ],
        hint: "Leave it unanswered and ASAP will not read a premium column at all, rather than guess which it is.",
        error: null,
      },
    ],
    evidence: [],
    actions: [
      {
        verb: "prepare",
        label: "Use this",
        to: null,
        stepId: "basis",
        disabledReason: null,
        notPermittedReason: null,
      },
    ],
    state: "ready",
    stateNote: null,
  };

  if (state.error !== null) {
    return {
      ...base,
      status: { label: "Could not read the file", tone: "attention" },
      blocks: [basis, upload, note("error", "attention", "Nothing was written", state.error)],
      state: "ready",
      emptyState: null,
    };
  }

  /* Nothing chosen yet. An empty import is not a failure and does not read like one. */
  if (!preview && !receipt) {
    return {
      ...base,
      status: { label: state.busy ? "Reading the file" : "Nothing staged", tone: state.busy ? "active" : "neutral" },
      blocks: [
        note(
          "how",
          "active",
          "Nothing is saved until you confirm",
          "ASAP reads the file, shows every row it found and what each one would do, and waits. Rows it cannot write are shown with the reason rather than dropped.",
        ),
        basis,
        upload,
      ],
      state: "ready",
      emptyState: null,
    };
  }

  /* After a commit: what actually happened, row by row where it did not. */
  if (receipt) {
    return {
      ...base,
      self: { ...self, recordId: receipt.batch.id },
      status: {
        label: receipt.failures.length > 0 ? "Partly written" : "Written",
        tone: receipt.failures.length > 0 ? "waiting" : "done",
      },
      blocks: receiptBlocks(receipt),
      state: "ready",
      emptyState: null,
    };
  }

  const p = preview!;
  const blocks: SpaceFrameBlock[] = [
    /* The file itself: what it is, what read it, and what state it is in. */
    facts("file", "THE FILE", [
      ["FILENAME", p.batch.filename],
      ["FORMAT", p.source === "csv" ? "CSV" : p.source === "spreadsheet" ? `Spreadsheet${p.sheetName ? ` · ${p.sheetName}` : ""}` : "PDF"],
      ["ROWS", String(p.batch.rowCount)],
      ["UPLOADED", formatSince(p.batch.createdAt)],
      ["STATE", p.batch.status === "committed" ? "Written" : "Staged for review"],
      ["PREMIUM BASIS", p.batch.premiumBasis === null ? "" : p.batch.premiumBasis === "gross" ? "Gross premium" : "Total payable"],
    ]),
    /* What was found, counted. Every number here is a count of rows, never an estimate. */
    facts("detected", "WHAT ASAP FOUND", [
      ["VALID ROWS", String(p.summary.rows - p.summary.needsReview - p.summary.invalid)],
      ["NEED A DECISION", String(p.summary.needsReview)],
      ["CANNOT BE WRITTEN", String(p.summary.invalid)],
      ["CLIENTS TO CREATE", String(p.summary.clientsToCreate)],
      ["CONTACTS TO CREATE", String(p.summary.contactsToCreate)],
      ["POLICIES TO CREATE", String(p.summary.policiesToCreate)],
    ]),
  ];

  /* How each heading was understood, and which the model guessed at rather than matched. */
  blocks.push({
    id: "columns",
    type: "table",
    label: "HOW EACH COLUMN WAS READ",
    columns: [{ label: "HEADING IN THE FILE" }, { label: "TAKEN TO MEAN" }],
    rows: p.columns.map((c, i) => ({
      id: `col-${i}`,
      cells: [
        { value: c.header, tone: "neutral" as SpaceTone },
        c.meaning === null
          ? { value: "Not used", tone: "neutral" as SpaceTone }
          : {
              value: p.mappedByModel.includes(c.header) ? `${c.meaning} · matched by ASAP` : c.meaning,
              tone: p.mappedByModel.includes(c.header) ? ("waiting" as SpaceTone) : ("neutral" as SpaceTone),
            },
      ],
    })),
    evidence: [],
    actions: [],
    state: p.columns.length === 0 ? "empty" : "ready",
    stateNote: p.columns.length === 0 ? "The file had no headings ASAP could read." : null,
  });

  /* Every row, with what it would do and why it cannot. An invalid row is never dropped. */
  blocks.push({
    id: "rows",
    type: "rows",
    label: "EVERY ROW, AND WHAT IT WOULD DO",
    rows: p.rows.map((row): SpaceRow => {
      const left = state.skipped.includes(row.lineNumber);
      const words = left ? OUTCOME.skipped : OUTCOME[row.outcome];
      const parts = [
        `Line ${row.lineNumber}`,
        row.clientName ?? "No client name",
        row.policyNumber ?? "",
        row.insurerName ?? "",
      ].filter(Boolean);
      /* Who it might be, so a person can correct the file rather than have ASAP guess. */
      if (row.candidates.length > 0) {
        parts.push(`Could be: ${row.candidates.map((c) => c.name).join(", ")}`);
      }
      return {
        id: row.id,
        title: row.clientName ?? `Line ${row.lineNumber}`,
        note: parts.join(" · "),
        badge: words.label,
        badgeTone: words.tone,
        /* The reason, in the server's own words. Never a column name or a constraint. */
        why: row.problem,
        related: null,
        region: null,
        actions: rowActions(row, left),
        evidence: [],
      };
    }),
    evidence: [],
    actions: [],
    state: p.rows.length === 0 ? "empty" : "ready",
    stateNote: p.rows.length === 0 ? "The file had no rows." : null,
  });

  /* What confirming would do, stated exactly, and what stops it. */
  const willWrite = p.rows.filter(
    (r) => (r.outcome === "create" || r.outcome === "match") && !state.skipped.includes(r.lineNumber),
  ).length;
  const blockedRows = p.rows.filter((r) => r.outcome === "invalid" || r.outcome === "needs_review");

  if (blockedRows.length > 0) {
    blocks.push({
      id: "blocked",
      type: "missing",
      label: "WHAT CANNOT BE WRITTEN, AND WHY",
      items: blockedRows.slice(0, 20).map((r) => ({
        text: `Line ${r.lineNumber}${r.clientName ? ` · ${r.clientName}` : ""} — ${r.problem ?? "a person has to choose which client this is."}`,
      })),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  blocks.push({
    id: "confirm",
    type: "approval_gate",
    label: null,
    heading: `Write ${PLAIN(willWrite, "row")} into this brokerage`,
    detail: [
      `${PLAIN(p.summary.clientsToCreate, "client")}, ${PLAIN(p.summary.contactsToCreate, "contact")} and ${PLAIN(p.summary.policiesToCreate, "policy", "policies")} would be created.`,
      state.skipped.length > 0 ? `${PLAIN(state.skipped.length, "row")} you left out will be skipped.` : "",
      blockedRows.length > 0 ? `${PLAIN(blockedRows.length, "row")} cannot be written and will be left as they are.` : "",
      "The original file stays attached as evidence. Confirming twice cannot write twice.",
    ]
      .filter(Boolean)
      .join(" "),
    /* The server's own blocking reasons, if any. It decides; this reports. */
    blockedNote: p.blocking.length > 0 ? p.blocking.join(" ") : null,
    evidence: [],
    actions: [
      {
        verb: "approve",
        label: `Confirm the import of ${PLAIN(willWrite, "row")}`,
        to: null,
        stepId: "commit",
        disabledReason:
          p.blocking.length > 0
            ? p.blocking.join(" ")
            : willWrite === 0
              ? "No row in this file can be written as it stands."
              : null,
        notPermittedReason: null,
      },
    ],
    state: "ready",
    stateNote: null,
  });

  return {
    ...base,
    status: { label: `${PLAIN(p.rows.length, "row")} staged`, tone: "waiting" },
    blocks,
    state: "ready",
    emptyState: null,
  };
}

/**
 * Leaving a row out, or putting it back.
 *
 * There is deliberately no "it is this client" action. The preview is the server's reading of the
 * file, and picking a client on screen would make the row disagree with what a commit actually
 * writes. The candidates are shown on the row so a person can correct the file and read it again.
 */
function rowActions(row: ImportPreviewResponse["rows"][number], left: boolean): SpaceFrameAction[] {
  const actions: SpaceFrameAction[] = [];
  if (row.outcome !== "invalid") {
    actions.push({
      verb: "exception",
      label: left ? "Put it back" : "Leave it out",
      to: null,
      stepId: `${left ? "unskip" : "skip"}:${row.lineNumber}`,
      disabledReason: null,
      notPermittedReason: null,
    });
  }
  return actions;
}

/** What actually happened. A partial import stays partial. */
function receiptBlocks(receipt: ImportCommitResponse): SpaceFrameBlock[] {
  const b = receipt.batch;
  const blocks: SpaceFrameBlock[] = [
    facts("receipt", "WHAT WAS WRITTEN", [
      ["CLIENTS CREATED", String(b.clientsCreated)],
      ["CONTACTS CREATED", String(b.contactsCreated)],
      ["POLICIES CREATED", String(b.policiesCreated)],
      ["PERIODS CREATED", String(b.periodsCreated)],
      ["ROWS SKIPPED", String(b.rowsSkipped)],
      ["ROWS THAT FAILED", String(receipt.failures.length)],
    ]),
  ];

  if (receipt.failures.length > 0) {
    blocks.push({
      id: "failures",
      type: "missing",
      label: "WHAT DID NOT WRITE",
      items: receipt.failures.map((f) => ({ text: `Line ${f.lineNumber} — ${f.problem}` })),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
    blocks.push(
      note(
        "partial",
        "waiting",
        "This import is partly written",
        "The rows above did not write, and the rest did. Nothing is rolled back: what landed is real, and re-importing the same file will not write those rows a second time.",
      ),
    );
  } else {
    blocks.push(
      note(
        "done",
        "active",
        "Every row landed",
        "The original file stays attached as evidence, and the audit history records what this import created.",
      ),
    );
  }

  blocks.push({
    id: "next",
    type: "rows",
    label: "WHERE THESE RECORDS ARE NOW",
    rows: [
      {
        id: "clients",
        title: "The client files",
        note: "Every client this import created or added to.",
        badge: null,
        badgeTone: "neutral",
        why: null,
        related: null,
        region: null,
        actions: [route("Open client files", "/files")],
        evidence: [],
      },
      {
        id: "activity",
        title: "What ASAP did",
        note: "The run behind this import, step by step.",
        badge: null,
        badgeTone: "neutral",
        why: null,
        related: null,
        region: null,
        actions: [route("Open Activity", "/jobs")],
        evidence: [],
      },
      {
        id: "audit",
        title: "The audit history",
        note: "Who imported this, when, and what it changed.",
        badge: null,
        badgeTone: "neutral",
        why: null,
        related: null,
        region: null,
        actions: [route("Open the audit history", "/audit")],
        evidence: [],
      },
    ],
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  });

  return blocks;
}

/* ---- Documents --------------------------------------------------------------------------- */

/** The tone each reading state carries. A gap is not an error, and neither is a conflict. */
const READING_TONE: Readonly<Record<string, SpaceTone>> = {
  uploaded: "neutral",
  queued: "neutral",
  reading: "active",
  ready_for_review: "waiting",
  missing_information: "waiting",
  conflict_found: "attention",
  failed: "attention",
  not_applicable: "neutral",
  reviewed: "done",
};

export function documentListSpace(
  response: DocumentsResponse | undefined,
  state: {
    loading: boolean;
    error: string | null;
    busy: boolean;
    progress: { name: string; sent: number; total: number } | null;
    /** What the last upload said, once the bytes actually arrived. Never before. */
    uploaded: string | null;
    /** True when a transfer failed and the same file can be sent again. */
    canRetry: boolean;
  },
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "document",
    recordType: "organization",
    recordId: null,
    workflowId: null,
    path: "/documents",
    title: "Documents",
    label: "DOCUMENTS",
  };
  const base = {
    self,
    title: "Documents",
    context:
      "Files this brokerage has filed. ASAP reads what it can and proposes what it found; nothing a document says is treated as known until a person accepts it.",
    filters: [],
    related: [] as SpaceRef[],
    region: null,
    actions: [] as SpaceFrameAction[],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
    degraded: [],
  };

  const upload: SpaceFrameBlock = {
    id: "upload",
    type: "upload",
    label: null,
    prompt: "Choose a file",
    multiple: false,
    accept: (response?.limits.readableMimeTypes ?? []).join(","),
    maxBytes: response?.limits.maxBytes ?? null,
    busy: state.busy,
    /* A file's own bytes, and only while the transport is actually reporting them. */
    progress:
      state.progress === null
        ? []
        : [
            {
              name: state.progress.name,
              state:
                state.progress.total === 0
                  ? "Uploading — the transport is not reporting a size"
                  : `Uploading — ${Math.floor((state.progress.sent / state.progress.total) * 100)}% of ${Math.max(1, Math.round(state.progress.total / 1024))}KB sent`,
              percent:
                state.progress.total === 0
                  ? 0
                  : (state.progress.sent / state.progress.total) * 100,
              tone: "active",
            },
          ],
    evidence: [],
    actions: state.busy
      ? [
          {
            verb: "exception",
            label: "Cancel",
            to: null,
            stepId: "cancel",
            disabledReason: null,
            notPermittedReason: null,
          },
        ]
      : [
          {
            verb: "prepare",
            label: "Choose a file",
            to: null,
            stepId: "pick",
            disabledReason: null,
            notPermittedReason: null,
          },
          /*
           * The same bytes again. The API answers with the document already on file rather than a
           * second one, which is what stops a flaky connection turning one schedule into three.
           */
          ...(state.canRetry
            ? [
                {
                  verb: "prepare" as const,
                  label: "Try again",
                  to: null,
                  stepId: "retry",
                  disabledReason: null,
                  notPermittedReason: null,
                },
              ]
            : []),
        ],
    state: "ready",
    stateNote: null,
  };

  if (state.error !== null) {
    return {
      ...base,
      status: { label: "Could not read", tone: "attention" },
      blocks: [upload, note("error", "attention", "Nothing was filed", state.error)],
      state: "ready",
      emptyState: null,
    };
  }

  /* What the upload actually did, said only once the bytes arrived. */
  const arrived: SpaceFrameBlock[] =
    state.uploaded === null ? [] : [note("uploaded", "active", "On file", state.uploaded)];
  /*
   * The list loading never hides the picker. Filing a document does not depend on knowing what is
   * already filed, and a screen that made a person wait for a list before they could upload would
   * be slower for no reason.
   */
  if (state.loading || !response) {
    return {
      ...base,
      status: { label: "Reading", tone: "active" },
      blocks: [
        upload,
        ...arrived,
        {
          id: "documents",
          type: "rows",
          label: "ON FILE",
          rows: [],
          evidence: [],
          actions: [],
          state: "loading",
          stateNote: "Reading what is already on file.",
        },
      ],
      state: "ready",
      emptyState: null,
    };
  }

  const docs = response.documents;
  return {
    ...base,
    status: { label: PLAIN(docs.length, "document"), tone: docs.length === 0 ? "neutral" : "active" },
    blocks: [
      upload,
      ...arrived,
      {
        id: "documents",
        type: "rows",
        label: "ON FILE",
        rows: docs.map(documentRow),
        evidence: [],
        actions: [],
        state: docs.length === 0 ? "empty" : "ready",
        stateNote:
          docs.length === 0
            ? "Nothing has been filed yet. A schedule, a debit note or a claim form is a good first one."
            : null,
      },
    ],
    state: "ready",
    emptyState: null,
  };
}

/** One document in the list. Its state is the derived one, never "uploaded, therefore read". */
function documentRow(doc: DocumentSummary): SpaceRow {
  /*
   * The list has no fields, so this is the state extraction itself reached. A document with
   * proposals is "ready for review" only once its own Space has counted them — which is why the
   * list says what the extractor did, and the Space says what is left for a person.
   */
  const status = readingStatus({ extractionState: doc.extractionState, fields: [] });
  const parts = [doc.kind.replace(/_/g, " "), formatSince(doc.createdAt)];
  if (doc.pageCount !== null) parts.push(PLAIN(doc.pageCount, "page"));
  if (doc.extractionError !== null) parts.push(doc.extractionError);

  const ref: SpaceRef = {
    spaceKind: "document",
    recordType: "document",
    recordId: doc.id,
    workflowId: null,
    path: `/documents/${doc.id}`,
    title: doc.filename,
    label: "DOCUMENT",
  };
  return {
    id: doc.id,
    title: doc.filename,
    note: parts.join(" · "),
    badge: status.label,
    badgeTone: READING_TONE[status.state] ?? "neutral",
    why: null,
    related: ref,
    region: null,
    actions: [
      {
        verb: "open",
        label: "Open →",
        to: ref,
        stepId: null,
        disabledReason: null,
        notPermittedReason: null,
      },
    ],
    evidence: [],
  };
}

/* ---- Shared little builders ---------------------------------------------------------------- */

function facts(id: string, label: string, pairs: [string, string][]): SpaceFrameBlock {
  return {
    id,
    type: "facts",
    label,
    facts: pairs.map(([key, value]) => ({
      key,
      value,
      /* Abstention is a state: an unknown value says so rather than rendering as empty. */
      missing: value === "",
      evidence: [],
    })),
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
  };
}

function note(id: string, tone: SpaceTone, title: string, text: string): SpaceFrameBlock {
  return { id, type: "note", label: null, tone, title, text, evidence: [], actions: [], state: "ready", stateNote: null };
}

function route(label: string, path: string): SpaceFrameAction {
  return {
    verb: "open",
    label,
    to: {
      spaceKind: "route",
      recordType: "route",
      recordId: null,
      workflowId: null,
      path,
      title: label,
      label: "ASAP",
    },
    stepId: null,
    disabledReason: null,
    notPermittedReason: null,
  };
}

export { READING_STATE_LABELS, readingStatus, type DocumentDetail };

/* ---- One document -------------------------------------------------------------------------- */

/** What each field decision is called once a person has made it. */
const FIELD_STATE: Readonly<Record<FieldState, { label: string; tone: SpaceTone }>> = {
  proposed: { label: "Proposed", tone: "waiting" },
  accepted: { label: "Accepted", tone: "done" },
  corrected: { label: "Corrected", tone: "done" },
  rejected: { label: "Rejected", tone: "neutral" },
};

/**
 * One document, as its own Space.
 *
 * Keyed by the document's id, so opening the same document twice focuses the tab that is already
 * there. The order is the lifecycle's own: what the file is, what reading it did, what a person
 * has decided, and only then where those decisions can be applied.
 */
export function documentSpace(
  detail: DocumentDetail | undefined,
  state: {
    loading: boolean;
    error: string | null;
    missing: boolean;
    busy: boolean;
  },
  documentId: string,
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "document",
    recordType: "document",
    recordId: detail?.document.id ?? documentId,
    workflowId: null,
    path: `/documents/${documentId}`,
    title: detail?.document.filename ?? "Document",
    label: "DOCUMENT",
  };
  const base = {
    self,
    title: detail?.document.filename ?? "Document",
    context: null,
    filters: [],
    related: [] as SpaceRef[],
    region: null,
    actions: [] as SpaceFrameAction[],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
    degraded: [],
  };

  if (state.missing || state.error !== null) {
    return {
      ...base,
      status: { label: state.missing ? "Not found" : "Could not read", tone: "attention" },
      blocks: [],
      state: "error",
      emptyState: {
        heading: state.missing ? "No document with that id." : "This document could not be read.",
        body: state.missing
          ? "It may have been deleted, or your role in this brokerage cannot see it."
          : (state.error ?? ""),
        actions: [],
      },
    };
  }
  if (state.loading || !detail) {
    return { ...base, status: { label: "Reading", tone: "active" }, blocks: [], state: "loading", emptyState: null };
  }

  const doc = detail.document;
  const status = readingStatus({ extractionState: doc.extractionState, fields: detail.fields });
  const blocks: SpaceFrameBlock[] = [
    facts("file", "THE FILE", [
      ["FILENAME", doc.filename],
      ["TYPE", doc.kind.replace(/_/g, " ")],
      ["PAGES", doc.pageCount === null ? "" : String(doc.pageCount)],
      ["FILED", formatSince(doc.createdAt)],
      ["STATE", status.label],
      ["AWAITING A DECISION", String(status.awaiting)],
    ]),
  ];

  /*
   * What reading did, in its own words. This block is the one that must never overstate: an
   * uploaded file says Uploaded, a queued one says Queued, and neither says anything was read.
   */
  blocks.push(
    note(
      "reading",
      READING_TONE[status.state] ?? "neutral",
      readingHeadline(status.state),
      readingBody(status.state, doc.extractionError, status.awaiting),
    ),
  );

  if (status.retryable) {
    blocks.push({
      id: "retry",
      type: "approval_gate",
      label: null,
      heading: "Read it again",
      detail:
        "Reading failed, so nothing was proposed. Trying again re-reads the same file; it cannot overwrite a decision, because there are none to overwrite.",
      blockedNote: null,
      evidence: [],
      actions: [
        {
          verb: "prepare",
          label: "Read it again",
          to: null,
          stepId: "retry",
          disabledReason: state.busy ? "A read is already being asked for." : null,
          notPermittedReason: null,
        },
      ],
      state: "ready",
      stateNote: null,
    });
  }

  /* Every extracted value, with where it came from and what a person has decided about it. */
  if (detail.fields.length > 0) {
    blocks.push({
      id: "fields",
      type: "rows",
      label: "WHAT ASAP READ, AND WHAT YOU DECIDED",
      rows: detail.fields.map((field): SpaceRow => {
        const words = FIELD_STATE[field.state];
        const value = field.correctedValue ?? field.proposedValue;
        const where =
          field.page === null
            ? "ASAP could not place this on a page"
            : field.region === null
              ? `Page ${field.page} · no exact placement`
              : `Page ${field.page}`;
        /* A correction never erases what was proposed: both are on the row. */
        const proposedToo =
          field.correctedValue !== null && field.proposedValue !== null
            ? ` · ASAP read “${field.proposedValue}”`
            : "";
        return {
          id: field.id,
          title: `${field.fieldKey.replace(/_/g, " ")} — ${value ?? "nothing readable"}`,
          note: `${where}${proposedToo}`,
          badge: words.label,
          badgeTone: words.tone,
          why: null,
          related: null,
          /*
           * Where it was read from, carried only when the extractor placed it. A region invented
           * for an unplaced value would be a confident lie about where to look.
           */
          region:
            field.region !== null && field.page !== null
              ? {
                  what: field.fieldKey.replace(/_/g, " "),
                  pageNumber: field.page,
                  pageWidth: detail.pages.find((p) => p.pageNumber === field.page)?.width ?? null,
                  pageHeight: detail.pages.find((p) => p.pageNumber === field.page)?.height ?? null,
                  rect: field.region,
                  fileUrl: detail.fileUrl,
                }
              : null,
          actions: [
            ...(field.state === "proposed"
              ? [
                  {
                    verb: "record_evidence" as const,
                    label: "Accept",
                    to: null,
                    stepId: `accept:${field.id}`,
                    disabledReason: state.busy ? "A decision is already being recorded." : null,
                    notPermittedReason: null,
                  },
                  {
                    verb: "resolve" as const,
                    label: "Correct",
                    to: null,
                    stepId: `correct:${field.id}`,
                    disabledReason: state.busy ? "A decision is already being recorded." : null,
                    notPermittedReason: null,
                  },
                  {
                    verb: "exception" as const,
                    label: "Reject",
                    to: null,
                    stepId: `reject:${field.id}`,
                    disabledReason: state.busy ? "A decision is already being recorded." : null,
                    notPermittedReason: null,
                  },
                ]
              : []),
          ],
          evidence:
            field.page === null
              ? []
              : [
                  {
                    label: `${field.fieldKey.replace(/_/g, " ")}, as read`,
                    reference: `${doc.filename}, page ${field.page}`,
                    recordedBy: null,
                    recordedAt: field.reviewedAt,
                  },
                ],
        };
      }),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  /* The document itself, with the read lines highlighted where they were placed. */
  if (detail.pages.length > 0) {
    const first = detail.pages[0]!;
    blocks.push({
      id: "source",
      type: "document",
      label: "THE SOURCE",
      name: doc.filename,
      documentKind: doc.kind.replace(/_/g, " "),
      title: `PAGE ${first.pageNumber} OF ${doc.pageCount ?? detail.pages.length}`,
      lines: first.text
        .split("\n")
        .filter((l) => l.trim() !== "")
        .slice(0, 40)
        .map((line) => ({
          parts: [
            {
              text: line,
              /* Highlighted only where a field was actually placed on this page. */
              highlighted: detail.fields.some(
                (f) =>
                  f.page === first.pageNumber &&
                  f.proposedValue !== null &&
                  line.includes(f.proposedValue),
              ),
            },
          ],
        })),
      note:
        detail.fileUrl === null
          ? "The file itself could not be linked just now. The text above is what was read from it."
          : "Highlighted lines are the ones a proposed value was read from.",
      evidence: [],
      actions:
        detail.fileUrl === null
          ? []
          : [
              {
                verb: "open",
                label: "Open the original",
                to: {
                  spaceKind: "document",
                  recordType: "file",
                  recordId: doc.id,
                  workflowId: null,
                  path: detail.fileUrl,
                  title: doc.filename,
                  label: "FILE",
                },
                stepId: null,
                disabledReason: null,
                notPermittedReason: null,
              },
            ],
      state: "ready",
      stateNote: null,
    });
  }


  return {
    ...base,
    status: { label: status.label, tone: READING_TONE[status.state] ?? "neutral" },
    blocks,
    state: "ready",
    emptyState: null,
  };
}

function readingHeadline(state: string): string {
  switch (state) {
    case "uploaded":
      return "On file. Nothing has read it yet";
    case "queued":
      return "Waiting to be read";
    case "reading":
      return "ASAP is reading it now";
    case "ready_for_review":
      return "Read. Every value is waiting for you";
    case "missing_information":
      return "Read, but something expected was not there";
    case "conflict_found":
      return "Read, and two readings disagree";
    case "failed":
      return "Reading failed";
    case "not_applicable":
      return "Not a document ASAP reads";
    default:
      return "Every value has been decided";
  }
}

function readingBody(state: string, error: string | null, awaiting: number): string {
  switch (state) {
    case "uploaded":
      return "The file is stored against this brokerage. It has not been read, and nothing in it is known.";
    case "queued":
      return "It is in the queue. Nothing has been read from it yet, so nothing it contains is a fact.";
    case "reading":
      return "Our own extractor has the file. Values will appear here as proposals, not as facts.";
    case "ready_for_review":
      return `${PLAIN(awaiting, "value")} were read and none is treated as known until you accept it. A proposal is what ASAP saw, not what is true.`;
    case "missing_information":
      return "The document did not give something that was expected. What is missing is shown as missing rather than filled in with a guess.";
    case "conflict_found":
      return "Two readings of this document disagree. Both are kept and neither is chosen for you.";
    case "failed":
      return error ?? "The file could not be read. Nothing was proposed from it.";
    case "not_applicable":
      return "This file is stored, and nothing will read it. That is not a failure — not every document is one ASAP extracts from.";
    default:
      return "Every value has been accepted, corrected or rejected by a person. What happens to them next is the apply step below.";
  }
}
