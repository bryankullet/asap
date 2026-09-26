import {
  COVER_LABELS,
  type PlacementResponse,
  type SpaceFrame,
  type SpaceFrameAction,
  type SpaceFrameBlock,
  type SpaceRef,
  type SpaceTone,
} from "@asap/schema";

/**
 * One client's placement, as a Space (4B-4).
 *
 * The title is the work's own name — "Acme motor fleet placement — 2027". Never "Placement
 * Space", never "Space: Acme".
 *
 * The screen holds three vocabularies apart, because each answers a different question:
 *
 *   - the **work** headline — Yours, With Jubilee since 8 Sep, Done — is whose move it is;
 *   - the **cover line** — Requested, Submitted, Confirmed, Active cover, Expired, Cancelled — is
 *     whether the client is covered, and its words come only from `COVER_LABELS`;
 *   - a **run** belongs in Activity, and never appears here.
 *
 * And it never lets one step pass for the next. A draft says it is a draft; an approved request
 * says it has not been sent; a submission says there is no cover yet; a confirmation that begins
 * next month says it has not started.
 */

const SOURCE_WORDS: Record<PlacementResponse["instruction"]["source"], string> = {
  email: "by email",
  document: "in a document",
  telephone: "by telephone",
  meeting: "at a meeting",
  signed_acceptance: "by signed acceptance",
  in_person: "in person",
};

const METHOD_WORDS: Record<NonNullable<NonNullable<PlacementResponse["request"]>["submission"]>["method"], string> = {
  provider_email: "Sent by email from ASAP",
  recorded_manual_email: "Sent by email outside ASAP",
  recorded_portal: "Uploaded to the insurer's portal",
  recorded_post: "Sent by post",
  recorded_in_person: "Delivered in person",
};

const OUTCOME_WORDS: Record<NonNullable<PlacementResponse["insurerResponse"]>["outcome"], { label: string; tone: SpaceTone }> = {
  confirmed_as_requested: { label: "Confirmed as requested", tone: "done" },
  confirmed_with_changes: { label: "Confirmed on changed terms", tone: "attention" },
  more_information_required: { label: "Needs more information", tone: "attention" },
  declined: { label: "Declined", tone: "attention" },
};

