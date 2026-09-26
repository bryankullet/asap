import type {
  Comparison,
  ComparisonResponse,
  ComparisonRow,
  EvidenceRef,
  SpaceFrame,
  SpaceFrameAction,
  SpaceFrameBlock,
  SpaceRef,
  SpaceTone,
} from "@asap/schema";

/**
 * The quotes, beside each other (4B-3).
 *
 * The title is the work's own name — "Acme motor fleet quotation — 2027". Nothing here is called
 * a Quote Comparison Space.
 *
 * Three things this screen must never do, each of which it would do by default:
 *
 *   - **Show a blank cell.** An insurer silent on theft excess has not offered a nil excess. Every
 *     absence is written out, and the state is in the words, never in the colour alone.
 *   - **Show a comparison that no longer describes any quote.** The database supersedes one the
 *     moment an included premium or term changes (0050); this reads that and says what moved.
 *   - **Call the cheapest quote the best one.** The recommendation comes from the server, with its
 *     reasoning and its caveats, and it abstains far more often than it picks.
 */

/** Each validity state named, so the state is in the text and not only in the colour. */
const VALIDITY_WORDS: Record<Comparison["columns"][number]["validity"]["state"], string> = {
  valid: "Holds",
  expiring_soon: "Expiring soon",
  expired: "Expired",
  not_stated: "Not stated",
};

const TERM_WORDS: Record<ComparisonRow["termType"], string> = {
  excess: "Excess",
  limit: "Limit",
  condition: "Condition",
  exclusion: "Exclusion",
  levy: "Levy",
  tax: "Tax",
  benefit: "Benefit",
  subjectivity: "Subject to",
  other: "Other",
};

