import type {
  QuotationReadingResponse,
  SpaceFrame,
  SpaceFrameAction,
  SpaceFrameBlock,
  SpaceRef,
  SpaceTone,
  TermProposal,
} from "@asap/schema";

/**
 * What ASAP read from a quotation, and the decision a person makes about each reading.
 *
 * The boundary this screen exists to hold: **a proposal is not a term.** Nothing read from a
 * document reaches the comparison until somebody accepts it or corrects it, and the screen never
 * presents a reading as though it were the insurer's terms. Each row says what was read, where on
 * the page it was read from, and what is still undecided about it.
 *
 * It also refuses to guess which insurer's answer the quotation is. A name on a document that
 * resembles an insurer in the book is not evidence that they sent it, and the cost of assuming so
 * is one insurer's excesses recorded against another's.
 */

const TERM_WORDS: Record<TermProposal["termType"], string> = {
  excess: "Excess",
  limit: "Limit",
  condition: "Condition",
  exclusion: "Exclusion",
  benefit: "Benefit",
  levy: "Levy",
  tax: "Tax",
  subjectivity: "Subject to",
  other: "Other",
};

/** Each review state in words, so the state is never carried by colour alone. */
const STATE_WORDS: Record<TermProposal["state"], { label: string; tone: SpaceTone }> = {
  proposed: { label: "Not reviewed", tone: "waiting" },
  accepted: { label: "Accepted", tone: "done" },
  corrected: { label: "Corrected", tone: "active" },
  rejected: { label: "Rejected", tone: "neutral" },
};