const TERM_WORDS: Record<PlacementResponse["basis"]["terms"][number]["termType"], string> = {
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

function day(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function short(iso: string | null): string {
  if (iso === null) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function money(amount: string | null, currency: string | null): string {
  if (amount === null || currency === null) return "";
  const n = Number(amount);
  return Number.isNaN(n) ? `${currency} ${amount}` : `${currency} ${n.toLocaleString("en-KE")}`;
}

/** The work headline. Names the outside party and the date, never a bare "Waiting". */
function workWords(w: PlacementResponse["workItem"]): { label: string; tone: SpaceTone } {
  switch (w.taskStatus) {
    case "needs_you":
      return { label: "Yours", tone: "attention" };
    case "with_party":
      return {
        label: w.taskParty === null ? "With someone else" : `With ${w.taskParty}${w.taskSince ? ` since ${short(w.taskSince)}` : ""}`,
        tone: "waiting",
      };
    case "in_progress":
      return { label: "In progress", tone: "active" };
    default:
      return { label: "Done", tone: "neutral" };
  }
}

const ready = { evidence: [], actions: [], state: "ready" as const, stateNote: null };

function row(
  id: string,
  title: string,
  note: string,
  extra: Partial<{ badge: string | null; badgeTone: SpaceTone; why: string | null; actions: SpaceFrameAction[]; related: SpaceRef | null }> = {},
) {
  return {
    id,
    title,
    note,
    badge: extra.badge ?? null,
    badgeTone: extra.badgeTone ?? ("neutral" as SpaceTone),
    why: extra.why ?? null,
    related: extra.related ?? null,
    region: null,
    actions: extra.actions ?? [],
    evidence: [],
  };
}

function act(
  label: string,
  stepId: string,
  verb: SpaceFrameAction["verb"],
  disabledReason: string | null = null,
  notPermittedReason: string | null = null,
): SpaceFrameAction {
  return { verb, label, stepId, to: null, disabledReason, notPermittedReason };
}

function open(label: string, to: SpaceRef): SpaceFrameAction {
  return { verb: "open", label, stepId: null, to, disabledReason: null, notPermittedReason: null };
}

/**
 * Which form is open. Interface state only — which panel a person is filling in — never a
 * business fact. Every value it collects goes to the server as a typed action, and nothing is
 * recorded until the server says so.
 */
export type PlacementDraft = "submission" | "response" | null;

export function placementSpace(
  data: PlacementResponse | undefined,
  state: { loading: boolean; error: string | null; missing: boolean; busy: boolean },
  placementId: string,
  drafting: PlacementDraft = null,
): SpaceFrame {
  const title = data?.placement.title ?? "Placement";
  const self: SpaceRef = {
    spaceKind: "placement",
    recordType: "placement",
    recordId: placementId,
    workflowId: data?.workItem.id ?? null,
    path: `/placements/${placementId}`,
    title,
    label: "PLACEMENT",
  };
  const base = {
    self,
    title,
    context: "What the client instructed, exactly what they accepted, what was sent, and what the insurer said back.",
    filters: [],
    evidence: [],
    permission: { canAssign: false, canApprove: data?.permissions.canApprove ?? false, note: null },
    degraded: [],
  };

  if (state.error !== null) {
    return { ...base, related: [], actions: [], blocks: [], status: { label: "Could not read", tone: "attention" }, state: "error", emptyState: { heading: "This placement could not be read", body: state.error, actions: [] } };
  }
  if (state.missing) {
    return { ...base, related: [], actions: [], blocks: [], status: { label: "Not found", tone: "neutral" }, state: "empty", emptyState: { heading: "No placement with that address", body: "", actions: [] } };
  }
  if (state.loading || data === undefined) {
    return { ...base, related: [], actions: [], blocks: [], status: { label: "Reading", tone: "active" }, state: "loading", emptyState: null };
  }

  const d = data;
  const blocks: SpaceFrameBlock[] = [];
  const work = workWords(d.workItem);

  const opportunityRef: SpaceRef = {
    spaceKind: "placement", recordType: "opportunity", recordId: d.opportunity.id, workflowId: null,
    path: `/opportunities/${d.opportunity.id}`, title: d.opportunity.title, label: "QUOTATION",
  };
  /* Its own identity: the comparison is a different record from the quotation work, and sharing
   * the opportunity's identity made the two Related links one key. */
  const comparisonRef: SpaceRef = {
    spaceKind: "placement", recordType: "comparison", recordId: d.opportunity.id, workflowId: null,
    path: `/opportunities/${d.opportunity.id}/comparison${d.instruction.comparisonVersion === null ? "" : `?version=${d.instruction.comparisonVersion}`}`,
    title: "The comparison the client was shown", label: "COMPARISON",
  };
  const clientRef: SpaceRef = {
    spaceKind: "client", recordType: "client", recordId: d.client.id, workflowId: null,
    path: `/clients/${d.client.id}`, title: d.client.name, label: "CLIENT",
  };

  /* ---- The cover line, and the work, on their own lines ------------------------------------ */

  blocks.push({
    id: "standing",
    type: "facts",
    label: "WHERE THIS STANDS",
    ...ready,
    facts: [
      { key: "Client", value: d.client.name, missing: false, evidence: [] },
      { key: "Insurer", value: d.insurer.name, missing: false, evidence: [] },
      {
        key: "Cover",
        /* The one cover vocabulary, from status.ts. "Active cover", never "Active". */
        value: d.cover.state === null ? d.cover.line : `${COVER_LABELS[d.cover.state]} — ${d.cover.line}`,
        missing: false,
        evidence: [],
      },
      { key: "Cover asked to begin", value: day(d.placement.requestedEffectiveAt), missing: false, evidence: [] },
    ],
  });

  /* What stops the next step. Sentences, each naming what would unblock it. */
  if (d.blockers.length > 0) {
    blocks.push({
      id: "blockers",
      type: "missing",
      label: "BEFORE THIS CAN MOVE",
      ...ready,
      items: d.blockers.slice(0, 12).map((text) => ({ text })),
    });
  }

  /* ---- The quotation moved under the client's instruction ---------------------------------- */

  if (d.drift.stale) {
    blocks.push({
      id: "drift",
      type: "rows",
      label: "THE QUOTATION CHANGED AFTER THE CLIENT ACCEPTED IT",
      ...ready,
      rows: (d.drift.changes.length === 0
        ? [row("drift-none", "A newer revision of the quote exists", "Review it before anything is sent.", { badge: "Changed", badgeTone: "attention" })]
        : d.drift.changes.slice(0, 20).map((c, i) =>
            row(`drift-${i}`, c.label, c.was === null ? `Stated since: ${c.now ?? "—"}` : c.now === null ? `Was ${c.was}; no longer stated` : `Accepted ${c.was} → now ${c.now}`, {
              badge: "Changed",
              badgeTone: "attention",
            }),
          )),
    });
  }

  /* ---- What the client said ---------------------------------------------------------------- */

  const i = d.instruction;
  blocks.push({
    id: "instruction",
    type: "rows",
    label: "WHAT THE CLIENT INSTRUCTED",
    ...ready,
    rows: [
      row(
        "instruction",
        `${d.insurer.name}, instructed ${SOURCE_WORDS[i.source]} on ${day(i.instructedAt)}`,
        [
          i.evidence.label,
          i.clientConditions === null ? null : `Client conditions: ${i.clientConditions}`,
          `Recorded by ${i.recordedByName ?? "a colleague"} on ${day(i.recordedAt)}`,
        ]
          .filter((v): v is string => v !== null)
          .join(" · "),
        {
          badge: i.outsideComparison ? "Outside the comparison" : i.comparisonVersion === null ? null : `Comparison v${i.comparisonVersion}`,
          badgeTone: i.outsideComparison ? "attention" : "neutral",
          why: i.outsideComparison ? `Recorded as an exception: ${i.exceptionReason ?? ""}` : null,
          actions: [
            ...(i.evidence.path === null
              ? []
              : [open("Open the evidence", { spaceKind: "document", recordType: "document", recordId: i.evidence.id, workflowId: null, path: i.evidence.path, title: i.evidence.label, label: "EVIDENCE" })]),
            ...(i.comparisonVersion === null ? [] : [open("See what the client was shown", comparisonRef)]),
          ],
        },
      ),
    ],
  });

  /* ---- Exactly what they accepted, frozen --------------------------------------------------- */

  blocks.push({
    id: "basis",
    type: "table",
    label: "WHAT THE CLIENT ACCEPTED — FROZEN WHEN THEY INSTRUCTED",
    ...ready,
    columns: [{ label: "Term" }, { label: "As accepted" }],
    rows: [
      {
        id: "premium",
        cells: [
          { value: "Premium", tone: "neutral" as SpaceTone },
          { value: money(d.basis.premiumAmount, d.basis.premiumCurrency) || "Not stated", tone: "neutral" as SpaceTone },
        ],
      },
      {
        id: "valid",
        cells: [
          { value: "Quote valid until", tone: "neutral" as SpaceTone },
          { value: d.basis.validUntil === null ? "Not stated" : day(d.basis.validUntil), tone: "neutral" as SpaceTone },
        ],
      },
      ...d.basis.terms.slice(0, 40).map((t, n) => ({
        id: `term-${n}`,
        cells: [
          { value: `${TERM_WORDS[t.termType]} — ${t.label}`, tone: "neutral" as SpaceTone },
          {
            value: t.unclear ? `${t.value ?? "Stated"} — cannot be compared` : (t.value ?? money(t.amount, t.currency) ?? ""),
            tone: (t.unclear ? "attention" : "neutral") as SpaceTone,
          },
        ],
      })),
    ].slice(0, 50),
  });

  /* ---- The request, and the gate in front of it --------------------------------------------- */

  const r = d.request;
  const cannotPrepare = !d.permissions.canPrepare ? "You may not prepare a placement request." : null;
  if (r === null) {
    blocks.push({
      id: "request-none",
      type: "note",
      label: null,
      ...ready,
      tone: "neutral",
      title: "No placement request has been prepared",
      text: "Preparing one makes a draft for the insurer, built from the frozen terms above. It is not sent — sending from ASAP is not connected — and it cannot be sent until someone permitted has approved that exact version.",
    });
  } else {
    blocks.push({
      id: "request",
      type: "rows",
      label: `THE REQUEST — VERSION ${r.version}`,
      ...ready,
      rows: [
        row(
          "request",
          r.subject,
          [
            r.coverRequested,
            `Cover from ${day(r.effectiveAt)}`,
            r.outstandingConditions === null ? null : `Outstanding: ${r.outstandingConditions}`,
            `Prepared by ${r.preparedByName ?? "a colleague"} on ${day(r.preparedAt)}`,
          ]
            .filter((v): v is string => v !== null)
            .join(" · "),
          {
            /* A draft must never look sent: each state says exactly what it is. */
            badge: r.submission !== null ? "Sent" : r.approval !== null ? "Approved, not sent" : "Draft",
            badgeTone: r.submission !== null ? "done" : r.approval !== null ? "waiting" : "neutral",
            why: r.body,
          },
        ),
      ],
    });

    if (r.approval === null) {
      const cannotApprove = !d.permissions.canApprove
        ? `You may not approve placement requests${d.permissions.approverRoles.length === 0 ? "." : ` — ask someone who is a ${d.permissions.approverRoles.join(" or ")}.`}`
        : d.drift.stale
          ? "The quotation changed after the client accepted it. Nothing can be approved until that is reviewed."
          : null;
      blocks.push({
        id: "approval",
        type: "approval_gate",
        label: "APPROVAL",
        evidence: [],
        state: "ready",
        stateNote: null,
        heading: `Approve version ${r.version} of this request`,
        detail: "Approval covers this exact text. Any change makes a new version, and the approval does not carry over to it.",
        blockedNote: null,
        actions: [act("Approve this version", `approve:${r.id}`, "approve", d.drift.stale ? cannotApprove : null, !d.permissions.canApprove ? cannotApprove : null)],
      });
    } else if (r.submission === null) {
      blocks.push({
        id: "approved",
        type: "note",
        label: null,
        ...ready,
        tone: "waiting",
        title: `Approved by ${r.approval.approvedByName ?? "a colleague"} on ${day(r.approval.approvedAt)} — not sent`,
        text: `${d.sending.reason ?? "Sending is not available."} Recording that it was sent needs how, to whom, when, and something that shows it.`,
      });
    }

    if (r.submission !== null) {
      const s = r.submission;
      blocks.push({
        id: "submission",
        type: "rows",
        label: "SENT TO THE INSURER",
        ...ready,
        rows: [
          row("submission", `${METHOD_WORDS[s.method]} to ${s.recipient}`, `${day(s.sentAt)} · ${s.evidence.label} · Recorded by ${s.recordedByName ?? "a colleague"}`, {
            badge: "Sent",
            badgeTone: "done",
          }),
        ],
      });
    }
  }

  /* ---- What the insurer said ---------------------------------------------------------------- */

  const ir = d.insurerResponse;
  if (ir !== null) {
    const o = OUTCOME_WORDS[ir.outcome];
    blocks.push({
      id: "insurer",
      type: "rows",
      label: `WHAT ${d.insurer.name.toUpperCase()} SAID`,
      ...ready,
      rows: [
        row(
          "insurer",
          o.label,
          [
            ir.effectiveAt === null ? null : `Cover from ${day(ir.effectiveAt)}${ir.expiryAt === null ? "" : ` to ${day(ir.expiryAt)}`}`,
            ir.insurerReference === null ? null : `Reference ${ir.insurerReference}`,
            ir.changesNote === null ? null : `Changed: ${ir.changesNote}`,
            ir.informationRequired === null ? null : `Needs: ${ir.informationRequired}`,
            ir.declineReason === null ? null : `Reason: ${ir.declineReason}`,
            ir.evidence.label,
            `Received ${day(ir.receivedAt)}`,
          ]
            .filter((v): v is string => v !== null)
            .join(" · "),
          { badge: o.label, badgeTone: o.tone },
        ),
      ],
    });
  }

  if (d.cancellation !== null) {
    blocks.push({
      id: "cancellation",
      type: "note",
      label: null,
      ...ready,
      tone: "neutral",
      title: `Cancelled from ${day(d.cancellation.cancelledAt)}`,
      text: `${d.cancellation.reason} · ${d.cancellation.evidence.label}`,
    });
  }

  /* ---- The forms that record what happened outside ASAP ------------------------------------- */

  if (drafting === "submission" && r !== null && r.approval !== null && r.submission === null) {
    blocks.push({
      id: "submission-form",
      type: "form",
      label: "RECORD THAT IT WAS SENT",
      evidence: [],
      state: "ready",
      stateNote: null,
      submitLabel: "Record it as sent",
      busy: state.busy,
      actions: [act("Record it as sent", `submit-form:${r.id}`, "record_send")],
      fields: [
        {
          name: "method", label: "How it was sent", kind: "select", value: "recorded_manual_email", placeholder: "",
          required: true, hint: "Sending from ASAP is not connected, so this is how you sent it yourself.", error: null,
          options: [
            { value: "recorded_manual_email", label: "By email, from my own mailbox" },
            { value: "recorded_portal", label: "Uploaded to the insurer's portal" },
            { value: "recorded_post", label: "By post" },
            { value: "recorded_in_person", label: "Delivered in person" },
          ],
        },
        { name: "recipient", label: "To whom", kind: "text", value: "", placeholder: "underwriting@insurer.co.ke", required: true, hint: "", error: null, options: [] },
        { name: "sentAt", label: "When", kind: "date", value: "", placeholder: "", required: true, hint: "", error: null, options: [] },
        {
          name: "evidenceNote", label: "What shows it was sent", kind: "textarea", value: "", placeholder: "",
          required: true, hint: "The time, the mailbox or portal, and any reference. \"Sent\" on its own is not evidence.",
          error: null, options: [],
        },
      ],
    });
  }

  if (drafting === "response" && r?.submission) {
    blocks.push({
      id: "response-form",
      type: "form",
      label: `RECORD WHAT ${d.insurer.name.toUpperCase()} SAID`,
      evidence: [],
      state: "ready",
      stateNote: null,
      submitLabel: "Record the answer",
      busy: state.busy,
      actions: [act("Record the answer", "respond-form", "record_evidence")],
      fields: [
        {
          name: "outcome", label: "Their answer", kind: "select", value: "confirmed_as_requested", placeholder: "",
          required: true, hint: "", error: null,
          options: [
            { value: "confirmed_as_requested", label: "Confirmed as requested" },
            { value: "confirmed_with_changes", label: "Confirmed on changed terms" },
            { value: "more_information_required", label: "Needs more information" },
            { value: "declined", label: "Declined" },
          ],
        },
        { name: "effectiveAt", label: "Cover begins", kind: "date", value: "", placeholder: "", required: false, hint: "Required for a confirmation. The insurer's date, not ours.", error: null, options: [] },
        { name: "expiryAt", label: "Cover ends", kind: "date", value: "", placeholder: "", required: false, hint: "", error: null, options: [] },
        { name: "insurerReference", label: "Their reference", kind: "text", value: "", placeholder: "Cover note number", required: false, hint: "", error: null, options: [] },
        { name: "detail", label: "What changed, what they need, or why they declined", kind: "textarea", value: "", placeholder: "", required: false, hint: "", error: null, options: [] },
        { name: "evidenceNote", label: "What shows it", kind: "textarea", value: "", placeholder: "", required: true, hint: "How their answer arrived, and when.", error: null, options: [] },
      ],
    });
  }

  /* ---- What happens next -------------------------------------------------------------------- */

  const actions: SpaceFrameAction[] = [];
  if (r === null || (r.submission === null && r.approval === null)) {
    actions.push(act(r === null ? "Prepare the request" : "Prepare a new version", "prepare", "prepare", d.drift.stale ? "The quotation changed after the client accepted it." : null, cannotPrepare));
  }
  if (r !== null && r.approval !== null && r.submission === null) {
    actions.push(
      act("Record that it was sent", `submit:${r.id}`, "record_send", d.drift.stale ? "The quotation changed after the client accepted it." : null, d.permissions.canRecordSubmission ? null : "You may not record that a placement request was sent."),
    );
  }
  if (r?.submission && (ir === null || ir.outcome === "more_information_required")) {
    actions.push(act("Record the insurer's answer", "respond", "record_evidence", null, d.permissions.canRecordResponse ? null : "You may not record what the insurer said."));
  }
  if (d.issuance.ready && d.issuance.workItemId === null) {
    actions.push(act("Prepare policy issuance", "issuance", "prepare", null, d.permissions.canPrepare ? null : "You may not prepare policy issuance."));
  }

  blocks.push({
    id: "next",
    type: "rows",
    label: "WHAT HAPPENS NEXT",
    ...ready,
    rows: [
      row("next", d.nextAction, work.label === "Yours" ? "This is with you." : work.label, { badge: work.label, badgeTone: work.tone, actions }),
      row("quotation", "The quotation work", "Requirements, the insurers approached, and what each said.", { related: opportunityRef, actions: [open("Open", opportunityRef)] }),
    ],
  });

  /* ---- History ------------------------------------------------------------------------------ */

  const events: { id: string; when: string; text: string; tone: SpaceTone; at: string }[] = [];
  for (const past of d.instructionHistory) {
    events.push({ id: `i-${past.id}`, at: past.recordedAt, when: day(past.recordedAt), text: `Earlier instruction ${SOURCE_WORDS[past.source]}, superseded: ${past.supersededReason ?? ""}`, tone: "neutral" });
  }
  events.push({ id: "i-now", at: i.recordedAt, when: day(i.recordedAt), text: `Client instructed ${d.insurer.name} ${SOURCE_WORDS[i.source]}.`, tone: "active" });
  for (const h of d.requestHistory) {
    events.push({ id: `r-${h.version}`, at: h.preparedAt, when: day(h.preparedAt), text: `Request version ${h.version} prepared${h.approvedAt === null ? "" : ", approved"}; superseded: ${h.supersededReason ?? ""}`, tone: "neutral" });
  }
  if (r !== null) events.push({ id: "r-now", at: r.preparedAt, when: day(r.preparedAt), text: `Request version ${r.version} prepared.`, tone: "neutral" });
  if (r?.approval) events.push({ id: "a-now", at: r.approval.approvedAt, when: day(r.approval.approvedAt), text: `Version ${r.version} approved by ${r.approval.approvedByName ?? "a colleague"}.`, tone: "active" });
  if (r?.submission) events.push({ id: "s-now", at: r.submission.sentAt, when: day(r.submission.sentAt), text: `Sent to ${d.insurer.name}: ${METHOD_WORDS[r.submission.method].toLowerCase()}.`, tone: "active" });
  if (ir !== null) events.push({ id: "o-now", at: ir.receivedAt, when: day(ir.receivedAt), text: `${d.insurer.name}: ${OUTCOME_WORDS[ir.outcome].label.toLowerCase()}.`, tone: OUTCOME_WORDS[ir.outcome].tone });

  blocks.push({
    id: "timeline",
    type: "timeline",
    label: "WHAT HAS HAPPENED",
    ...ready,
    events: events
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-30)
      .map(({ id, when, text, tone }) => ({ id, when, text, tone, link: null, related: null })),
  });

  return {
    ...base,
    related: [clientRef, opportunityRef, comparisonRef],
    actions: [],
    /* The headline carries the work's status. The cover has its own line, above. */
    status: work,
    state: "ready",
    emptyState: null,
    blocks: blocks.slice(0, 24),
  };
}
