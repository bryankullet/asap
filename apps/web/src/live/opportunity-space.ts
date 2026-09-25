import type {
  EvidenceRef,
  OpportunityInsurer,
  OpportunityResponse,
  SpaceFrame,
  SpaceFrameAction,
  SpaceFrameBlock,
  SpaceRef,
  SpaceRow,
  SpaceTone,
} from "@asap/schema";

/**
 * Quotation work, as Spaces (D-084).
 *
 * The title is the work's own name — "Acme motor fleet quotation — 2027". Nothing is called an
 * Opportunity Space or a Quote Space on screen.
 *
 * The vocabulary is the market's, kept apart from every other layer on purpose:
 *
 *   - an insurer has **not been asked**, has been **asked**, or has **quoted**, **declined** or
 *     **not answered**;
 *   - a request is **prepared**, **approved**, or — never yet — **sent**;
 *   - the piece of work a person owns keeps its own words, and when an outside party holds it the
 *     party and the date are named, never a bare "Waiting" (D-075).
 *
 * None of those words is stored. Each is read from the rows every time.
 */

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

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

/** Where one insurer has got to, in the market's own words. */
export function insurerStanding(i: OpportunityInsurer): { label: string; tone: SpaceTone } {
  if (i.removedAt !== null) return { label: "No longer approached", tone: "neutral" };
  if (i.response !== null) {
    switch (i.response.outcome) {
      case "quoted":
        return { label: "Quoted", tone: "done" };
      case "declined":
        return { label: "Declined", tone: "attention" };
      default:
        return { label: "No answer yet", tone: "waiting" };
    }
  }
  if (i.request === null) return { label: "Not asked yet", tone: "neutral" };
  if (i.request.sentAt !== null) return { label: "Asked", tone: "waiting" };
  if (i.request.approvedAt !== null) return { label: "Approved, not sent", tone: "waiting" };
  return { label: "Prepared", tone: "active" };
}

/** The work a person owns keeps its own words, and names the party holding it. */
function workWords(w: OpportunityResponse["workItem"]): { label: string; tone: SpaceTone } {
  switch (w.taskStatus) {
    case "needs_you":
      return { label: "Yours", tone: "attention" };
    case "with_party":
      return {
        label:
          w.taskParty === null
            ? "With someone else"
            : `With ${w.taskParty}${w.taskSince ? ` since ${day(w.taskSince)}` : ""}`,
        tone: "waiting",
      };
    case "in_progress":
      return { label: "In progress", tone: "active" };
    default:
      return { label: "Done", tone: "done" };
  }
}

/* ---- The opportunity -------------------------------------------------------------------------- */