function day(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function money(amount: string | null, currency: string | null): string {
  if (amount === null || currency === null) return "";
  const n = Number(amount);
  return Number.isNaN(n) ? `${currency} ${amount}` : `${currency} ${n.toLocaleString()}`;
}

function evidenceOf(ref: EvidenceRef | null) {
  if (ref === null) return [];
  return [{ label: ref.label, reference: ref.path ?? ref.label, recordedBy: null, recordedAt: null }];
}

/**
 * One cell, in words.
 *
 * The three absences are three different sentences on purpose. A reader who cannot see colour, or
 * who is reading this printed, must still be able to tell "they did not say" from "they said
 * something unusable" from "someone corrected this".
 */
function cellWords(cell: ComparisonRow["cells"][number]): { value: string; tone: SpaceTone } {
  if (cell.missing) return { value: "Not stated", tone: "attention" };
  if (cell.unclear) return { value: `${cell.value ?? "Stated"} — cannot be compared`, tone: "attention" };
  const amount = cell.amount === null ? "" : ` (${money(cell.amount, cell.currency)})`;
  const value = `${cell.value ?? ""}${amount}`.trim();
  return cell.corrected
    ? { value: `${value} — corrected`, tone: "active" }
    : { value: value === "" ? "Stated" : value, tone: "neutral" };
}

export function comparisonSpace(
  data: ComparisonResponse | undefined,
  state: { loading: boolean; error: string | null; missing: boolean; busy: boolean },
  opportunityId: string,
  /** True while a person is recording the client's instruction. Interface state only. */
  recordingInstruction = false,
): SpaceFrame {
  const title = data?.opportunity.title ?? "Quotation comparison";
  const self: SpaceRef = {
    spaceKind: "placement",
    recordType: "opportunity",
    recordId: opportunityId,
    workflowId: null,
    path: `/opportunities/${opportunityId}/comparison`,
    title,
    label: "COMPARISON",
  };
  const base = {
    self,
    title,
    context:
      "What each insurer actually quoted, side by side — including the terms one stated and another did not.",
    filters: [],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
    degraded: [],
  };

  const backToWork: SpaceFrameAction = {
    verb: "open",
    label: "Back to the quotation work",
    stepId: null,
    disabledReason: null,
    notPermittedReason: null,
    to: {
      spaceKind: "placement",
      recordType: "opportunity",
      recordId: opportunityId,
      workflowId: null,
      path: `/opportunities/${opportunityId}`,
      title: "Quotation work",
      label: "QUOTATION",
    },
  };

  if (state.error !== null) {
    return {
      ...base,
      related: [],
      actions: [],
      status: { label: "Could not read", tone: "attention" },
      state: "error",
      emptyState: { heading: "This comparison could not be read", body: state.error, actions: [] },
      blocks: [],
    };
  }
  if (state.missing) {
    return {
      ...base,
      related: [],
      actions: [],
      status: { label: "Not found", tone: "neutral" },
      state: "empty",
      emptyState: { heading: "No quotation work with that address", body: "", actions: [] },
      blocks: [],
    };
  }
  if (state.loading || data === undefined) {
    return {
      ...base,
      related: [],
      actions: [],
      status: { label: "Reading", tone: "active" },
      state: "loading",
      emptyState: null,
      blocks: [],
    };
  }

  const blocks: SpaceFrameBlock[] = [];
  const c = data.comparison;

  /* ---- Where this stands ------------------------------------------------------------------- */

  blocks.push({
    id: "standing",
    type: "facts",
    label: "THE MARKET SO FAR",
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
    facts: [
      { key: "Client", value: `${data.client.name} · ${data.opportunity.classOfBusiness}`, missing: false, evidence: [] },
      { key: "Insurers approached", value: String(data.readiness.approached), missing: false, evidence: [] },
      { key: "Quoted", value: String(data.readiness.quoted), missing: false, evidence: [] },
      { key: "Declined", value: String(data.readiness.declined), missing: false, evidence: [] },
      {
        key: "No answer yet",
        value:
          data.readiness.awaiting.length === 0
            ? "None"
            : data.readiness.awaiting.map((a) => `${a.insurerName} since ${day(a.since)}`).join("; "),
        missing: false,
        evidence: [],
      },
    ],
  });

  /* Blockers are sentences a broker can act on, not a "not ready" badge. */
  if (data.readiness.blockers.length > 0) {
    blocks.push({
      id: "outstanding",
      type: "missing",
      label: "STILL OUTSTANDING — A COMPARISON MADE NOW WOULD NOT BE THE FINAL ONE",
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      items: data.readiness.blockers.slice(0, 12).map((text) => ({ text })),
    });
  }

  /* ---- The comparison, or the absence of one ------------------------------------------------ */

  if (c === null) {
    /*
     * "None yet" and "the last one went out of date" are different situations and a broker acts
     * differently on each. Collapsing them into one sentence would read as though nothing had
     * ever been compared, when in fact something was — and then the quotes moved.
     */
    const lapsed = data.history.find((h) => h.supersededAt !== null) ?? null;
    blocks.push({
      id: "none-yet",
      type: "note",
      label: null,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      tone: lapsed !== null ? "attention" : data.readiness.ready ? "active" : "neutral",
      title:
        lapsed !== null
          ? "The last comparison is out of date"
          : "No comparison has been made yet",
      text:
        lapsed !== null
          ? `${lapsed.supersededReason ?? "A quote it included has changed."} It is kept below exactly as it was made. Compare them again before putting anything to the client.`
          : data.readiness.ready
            ? "Two insurers have quoted, so these can be set against each other. Generating one records exactly which quotes and terms it compared, so it can tell you later if any of them change."
            : "There is not enough here to compare yet. What is outstanding is listed above.",
    });
  } else {
    if (data.viewingHistory) {
      blocks.push({
        id: "viewing-history",
        type: "note",
        label: null,
        evidence: [],
        actions: [],
        state: "ready",
        stateNote: null,
        tone: "neutral",
        title: `You are reading version ${c.version}, as it was made`,
        text: `Every figure below is what was compared on ${day(c.generatedAt)}. It is not what the quotes say now.`,
      });
    }
    blocks.push(...comparisonBlocks(c));
  }

  /* ---- Earlier comparisons ------------------------------------------------------------------ */

  if (data.history.length > 0) {
    blocks.push({
      id: "history",
      type: "rows",
      label: "EARLIER COMPARISONS — KEPT EXACTLY AS THEY WERE",
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      rows: data.history.slice(0, 10).map((h) => ({
        id: h.id,
        title: `Version ${h.version} — made ${day(h.generatedAt)}${h.generatedByName === null ? "" : ` by ${h.generatedByName}`}`,
        note:
          h.presentedAt === null
            ? "Not shown to the client."
            : `Shown to the client ${day(h.presentedAt)}.`,
        badge: h.supersededAt === null ? null : "Out of date",
        badgeTone: "neutral" as SpaceTone,
        why: h.supersededReason,
        related: null,
        region: null,
        actions: [
          {
            verb: "open" as const,
            label: "See what this one showed",
            stepId: null,
            disabledReason: null,
            notPermittedReason: null,
            to: {
              spaceKind: "placement" as const,
              recordType: "opportunity" as const,
              recordId: opportunityId,
              workflowId: null,
              path: `/opportunities/${opportunityId}/comparison?version=${h.version}`,
              title: `Version ${h.version}`,
              label: "COMPARISON",
            },
          },
        ],
        evidence: [],
      })),
    });
  }

  /*
   * The client's instruction. Only against a comparison that was put to the client, and only
   * with the source and the evidence of what they said — a recommendation is not a decision,
   * and a broker's click is not the client's.
   */
  if (recordingInstruction && c !== null && c.presentedAt !== null && c.presentable.can) {
    blocks.push({
      id: "instruction-form",
      type: "form",
      label: "RECORD THE CLIENT'S INSTRUCTION",
      evidence: [],
      state: "ready",
      stateNote: null,
      submitLabel: "Record the instruction",
      busy: state.busy,
      actions: [
        {
          verb: "record_evidence",
          label: "Record the instruction",
          stepId: "instruction-form",
          to: null,
          disabledReason: null,
          notPermittedReason: null,
        },
      ],
      fields: [
        {
          name: "insurerResponseId", label: "Which quote the client chose", kind: "select",
          value: "", placeholder: "", required: true,
          hint: "Only the quotes in this comparison. ASAP does not pick one for the client.",
          error: null,
          options: c.columns.map((col) => ({
            value: col.responseId,
            label: `${col.insurerName} — ${money(col.premiumAmount, col.premiumCurrency) || "no premium stated"}`,
          })),
        },
        {
          name: "source", label: "How the client told you", kind: "select", value: "telephone", placeholder: "",
          required: true, hint: "", error: null,
          options: [
            { value: "telephone", label: "By telephone" },
            { value: "email", label: "By email" },
            { value: "meeting", label: "At a meeting" },
            { value: "in_person", label: "In person" },
          ],
        },
        { name: "instructedAt", label: "When", kind: "date", value: "", placeholder: "", required: true, hint: "", error: null, options: [] },
        {
          name: "evidenceNote", label: "What the client said", kind: "textarea", value: "", placeholder: "",
          required: true, hint: "Who said it, when, and in their words where you can. This is the record of their decision.",
          error: null, options: [],
        },
        { name: "clientConditions", label: "Anything the client asked to be different", kind: "textarea", value: "", placeholder: "", required: false, hint: "", error: null, options: [] },
        { name: "requestedEffectiveAt", label: "Cover asked to begin", kind: "date", value: "", placeholder: "", required: true, hint: "", error: null, options: [] },
      ],
    });
  }

  /* ---- What a person can do ------------------------------------------------------------------ */

  const actions: SpaceFrameAction[] = [backToWork];
  if (data.permissions.canGenerate && data.opportunity.closedAt === null) {
    if (c === null || c.stale) {
      actions.push({
        verb: "prepare",
        label:
          c === null && data.history.every((h) => h.supersededAt === null)
            ? "Compare these quotes"
            : "Compare them again",
        stepId: "generate",
        to: null,
        /* The server refuses it anyway; saying so here means the control is never a dead end. */
        disabledReason: data.readiness.ready ? null : (data.readiness.blockers[0] ?? null),
        notPermittedReason: null,
      });
    }
    if (c !== null && c.presentable.can && c.presentedAt !== null && !data.viewingHistory) {
      actions.push({
        verb: "record_evidence",
        label: "Record the client's instruction",
        stepId: "instruct",
        to: null,
        disabledReason: null,
        notPermittedReason: null,
      });
    }
    if (c !== null && c.presentable.can && c.presentedAt === null) {
      actions.push({
        verb: "approve",
        label: "Record that this went to the client",
        stepId: `present:${c.id}`,
        to: null,
        disabledReason: null,
        notPermittedReason: null,
      });
    }
  }

  blocks.push({
    id: "do",
    type: "rows",
    label: "WHAT HAPPENS NEXT",
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
    rows: [
      {
        id: "actions",
        title: c === null ? "Make the comparison" : c.stale ? "Make it again" : "Put it to the client",
        note:
          c === null
            ? "Records exactly which quotes and terms are being compared."
            : c.stale
              ? "The quotes have moved since this was made."
              : "Recorded against this exact comparison, so what the client saw is on the file.",
        badge: null,
        badgeTone: "neutral" as SpaceTone,
        why: null,
        related: null,
        region: null,
        actions: actions.slice(1),
        evidence: [],
      },
      {
        id: "back",
        title: "The quotation work",
        note: "Requirements, the insurers being approached, and what each has said.",
        badge: null,
        badgeTone: "neutral" as SpaceTone,
        why: null,
        related: backToWork.to ?? null,
        region: null,
        actions: [backToWork],
        evidence: [],
      },
    ],
  });

  const status: { label: string; tone: SpaceTone } =
    c === null
      ? data.history.some((h) => h.supersededAt !== null)
        ? { label: "Out of date", tone: "attention" }
        : data.readiness.ready
          ? { label: "Ready to compare", tone: "active" }
          : { label: "Not enough to compare", tone: "neutral" }
      : c.stale
        ? { label: "Out of date", tone: "attention" }
        : c.presentedAt !== null
          ? { label: "Shown to the client", tone: "done" }
          : { label: "Ready to put to the client", tone: "active" };

  return {
    ...base,
    related: [backToWork.to!],
    actions: [],
    status,
    state: "ready",
    emptyState: null,
    blocks,
  };
}

/** The comparison proper: whether it still holds, the columns, the rows, and the recommendation. */
function comparisonBlocks(c: Comparison): SpaceFrameBlock[] {
  const blocks: SpaceFrameBlock[] = [];

  if (!c.presentable.can && !c.stale) {
    /* Current, but holding an expired quotation. Different from stale, and said differently. */
    blocks.push({
      id: "not-presentable",
      type: "note",
      label: null,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      tone: "attention",
      title: "This cannot go to the client yet",
      text: c.presentable.reason ?? "One of these quotes is no longer an offer.",
    });
  }

  if (c.stale) {
    blocks.push({
      id: "stale",
      type: "note",
      label: null,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      tone: "attention",
      title: "This comparison is out of date",
      text: `${c.staleReason ?? "A quote it included has changed."} It is kept exactly as it was made. Compare them again before putting anything to the client.`,
    });
    if (c.changedValues.length > 0) {
      blocks.push({
        id: "changed-values",
        type: "rows",
        label: "WHAT IT SAID THEN, AND WHAT IT SAYS NOW",
        evidence: [],
        actions: [],
        state: "ready",
        stateNote: null,
        rows: c.changedValues.slice(0, 20).map((change, index) => ({
          id: `changed-${index}`,
          title: `${change.insurerName} — ${change.label}`,
          note:
            change.was === null
              ? `Stated since: ${change.now ?? "—"}`
              : change.now === null
                ? `Was ${change.was}; no longer recorded`
                : `Was ${change.was} → now ${change.now}`,
          badge: change.termType === null ? "Premium" : TERM_WORDS[change.termType],
          badgeTone: "attention" as SpaceTone,
          why: null,
          related: null,
          region: null,
          actions: [],
          evidence: [],
        })),
      });
    }
    if (c.changes.length > 0) {
      blocks.push({
        id: "changes",
        type: "rows",
        label: "WHAT HAS MOVED SINCE",
        evidence: [],
        actions: [],
        state: "ready",
        stateNote: null,
        rows: c.changes.slice(0, 20).map((change, index) => ({
          id: `change-${index}`,
          title: change.label === null ? change.insurerName : `${change.insurerName} — ${change.label}`,
          note: change.change,
          badge: change.termType === null ? "Premium" : TERM_WORDS[change.termType],
          badgeTone: "attention" as SpaceTone,
          why: null,
          related: null,
          region: null,
          actions: [],
          evidence: [],
        })),
      });
    }
  }

  /* The premiums, with what is known about how long each holds. */
  blocks.push({
    id: "premiums",
    type: "table",
    label: `WHAT EACH INSURER QUOTED — COMPARED ${day(c.generatedAt).toUpperCase()}`,
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
    columns: [
      { label: "Insurer" },
      { label: "Premium" },
      { label: "Received" },
      { label: "Holds until" },
    ],
    rows: c.columns.slice(0, 5).map((column) => ({
      id: column.insurerId,
      cells: [
        { value: column.insurerName, tone: "neutral" as SpaceTone },
        {
          value: column.premiumAmount === null ? "No premium stated" : money(column.premiumAmount, column.premiumCurrency),
          tone: (column.premiumAmount === null ? "attention" : "neutral") as SpaceTone,
        },
        { value: day(column.receivedAt) || "Not recorded", tone: "neutral" as SpaceTone },
        {
          /* Four states, in words. A quote whose validity nobody stated is not an open offer. */
          value: `${VALIDITY_WORDS[column.validity.state]} — ${column.validity.note}`,
          tone: (column.validity.state === "valid" ? "neutral" : "attention") as SpaceTone,
        },
      ],
    })),
  });

  if (c.rows.length === 0) {
    blocks.push({
      id: "no-terms",
      type: "note",
      label: null,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      tone: "attention",
      title: "No terms have been recorded against these quotes",
      text: "Only the premiums can be compared. Record the excesses, limits and conditions on each insurer's page — from the quotation document, where there is one — and compare again.",
    });
  } else {
    blocks.push({
      id: "terms",
      type: "compare",
      /* An insurer silent on a term is shown as silent. Silence is not a nil excess. */
      label: "TERM BY TERM — A TERM AN INSURER DID NOT STATE IS SHOWN AS NOT STATED",
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      termHeading: "TERM",
      columns: c.columns.slice(0, 5).map((column) => ({ label: column.insurerName })),
      rows: c.rows.slice(0, 30).map((row) => ({
        label: `${TERM_WORDS[row.termType]} — ${row.label}`,
        cells: row.cells.slice(0, 5).map((cell) => cellWords(cell)),
      })),
    });
  }

  /* Evidence: each quote opens at the thing it was read from. */
  const sourced = c.columns.filter((column) => column.source !== null);
  if (sourced.length > 0) {
    blocks.push({
      id: "sources",
      type: "rows",
      label: "WHERE THESE CAME FROM",
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      rows: sourced.map((column) => ({
        id: `source-${column.insurerId}`,
        title: column.insurerName,
        note: column.source!.label,
        badge: null,
        badgeTone: "neutral" as SpaceTone,
        why: null,
        related: null,
        region: null,
        actions:
          column.source!.path === null
            ? []
            : [
                {
                  verb: "open" as const,
                  label: "Open the source",
                  stepId: null,
                  disabledReason: null,
                  notPermittedReason: null,
                  to: {
                    spaceKind: "document" as const,
                    recordType: "document" as const,
                    recordId: column.source!.id,
                    workflowId: null,
                    path: column.source!.path,
                    title: column.source!.label,
                    label: "SOURCE",
                  },
                },
              ],
        evidence: evidenceOf(column.source),
      })),
    });
  }

  /*
   * What the comparison says, exactly as the server reasoned it.
   *
   * The differences come first and are always stated: they are true whether or not this
   * brokerage has a rule. Naming a recommended quote is separate, and happens only under a rule
   * the brokerage configured — so where there is none, this says so rather than leaving a gap
   * that reads like an endorsement of the cheapest column.
   */
  if (c.recommendation.facts.length > 0) {
    blocks.push({
      id: "differences",
      type: "missing",
      label: "THE DIFFERENCES",
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      items: c.recommendation.facts.slice(0, 12).map((text) => ({ text })),
    });
  }

  blocks.push({
    id: "recommendation",
    type: "note",
    label: null,
    evidence: [],
    actions: [],
    state: "ready",
    stateNote: null,
    tone: c.recommendation.insurerId === null ? "waiting" : "active",
    title: c.recommendation.headline,
    text:
      [
        ...c.recommendation.reasoning,
        ...c.recommendation.caveats.map((v) => `Bear in mind: ${v}`),
        ...(c.recommendation.rule === null
          ? []
          : [
              `This brokerage's rule: ${c.recommendation.rule.summary} (${c.recommendation.rule.source}, checked ${day(c.recommendation.rule.verifiedAt)}.)`,
            ]),
      ]
        .join("\n")
        .slice(0, 1200) || "Nothing further to weigh.",
  });

  if (c.presentedAt !== null) {
    blocks.push({
      id: "presented",
      type: "note",
      label: null,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
      tone: "done",
      title: "This comparison went to the client",
      text: `Shown ${day(c.presentedAt)}${c.presentedByName === null ? "" : ` by ${c.presentedByName}`}. If a quote changes after this, the comparison is marked out of date and this record stays as it was.`,
    });
  }

  return blocks;
}