function day(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function quotationReadingSpace(
  data: QuotationReadingResponse | undefined,
  state: { loading: boolean; error: string | null; missing: boolean; busy: boolean },
  documentId: string,
): SpaceFrame {
  const title = data?.document.filename ?? "A quotation";
  const self: SpaceRef = {
    spaceKind: "document",
    recordType: "document",
    recordId: documentId,
    workflowId: null,
    path: `/documents/${documentId}/quotation`,
    title,
    label: "QUOTATION",
  };
  const base = {
    self,
    title,
    context: "What ASAP read from this quotation, and what has been confirmed. Nothing here is a term until somebody says it is.",
    filters: [],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
    degraded: [],
  };

  if (state.error !== null) {
    return {
      ...base, related: [], actions: [], blocks: [],
      status: { label: "Could not read", tone: "attention" },
      state: "error",
      emptyState: { heading: "This reading could not be loaded", body: state.error, actions: [] },
    };
  }
  if (state.missing) {
    return {
      ...base, related: [], actions: [], blocks: [],
      status: { label: "Not found", tone: "neutral" },
      state: "empty",
      emptyState: { heading: "No document with that address", body: "", actions: [] },
    };
  }
  if (state.loading || data === undefined) {
    return {
      ...base, related: [], actions: [], blocks: [],
      status: { label: "Reading", tone: "active" },
      state: "loading",
      emptyState: null,
    };
  }

  const blocks: SpaceFrameBlock[] = [];
  const undecided = data.proposals.filter((p) => p.state === "proposed");

  /* A file nobody can read is not a quotation that says nothing. */
  if (data.needsManualReview !== null) {
    blocks.push({
      id: "unreadable",
      type: "note",
      label: null,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      tone: "attention",
      title: "ASAP could not read this document",
      text: data.needsManualReview,
    });
  }

  blocks.push({
    id: "where",
    type: "facts",
    label: "THIS QUOTATION",
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
    facts: [
      { key: "File", value: data.document.filename, missing: false, evidence: [] },
      {
        key: "Pages",
        value: data.document.pageCount === null ? "" : String(data.document.pageCount),
        missing: data.document.pageCount === null,
        evidence: [],
      },
      {
        key: "Whose answer this is",
        value: data.linkedTo?.insurerName ?? "",
        /* Never guessed from a name on the page. Until a person says, it is unknown. */
        missing: data.linkedTo === null,
        evidence: [],
      },
      {
        key: "Readings not yet reviewed",
        value: String(undecided.length),
        missing: false,
        evidence: [],
      },
    ],
  });

  if (data.linkedTo === null) {
    blocks.push({
      id: "unlinked",
      type: "note",
      label: null,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      tone: "waiting",
      title: "Nobody has said which insurer's answer this is",
      text: "ASAP will not guess it from a name on the page — a quotation attached to the wrong insurer puts one insurer's excesses against another's. Choose the answer on the quotation work, and the readings below can then be confirmed against it.",
    });
  }

  /* The header values, from the existing document-field review path. */
  const stated = data.fields.filter((f) => f.proposedValue !== null || f.correctedValue !== null);
  if (stated.length > 0) {
    blocks.push({
      id: "header",
      type: "rows",
      label: "WHAT THE QUOTATION SAYS ABOUT ITSELF",
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      rows: stated.slice(0, 20).map((f) => ({
        id: f.fieldKey,
        title: f.fieldKey.replace(/_/g, " ").replace(/^./, (ch) => ch.toUpperCase()),
        note: f.correctedValue ?? f.proposedValue ?? "",
        badge: f.page === null ? null : `Page ${f.page}`,
        badgeTone: "neutral" as SpaceTone,
        why: null,
        related: null,
        region: null,
        actions: [],
        evidence: [],
      })),
    });
  }

  if (data.proposals.length === 0) {
    blocks.push({
      id: "no-terms",
      type: "note",
      label: null,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      tone: "neutral",
      title: "No terms were found in this document",
      text: "ASAP read the file and found nothing it recognised as an excess, a limit, a condition or an exclusion. That may be the document, and it may be ASAP. Record the terms by hand on the insurer's answer.",
    });
  } else {
    blocks.push({
      id: "proposals",
      type: "rows",
      label: "WHAT ASAP READ — NONE OF IT IS A TERM UNTIL YOU SAY SO",
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      rows: data.proposals.slice(0, 40).map((p) => {
        const words = STATE_WORDS[p.state];
        const value = p.correctedValue ?? p.proposedValue;
        return {
          id: p.id,
          title: `${TERM_WORDS[p.termType]} — ${p.label}`,
          note: [
            p.condition === "unclear"
              ? `${value ?? "Stated"} — cannot be compared`
              : (value ?? "No value read"),
            /* Where it was read from, on the row itself: a citation nobody can see is not one. */
            p.page === null ? null : `Read from page ${p.page} of ${data.document.filename}`,
            p.state === "proposed"
              ? null
              : `${words.label}${p.reviewedByName === null ? "" : ` by ${p.reviewedByName}`}${p.reviewedAt === null ? "" : ` on ${day(p.reviewedAt)}`}`,
          ]
            .filter((v): v is string => v !== null)
            .join(" · "),
          badge: words.label,
          badgeTone: words.tone,
          why:
            p.page === null
              ? null
              : `Read by ${p.method.replace(/_/g, " ")} from page ${p.page}, at the rectangle highlighted in the document.`,
          related: null,
          /*
           * The rectangle the figure was read from, revealed by the row itself. This is the
           * designed citation mechanism: a highlight a person can open, rather than a link with
           * a raw path in it.
           */
          region:
            p.page === null || p.region === null
              ? null
              : {
                  what: `${TERM_WORDS[p.termType]} — ${p.label}`,
                  pageNumber: p.page,
                  pageWidth: null,
                  pageHeight: null,
                  rect: p.region,
                  fileUrl: null,
                },
          actions: reviewActions(p, data),
          evidence: [],
        };
      }),
    });
  }

  const status: { label: string; tone: SpaceTone } =
    data.needsManualReview !== null
      ? { label: "Needs a person", tone: "attention" }
      : undecided.length > 0
        ? { label: `${undecided.length} to review`, tone: "waiting" }
        : { label: "Reviewed", tone: "done" };

  return {
    ...base,
    related: data.linkedTo === null
      ? []
      : [
          {
            spaceKind: "placement",
            recordType: "opportunity",
            recordId: data.linkedTo.opportunityId,
            workflowId: null,
            path: `/opportunities/${data.linkedTo.opportunityId}`,
            title: "The quotation work",
            label: "QUOTATION",
          },
        ],
    actions: [],
    status,
    state: "ready",
    emptyState: null,
    blocks,
  };
}

/**
 * What a person may do with one reading.
 *
 * Every control is shown even where it is refused, with the reason beside it (§34): a broker who
 * cannot see why they may not accept a reading will assume ASAP is broken.
 */
function reviewActions(p: TermProposal, data: QuotationReadingResponse): SpaceFrameAction[] {
  if (p.state !== "proposed") return [];

  const reason = !data.permissions.canReview
    ? "You may not review what was read from documents."
    : data.linkedTo === null
      ? "Choose which insurer's answer this quotation is, first."
      : null;

  return [
    {
      verb: "record_evidence",
      label: "This is right",
      stepId: `accept:${p.id}`,
      to: null,
      disabledReason: reason,
      notPermittedReason: null,
    },
    {
      verb: "exception",
      label: "Not a term",
      stepId: `reject:${p.id}`,
      to: null,
      disabledReason: data.permissions.canReview ? null : reason,
      notPermittedReason: null,
    },
  ];
}