export function opportunitySpace(
  data: OpportunityResponse | undefined,
  state: { loading: boolean; error: string | null; missing: boolean; busy: boolean },
  opportunityId: string,
): SpaceFrame {
  const self: SpaceRef = {
    spaceKind: "placement",
    recordType: "opportunity",
    recordId: opportunityId,
    workflowId: data?.workItem.id ?? null,
    path: `/opportunities/${opportunityId}`,
    title: data?.opportunity.title ?? "Quotation work",
    label: "QUOTATION",
  };
  const base = {
    self,
    title: data?.opportunity.title ?? "Quotation work",
    context:
      "What this client needs insured, what is still missing, who is being approached, and what each insurer has actually said.",
    filters: [],
    evidence: [],
    permission: { canAssign: false, canApprove: data?.permissions.canApprove ?? false, note: null },
    degraded: [],
  };

  if (state.error !== null) {
    return {
      ...base,
      related: [],
      actions: [],
      status: { label: "Could not read", tone: "attention" },
      blocks: [note("error", "attention", "We could not read this quotation work", state.error)],
      state: "error",
      emptyState: null,
    };
  }
  if (state.missing) {
    return {
      ...base,
      related: [],
      actions: [],
      status: { label: "Not found", tone: "neutral" },
      blocks: [],
      state: "empty",
      emptyState: {
        heading: "This quotation work is not here.",
        body: "It may have been removed, or it belongs to another brokerage.",
        actions: [],
      },
    };
  }
  if (state.loading || !data) {
    return {
      ...base,
      related: [],
      actions: [],
      status: { label: "Reading", tone: "active" },
      blocks: [],
      state: "loading",
      emptyState: null,
    };
  }

  const o = data.opportunity;
  const live = data.insurers.filter((i) => i.removedAt === null);
  const quoted = live.filter((i) => i.response?.outcome === "quoted");
  const outstanding = data.requirements.filter((r) => r.required && r.suppliedAt === null);
  const blocks: SpaceFrameBlock[] = [];

  blocks.push(
    facts("about", "WHAT IS BEING QUOTED", [
      ["Client", data.client.name],
      ["Class", o.classOfBusiness],
      ["Risk", o.riskSummary ?? ""],
      ["Cover requested", o.coverStart === null ? "" : `${day(o.coverStart)} – ${day(o.coverEnd)}`],
      ["Owner", o.ownerName ?? ""],
      ["Insurers approached", live.length === 0 ? "None yet" : String(live.length)],
      ["Quotes in", quoted.length === 0 ? "None yet" : String(quoted.length)],
    ]),
  );

  if (o.closedAt !== null) {
    blocks.push(
      note(
        "closed",
        "neutral",
        `Closed — ${o.closedOutcome === "placed" ? "placed" : o.closedOutcome === "lost" ? "lost" : "withdrawn"}`,
        `${o.closedReason ?? ""} Nothing more is recorded against it.`,
      ),
    );
  }

  /* Where the need came from, openable. A citation you cannot open is not a citation (§36). */
  if (o.source !== null) {
    blocks.push({
      id: "source",
      type: "rows",
      label: "WHERE THIS CAME FROM",
      rows: [evidenceRow("source", o.source)],
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  /*
   * What is still missing. Shown whenever anything required is outstanding, because that is what
   * stops the market being approached honestly — a silence here reads as "ready".
   */
  if (outstanding.length > 0) {
    blocks.push({
      id: "missing",
      type: "missing",
      label: "NEEDED BEFORE INSURERS ARE ASKED",
      items: outstanding.map((r) => ({ text: r.label })),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  if (data.requirements.length > 0) {
    blocks.push({
      id: "requirements",
      type: "rows",
      label: "WHAT THIS REQUEST NEEDS",
      rows: data.requirements.map((r) => ({
        id: r.id,
        title: r.label,
        note:
          r.suppliedAt === null
            ? r.required
              ? "Still needed"
              : "Worth having, not blocking"
            : `Supplied ${day(r.suppliedAt)}${r.suppliedByName ? ` by ${r.suppliedByName}` : ""}`,
        badge: r.suppliedAt === null ? (r.required ? "Needed" : "Optional") : "Supplied",
        badgeTone: r.suppliedAt === null ? (r.required ? "waiting" : "neutral") : "done",
        why: r.evidence === null ? null : evidenceWords(r.evidence),
        related: null,
        region: null,
        actions:
          r.suppliedAt !== null || o.closedAt !== null
            ? []
            : [
                {
                  verb: "record_evidence",
                  label: "Mark supplied",
                  to: null,
                  stepId: `supply:${r.id}`,
                  disabledReason: state.busy ? "One moment…" : null,
                  notPermittedReason: data.permissions.canEdit ? null : "You may not change this quotation work.",
                },
              ],
        evidence: [],
      })),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  /* ---- The market ----------------------------------------------------------------------- */
  if (data.insurers.length > 0) {
    blocks.push({
      id: "insurers",
      type: "rows",
      label: "INSURERS",
      rows: data.insurers.map((i) => {
        const standing = insurerStanding(i);
        const parts: string[] = [];
        if (i.response?.outcome === "quoted") {
          const m = money(i.response.premiumAmount, i.response.premiumCurrency);
          if (m !== "") parts.push(m);
          if (i.response.validUntil !== null) parts.push(`valid to ${day(i.response.validUntil)}`);
          parts.push(plural(i.response.terms.length, "term"));
        } else if (i.response?.outcome === "declined") {
          parts.push(i.response.declineReason ?? "");
        } else if (i.removedAt !== null) {
          parts.push(i.removedReason ?? "");
        } else if (i.request !== null) {
          parts.push(
            i.request.approvedAt === null
              ? `Prepared ${day(i.request.preparedAt)}`
              : `Approved ${day(i.request.approvedAt)}`,
          );
        }
        return {
          id: i.id,
          title: i.insurerName,
          note: parts.filter((p) => p !== "").join(" · "),
          badge: standing.label,
          badgeTone: standing.tone,
          /*
           * An approved request that cannot go anywhere says so here, rather than leaving a
           * person to assume it went.
           */
          why:
            i.request?.approvedAt !== null && i.request?.sentAt === null && !data.sending.available
              ? data.sending.reason
              : null,
          related:
            i.response === null
              ? null
              : {
                  spaceKind: "placement",
                  recordType: "insurer_response",
                  recordId: i.response.id,
                  workflowId: null,
                  path: `/opportunities/${opportunityId}/insurers/${i.id}`,
                  title: `${i.insurerName} — terms`,
                  label: "TERMS",
                },
          region: null,
          actions: insurerActions(i, data, state.busy, o.closedAt !== null),
          evidence: [],
        };
      }),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  /* Adding one, from the brokerage's own insurers. */
  if (o.closedAt === null && data.availableInsurers.length > 0) {
    const notYet = data.availableInsurers.filter(
      (a) => !live.some((i) => i.insurerId === a.id),
    );
    if (notYet.length > 0) {
      blocks.push({
        id: "add-insurer",
        type: "form",
        label: "APPROACH ANOTHER INSURER",
        fields: [
          {
            name: "insurerId",
            label: "Insurer",
            kind: "select",
            value: "",
            placeholder: "",
            required: true,
            options: notYet.map((a) => ({ value: a.id, label: a.name })),
            hint: "",
            error: null,
          },
        ],
        submitLabel: "Add this insurer",
        busy: state.busy,
        evidence: [],
        actions: [
          {
            verb: "prepare",
            label: "Add this insurer",
            to: null,
            stepId: "add-insurer",
            disabledReason: null,
            notPermittedReason: data.permissions.canEdit ? null : "You may not change this quotation work.",
          },
        ],
        state: "ready",
        stateNote: null,
      });
    }
  }

  if (data.documents.length > 0) {
    blocks.push({
      id: "documents",
      type: "rows",
      label: "DOCUMENTS ON THIS CLIENT",
      rows: data.documents.map((d) => ({
        id: d.id,
        title: d.filename,
        note: day(d.createdAt),
        badge: null,
        badgeTone: "neutral",
        why: null,
        related: {
          spaceKind: "document",
          recordType: "document",
          recordId: d.id,
          workflowId: null,
          path: `/documents/${d.id}`,
          title: d.filename,
          label: "DOCUMENT",
        },
        region: null,
        actions: [],
        evidence: [],
      })),
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  /*
   * Comparison belongs to the next increment. The link is honest about that: it opens where the
   * comparison will live, and says what is ready for it.
   */
  if (quoted.length > 0) {
    blocks.push(
      note(
        "comparison",
        quoted.length > 1 ? "active" : "neutral",
        `${plural(quoted.length, "quote")} ready to compare`,
        quoted.length > 1
          ? "Comparing terms side by side is the next piece of work to be built. The terms themselves are recorded here and on each insurer's page."
          : "One insurer has quoted. A comparison needs at least two.",
      ),
    );
  }

  const work = workWords(data.workItem);
  return {
    ...base,
    related: [
      {
        spaceKind: "client",
        recordType: "client",
        recordId: data.client.id,
        workflowId: null,
        path: `/clients/${data.client.id}`,
        title: data.client.name,
        label: "CLIENT",
      },
      {
        spaceKind: "work_item",
        recordType: "work_item",
        recordId: data.workItem.id,
        workflowId: data.workItem.id,
        path: `/r/${data.workItem.id}`,
        title: o.title,
        label: "WORK",
      },
    ],
    actions: [],
    status:
      o.closedAt !== null
        ? { label: "Closed", tone: "neutral" }
        : { label: work.label, tone: work.tone },
    blocks,
    state: "ready",
    emptyState: null,
  };
}

function insurerActions(
  i: OpportunityInsurer,
  data: OpportunityResponse,
  busy: boolean,
  closed: boolean,
): SpaceFrameAction[] {
  if (closed || i.removedAt !== null) return [];
  const out: SpaceFrameAction[] = [];
  const notPermitted = data.permissions.canEdit ? null : "You may not change this quotation work.";

  /*
   * An insurer who has already answered is not asked again from here. Preparing a fresh request
   * after a decline is a decision about re-approaching the market, not a gap to fill in silently.
   */
  if (i.request === null && i.response === null) {
    out.push({
      verb: "prepare",
      label: "Prepare the request",
      to: null,
      stepId: `prepare:${i.id}`,
      disabledReason: busy ? "One moment…" : null,
      notPermittedReason: notPermitted,
    });
  } else if (i.request !== null && i.request.approvedAt === null) {
    out.push({
      verb: "approve",
      label: "Approve it going out",
      to: null,
      stepId: `approve:${i.request.id}`,
      disabledReason: busy ? "One moment…" : null,
      notPermittedReason: data.permissions.canApprove
        ? null
        : "You may not approve messages going out of this brokerage.",
    });
  }

  if (i.response === null) {
    out.push({
      verb: "record_evidence",
      label: "Record what they said",
      to: null,
      stepId: `respond:${i.id}`,
      disabledReason: busy ? "One moment…" : null,
      notPermittedReason: notPermitted,
    });
  }
  return out;
}

/* ---- One insurer's terms ----------------------------------------------------------------------- */

export function quoteSpace(
  data: OpportunityResponse | undefined,
  state: { loading: boolean; error: string | null; missing: boolean; busy: boolean },
  opportunityId: string,
  opportunityInsurerId: string,
): SpaceFrame {
  const found = data?.insurers.find((i) => i.id === opportunityInsurerId) ?? null;
  const title = found === null ? "Terms" : `${found.insurerName} — ${data?.opportunity.title ?? "terms"}`;
  const self: SpaceRef = {
    spaceKind: "placement",
    recordType: "insurer_response",
    recordId: found?.response?.id ?? null,
    workflowId: null,
    path: `/opportunities/${opportunityId}/insurers/${opportunityInsurerId}`,
    title,
    label: "TERMS",
  };
  const base = {
    self,
    title,
    context: "One insurer's answer, with the terms exactly as recorded and where each came from.",
    filters: [],
    evidence: [],
    permission: { canAssign: false, canApprove: false, note: null },
    degraded: [],
  };

  if (state.error !== null) {
    return {
      ...base,
      related: [],
      actions: [],
      status: { label: "Could not read", tone: "attention" },
      blocks: [note("error", "attention", "We could not read these terms", state.error)],
      state: "error",
      emptyState: null,
    };
  }
  if (state.loading || !data) {
    return { ...base, related: [], actions: [], status: { label: "Reading", tone: "active" }, blocks: [], state: "loading", emptyState: null };
  }
  if (found === null) {
    return {
      ...base,
      related: [],
      actions: [],
      status: { label: "Not found", tone: "neutral" },
      blocks: [],
      state: "empty",
      emptyState: {
        heading: "This insurer is not part of that quotation work.",
        body: "It may have been removed, or the link is wrong.",
        actions: [],
      },
    };
  }

  const standing = insurerStanding(found);
  const r = found.response;
  const blocks: SpaceFrameBlock[] = [];

  blocks.push(
    facts("about", "THIS INSURER'S ANSWER", [
      ["Insurer", found.insurerName],
      ["Client", data.client.name],
      ["Answer", standing.label],
      ["Received", r?.receivedAt ? day(r.receivedAt) : ""],
      ["Premium", r === null ? "" : money(r.premiumAmount, r.premiumCurrency)],
      ["Valid until", r?.validUntil ? day(r.validUntil) : ""],
      ["Recorded by", r?.recordedByName ?? ""],
    ]),
  );

  /*
   * Nothing here says an insurer answered because a row exists. When they have not, the Space
   * says which of the two silences it is: never asked, asked and waiting, or asked and refused.
   */
  if (r === null) {
    blocks.push(
      note(
        "no-answer",
        "waiting",
        found.request === null ? "This insurer has not been asked yet" : "No answer recorded yet",
        found.request === null
          ? "Nothing has been prepared for them. Preparing a request does not send it."
          : found.request.approvedAt === null
            ? "A request is prepared and waiting for somebody to approve it going out."
            : (data.sending.reason ?? "The request is approved and has not gone out."),
      ),
    );
  } else if (r.outcome === "declined") {
    blocks.push(note("declined", "attention", "They declined", r.declineReason ?? ""));
  } else if (r.outcome === "no_response") {
    blocks.push(
      note("silent", "waiting", "No answer", "They were asked and have not come back. Nothing is assumed from that."),
    );
  }

  if (r !== null && r.source !== null) {
    blocks.push({
      id: "source",
      type: "rows",
      label: "WHERE THESE TERMS CAME FROM",
      rows: [evidenceRow("source", r.source)],
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });
  }

  if (r !== null && r.terms.length > 0) {
    const rows: SpaceRow[] = r.terms.map((t) => ({
      id: t.id,
      title: t.label,
      note: t.unclear
        ? "The insurer's wording does not give a figure"
        : [t.correctedValue ?? t.extractedValue ?? "", money(t.amount, t.currency)]
            .filter((s) => s !== "")
            .join(" · "),
      badge: termTypeWords(t.termType),
      badgeTone: t.unclear ? "waiting" : "neutral",
      /*
       * A corrected term keeps what was read. Both are shown, because the difference between
       * them is the audit — and a person reading the comparison later needs to know one was made.
       */
      why:
        t.correctedValue !== null
          ? `Read as “${t.extractedValue ?? "nothing"}”, corrected to “${t.correctedValue}”${t.correctedByName ? ` by ${t.correctedByName}` : ""}${t.correctedAt ? ` on ${day(t.correctedAt)}` : ""}.`
          : t.unclear
            ? "Recorded as unclear rather than guessed into a number."
            : null,
      related: null,
      region: null,
      actions: [],
      evidence: [],
    }));
    blocks.push({
      id: "terms",
      type: "rows",
      label: "TERMS",
      rows,
      evidence: [],
      actions: [],
      state: "ready",
      stateNote: null,
    });

    const unclear = r.terms.filter((t) => t.unclear);
    if (unclear.length > 0) {
      blocks.push({
        id: "unclear",
        type: "missing",
        label: "NOT YET COMPARABLE",
        items: unclear.map((t) => ({ text: `${t.label} — the insurer gave wording, not a figure` })),
        evidence: [],
        actions: [],
        state: "ready",
        stateNote: null,
      });
    }
  } else if (r !== null && r.outcome === "quoted") {
    blocks.push(
      note(
        "no-terms",
        "waiting",
        "No terms recorded yet",
        "A premium is on file, but none of the excesses, limits, conditions or exclusions have been recorded, so this cannot be compared.",
      ),
    );
  }

  return {
    ...base,
    related: [
      {
        spaceKind: "placement",
        recordType: "opportunity",
        recordId: opportunityId,
        workflowId: null,
        path: `/opportunities/${opportunityId}`,
        title: data.opportunity.title,
        label: "QUOTATION",
      },
      {
        spaceKind: "client",
        recordType: "client",
        recordId: data.client.id,
        workflowId: null,
        path: `/clients/${data.client.id}`,
        title: data.client.name,
        label: "CLIENT",
      },
    ],
    actions: [],
    status: standing,
    blocks,
    state: "ready",
    emptyState: null,
  };
}

function termTypeWords(t: string): string {
  switch (t) {
    case "excess":
      return "Excess";
    case "limit":
      return "Limit";
    case "condition":
      return "Condition";
    case "exclusion":
      return "Exclusion";
    case "levy":
      return "Levy";
    case "tax":
      return "Tax";
    case "subjectivity":
      return "Subject to";
    default:
      return "Term";
  }
}

function evidenceWords(e: EvidenceRef): string {
  return e.kind === "note" ? e.label : `${e.label}.`;
}

function evidenceRow(id: string, e: EvidenceRef): SpaceRow {
  return {
    id,
    title: e.kind === "note" ? e.label : e.label,
    note: e.kind === "document" ? "A document on file" : e.kind === "email" ? "An email in the mailbox" : "Recorded by a person",
    badge: null,
    badgeTone: "neutral",
    why: null,
    related:
      e.path === null || e.id === null
        ? null
        : {
            spaceKind: e.kind === "document" ? "document" : "communication",
            recordType: e.kind === "document" ? "document" : "email_thread",
            recordId: e.id,
            workflowId: null,
            path: e.path,
            title: e.label,
            label: e.kind === "document" ? "DOCUMENT" : "CONVERSATION",
          },
    region: null,
    actions: [],
    evidence: [],
  };
}

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
  return { id, type: "note", label: null, tone, title, text: text || "—", evidence: [], actions: [], state: "ready", stateNote: null };
}
