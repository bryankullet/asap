import {
  COVER_LABELS,
  TASK_LABELS,
  type ApplyPreview,
  type IssuanceResponse,
  type IssuedClass,
  type SpaceFrame,
  type SpaceFrameAction,
  type SpaceFrameBlock,
  type SpaceRef,
  type SpaceTone,
} from "@asap/schema";
import { workHeadline } from "./placement-space.js";

/**
 * Policy issuance for one placement, as a Space (4B-5).
 *
 * The same renderer and the same three vocabularies as the placement: whose move it is (the work
 * headline), whether the client is covered (the cover line), and — new here — how far the policy
 * record has got. It never lets one step pass for the next: a prepared request says it has not
 * been sent, an approved one says the same, a received document says it has not been checked,
 * and nothing says "issued" until the policy record was written.
 *
 * Every value shown is read from the server's issuance view. The only browser state is which form
 * is open and which target the person is previewing.
 */

export type IssuanceDraft = "submission" | "document" | `resolve:${string}` | `correct:${string}` | "apply" | null;

const STAGE_WORDS: Record<IssuanceResponse["stage"], { label: string; tone: SpaceTone }> = {
  not_ready: { label: "Not ready for issuance", tone: "attention" },
  ready: { label: "Ready — no request prepared", tone: "attention" },
  approval_required: { label: "Request prepared — not approved, not sent", tone: "attention" },
  submission_required: { label: "Approved — not sent", tone: "attention" },
  with_insurer: { label: "Sent — policy not yet received", tone: "waiting" },
  review_required: { label: "Policy received — not yet checked", tone: "attention" },
  differences_to_resolve: { label: "Policy received — differs from what was agreed", tone: "attention" },
  ready_to_apply: { label: "Checked — not yet on the policy record", tone: "attention" },
  applied: { label: "On the policy record", tone: "done" },
};

const CLASS_TONE: Record<IssuedClass, SpaceTone> = {
  match: "done",
  changed: "attention",
  missing_from_issued: "attention",
  added_by_insurer: "attention",
  unclear: "waiting",
  not_applicable: "neutral",
};

const FIELD_WORDS: Record<string, string> = {
  insured_name: "Insured", insurer_name: "Insurer", policy_number: "Policy number", class_of_business: "Class of business",
  period_start: "Cover begins", period_end: "Cover ends", currency: "Currency", premium: "Premium", premium_basis: "Premium basis",
  sum_insured: "Sum insured",
};

const STATE_WORDS: Record<string, { label: string; tone: SpaceTone }> = {
  proposed: { label: "Not reviewed", tone: "attention" },
  accepted: { label: "Accepted", tone: "done" },
  corrected: { label: "Corrected", tone: "done" },
  rejected: { label: "Rejected", tone: "neutral" },
};

function day(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const ready = { evidence: [], actions: [], state: "ready" as const, stateNote: null };

function row(id: string, title: string, note: string, extra: Partial<{ badge: string | null; badgeTone: SpaceTone; why: string | null; actions: SpaceFrameAction[]; related: SpaceRef | null; region: SpaceFrameRow["region"] }> = {}): SpaceFrameRow {
  return {
    id, title: title.slice(0, 300), note: note.slice(0, 400), badge: extra.badge ?? null, badgeTone: extra.badgeTone ?? "neutral",
    why: extra.why ?? null, related: extra.related ?? null, region: extra.region ?? null, actions: extra.actions ?? [], evidence: [],
  };
}
type SpaceFrameRow = Extract<SpaceFrameBlock, { type: "rows" }>["rows"][number];

function act(label: string, stepId: string, verb: SpaceFrameAction["verb"], disabledReason: string | null = null, notPermittedReason: string | null = null): SpaceFrameAction {
  return { verb, label, stepId, to: null, disabledReason, notPermittedReason };
}
function open(label: string, to: SpaceRef): SpaceFrameAction {
  return { verb: "open", label, stepId: null, to, disabledReason: null, notPermittedReason: null };
}

/** A value read from the document, openable at its page and highlight. */
function regionOf(what: string, e: IssuanceResponse["documents"][number]["fields"][number]["evidence"]): SpaceFrameRow["region"] {
  if (e === null || e.page === null || e.region === null) return null;
  return { what, pageNumber: e.page, pageWidth: null, pageHeight: null, rect: e.region, fileUrl: null };
}
function evidenceNote(e: IssuanceResponse["documents"][number]["fields"][number]["evidence"]): string {
  return e === null || e.page === null ? "Not placed on a page" : `Page ${e.page}${e.region === null ? "" : ", highlighted"}`;
}

export function issuanceSpace(
  data: IssuanceResponse | undefined,
  state: { loading: boolean; error: string | null; missing: boolean; busy: boolean },
  placementId: string,
  drafting: IssuanceDraft = null,
  preview: ApplyPreview | null = null,
): SpaceFrame {
  const title = data === undefined ? "Policy issuance" : `Policy issuance — ${data.placement.title}`;
  const self: SpaceRef = {
    spaceKind: "placement", recordType: "issuance", recordId: placementId, workflowId: data?.work[0]?.id ?? null,
    path: `/placements/${placementId}/issuance`, title, label: "POLICY ISSUANCE",
  };
  const base = {
    self, title,
    context: "The request to the insurer, what came back, how it compares with what the client accepted, and the policy record it becomes.",
    filters: [], evidence: [],
    permission: { canAssign: false, canApprove: data?.permissions.canApprove ?? false, note: null },
    degraded: [],
  };
  if (state.error !== null) {
    return { ...base, related: [], actions: [], blocks: [], status: { label: "Could not read", tone: "attention" }, state: "error", emptyState: { heading: "Issuance could not be read", body: state.error, actions: [] } };
  }
  if (state.missing) {
    return { ...base, related: [], actions: [], blocks: [], status: { label: "Not found", tone: "neutral" }, state: "empty", emptyState: { heading: "No placement with that address", body: "", actions: [] } };
  }
  if (state.loading || data === undefined) {
    return { ...base, related: [], actions: [], blocks: [], status: { label: "Reading", tone: "active" }, state: "loading", emptyState: null };
  }

  const d = data;
  const blocks: SpaceFrameBlock[] = [];
  const stage = STAGE_WORDS[d.stage];
  const work = workHeadline(d.work[0]);
  const placementRef: SpaceRef = {
    spaceKind: "placement", recordType: "placement", recordId: placementId, workflowId: null,
    path: `/placements/${placementId}`, title: d.placement.title, label: "PLACEMENT",
  };
  const clientRef: SpaceRef = { spaceKind: "client", recordType: "client", recordId: d.client.id, workflowId: null, path: `/clients/${d.client.id}`, title: d.client.name, label: "CLIENT" };
  const r = d.request;
  const doc = d.documents[0];

  blocks.push({
    id: "standing", type: "facts", label: "WHERE THIS STANDS", ...ready,
    facts: [
      { key: "Client", value: d.client.name, missing: false, evidence: [] },
      { key: "Insurer", value: d.insurer.name, missing: false, evidence: [] },
      { key: "Policy record", value: stage.label, missing: false, evidence: [] },
      { key: "Cover", value: d.cover.state === null ? d.cover.line : `${COVER_LABELS[d.cover.state as keyof typeof COVER_LABELS] ?? d.cover.state} — ${d.cover.line}`, missing: false, evidence: [] },
    ],
  });

  if (d.blockers.length > 0) {
    blocks.push({ id: "blockers", type: "missing", label: "BEFORE THIS CAN MOVE", ...ready, items: d.blockers.slice(0, 12).map((text) => ({ text: text.slice(0, 400) })) });
  }

  if (d.work.length > 0) {
    blocks.push({
      id: "work", type: "rows", label: "IN WORK", ...ready,
      rows: d.work.slice(0, 3).map((w) => {
        const h = workHeadline(w);
        /* The note carries why, what to do and what follows; the evidence needed is one click away. */
        return row(`work-${w.id}`, h.label, [w.why, `To do: ${w.action}`, `Then: ${w.after}`].join(" · "), {
          badge: w.taskStatus === "with_party" ? TASK_LABELS.with_party : TASK_LABELS[w.taskStatus], badgeTone: h.tone,
          why: `Evidence needed: ${w.evidence}`,
        });
      }),
    });
  }

  /* ---- The applied receipt: the one place the word "recorded" is earned ---------------------- */

  const a = d.application;
  if (a !== null) {
    blocks.push({
      id: "receipt", type: "note", label: null, ...ready, tone: "done",
      title: `Policy ${a.policyNumber ?? "(no number)"} ${a.targetMode === "create" ? "created" : "updated"} from the issued policy`,
      text: `Period ${day(a.periodStart)} to ${day(a.periodEnd)}. Applied by ${a.appliedByName ?? "a colleague"} on ${day(a.appliedAt)}, from the insurer's document and the check, both linked. Nothing further is open.`,
    });
    blocks.push({
      id: "links", type: "rows", label: "WHAT IT WAS WRITTEN FROM", ...ready,
      rows: [
        row("l-doc", "The insurer's policy document", doc?.filename ?? "Policy document", { related: null }),
        row("l-check", "The issued-policy check", d.check === null || d.check.materialDifferences === 0 ? "It matched what was agreed." : `${d.check.materialDifferences} ${d.check.materialDifferences === 1 ? "difference" : "differences"} from what was agreed, each resolved with evidence before applying.`),
        row("l-request", `Issuance request version ${r?.version ?? ""}`, r?.submission ? `Sent ${day(r.submission.sentAt)} to ${r.submission.recipient}` : ""),
        row("l-policy", `Policy ${a.policyNumber ?? "(no number)"}`, "The policy record this wrote, with its periods, cover and evidence.", {
          actions: [open("Open the policy", { spaceKind: "policy", recordType: "policy", recordId: a.policyId, workflowId: null, path: `/policies/${a.policyId}?period=${a.policyPeriodId}`, title: `Policy ${a.policyNumber ?? ""}`.trim(), label: "POLICY" })],
        }),
        row("l-placement", "The placement", "The client's instruction, the accepted terms and the cover confirmation.", { related: placementRef, actions: [open("Open", placementRef)] }),
      ],
    });
  }

  /* ---- The request ------------------------------------------------------------------------- */

  if (r !== null) {
    const p = r.payload;
    blocks.push({
      id: "request", type: "facts",
      label: `ISSUANCE REQUEST — VERSION ${r.version}${r.submission ? "" : r.approval ? " — APPROVED, NOT SENT" : " — DRAFT, NOT SENT"}`,
      ...ready,
      facts: [
        { key: "Class", value: p.classOfBusiness ?? "Not stated", missing: p.classOfBusiness === null, evidence: [] },
        { key: "Cover begins", value: day(p.inception), missing: p.inception === null, evidence: [] },
        { key: "Cover ends", value: p.end === null ? "Not stated" : `${day(p.end)} — ${p.endBasis}`.slice(0, 400), missing: p.end === null, evidence: [] },
        { key: "Premium", value: p.premiumAmount === null ? "As confirmed" : `${p.premiumCurrency ?? ""} ${Number(p.premiumAmount).toLocaleString("en-KE")}${p.premiumBasis ? ` (${p.premiumBasis === "gross" ? "gross" : "total payable"})` : ""}`.trim(), missing: false, evidence: [] },
        { key: "Policy number asked for", value: p.requestedPolicyNumber ?? "None — the insurer assigns it", missing: false, evidence: [] },
        { key: "Documents asked for", value: p.requiredDocuments.join(", "), missing: false, evidence: [] },
        { key: "Cover confirmation", value: p.coverConfirmationReference ?? "Recorded without a reference", missing: false, evidence: [] },
        { key: "Digest", value: `${r.sha256.slice(0, 16)}…`, missing: false, evidence: [] },
        { key: "Prepared", value: `${day(r.preparedAt)} by ${r.preparedByName ?? "a colleague"}`, missing: false, evidence: [] },
        { key: "Approved", value: r.approval === null ? "Not approved" : `${day(r.approval.approvedAt)} by ${r.approval.approvedByName ?? "a colleague"}`, missing: r.approval === null, evidence: [] },
        { key: "Sent", value: r.submission === null ? "Not sent" : `${day(r.submission.sentAt)} to ${r.submission.recipient} — ${r.submission.evidence.label}`.slice(0, 400), missing: r.submission === null, evidence: [] },
      ],
    });
    blocks.push({ id: "request-body", type: "email", label: "WHAT THE REQUEST SAYS", ...ready, ...emailOf(p.subject, p.body, d.insurer.name, r.submission !== null) });
    if (r.submission === null) {
      blocks.push({ id: "sending", type: "note", label: null, ...ready, tone: "neutral", title: "Sending from ASAP is not connected", text: d.sending.reason });
    }
  }

  /* ---- The insurer's document, as read and as reviewed ------------------------------------- */

  if (doc !== undefined) {
    const unreviewed = doc.fields.filter((f) => f.state === "proposed").length + doc.terms.filter((t) => t.state === "proposed").length;
    const canEdit = d.permissions.canPrepare ? null : "You may not review what was read from a document.";
    const locked = a !== null ? "The policy record has been written from this reading." : null;
    blocks.push({
      id: "document", type: "rows",
      label: unreviewed === 0 ? `WHAT WAS READ FROM ${doc.filename.toUpperCase()} — ALL REVIEWED`.slice(0, 120) : `WHAT WAS READ FROM THE POLICY DOCUMENT — ${unreviewed} NOT REVIEWED`,
      ...ready,
      rows: [
        ...doc.fields.slice(0, 20).map((f) => {
          const w = STATE_WORDS[f.state] ?? { label: f.state, tone: "neutral" as SpaceTone };
          const label = FIELD_WORDS[f.key] ?? f.key;
          const value = f.correctedValue ?? f.proposedValue;
          return row(`field-${f.id}`, `${label}: ${value ?? "Not read"}`, [
            f.state === "corrected" ? `Read as ${f.proposedValue ?? "nothing"}; corrected by a person` : null,
            evidenceNote(f.evidence),
          ].filter((x): x is string => x !== null).join(" · "), {
            badge: w.label, badgeTone: w.tone, region: regionOf(label, f.evidence),
            actions: f.state === "proposed" ? [act("Accept", `field-accept:${f.id}`, "resolve", locked, canEdit), act("Correct", `correct:${f.id}`, "resolve", locked, canEdit), act("Reject", `field-reject:${f.id}`, "resolve", locked, canEdit)] : [],
          });
        }),
        ...doc.terms.slice(0, 20).map((t) => {
          const w = STATE_WORDS[t.state] ?? { label: t.state, tone: "neutral" as SpaceTone };
          return row(`term-${t.id}`, `${t.label}: ${t.correctedValue ?? t.proposedValue ?? "Not read"}`, evidenceNote(t.evidence), {
            badge: w.label, badgeTone: w.tone, region: regionOf(t.label, t.evidence),
            actions: t.state === "proposed" ? [act("Accept", `term-accept:${t.id}`, "resolve", locked, canEdit), act("Reject", `term-reject:${t.id}`, "resolve", locked, canEdit)] : [],
          });
        }),
      ].slice(0, 50),
    });
  }

  /* ---- The check: every line classified, material ones resolved one by one ------------------ */

  const c = d.check;
  if (c !== null) {
    if (!c.current) {
      blocks.push({ id: "check-stale", type: "note", label: null, ...ready, tone: "attention", title: "This check is out of date", text: c.staleReason ?? "Something it compared has moved. Run it again." });
    }
    blocks.push({
      id: "check", type: "table",
      label: c.unresolved > 0 ? `THE ISSUED POLICY AGAINST WHAT WAS AGREED — ${c.unresolved} TO RESOLVE` : "THE ISSUED POLICY AGAINST WHAT WAS AGREED",
      ...ready,
      columns: [{ label: "What" }, { label: "Agreed" }, { label: "Cover confirmation" }, { label: "Issued policy" }, { label: "Result" }],
      rows: c.items.slice(0, 50).map((it) => ({
        id: it.id,
        cells: [
          { value: it.label.slice(0, 400), tone: "neutral" as SpaceTone },
          { value: it.basisValue ?? it.instructionValue ?? "—", tone: "neutral" as SpaceTone },
          { value: it.confirmationValue ?? "—", tone: "neutral" as SpaceTone },
          { value: `${it.issuedValue ?? "—"}${it.evidence?.page ? ` (p. ${it.evidence.page})` : ""}`.slice(0, 400), tone: "neutral" as SpaceTone },
          { value: it.resolution ? `${it.classificationWords} — resolved` : it.classificationWords, tone: it.resolution ? ("done" as SpaceTone) : CLASS_TONE[it.classification] },
        ],
      })),
    });
    const toResolve = c.items.filter((it) => it.material);
    if (toResolve.length > 0) {
      blocks.push({
        id: "differences", type: "rows", label: "DIFFERENCES", ...ready,
        rows: toResolve.slice(0, 20).map((it) =>
          row(`diff-${it.id}`, `${it.label}: ${it.classificationWords}`, it.resolution
            ? `${it.resolution.resolution === "client_accepted_issued_value" ? "The client accepted the issued value" : "Confirmed not to matter"} — ${it.resolution.reason} · ${it.resolution.evidence.label} · ${it.resolution.resolvedByName ?? "a colleague"}, ${day(it.resolution.resolvedAt)}`
            : [`Agreed ${it.basisValue ?? "not stated"}; issued ${it.issuedValue ?? "not stated"}`, it.calculation, evidenceNote(it.evidence)].filter((x): x is string => !!x).join(" · "), {
            badge: it.resolution ? "Resolved" : "To resolve", badgeTone: it.resolution ? "done" : "attention",
            region: regionOf(it.label, it.evidence),
            actions: it.resolution || !c.current ? [] : [act("Resolve", `resolve:${it.id}`, "resolve", null, d.permissions.canPrepare ? null : "You may not resolve an issued-policy difference.")],
          })),
      });
    }
  }

  /* ---- Forms ---------------------------------------------------------------------------------- */

  if (drafting === "submission" && r?.approval && r.submission === null) {
    blocks.push({
      id: "submission-form", type: "form", label: "RECORD THAT THE REQUEST WAS SENT", evidence: [], state: "ready", stateNote: null,
      submitLabel: "Record it as sent", busy: state.busy, actions: [act("Record it as sent", `submit-form:${r.id}`, "record_send")],
      fields: [
        { name: "method", label: "How it was sent", kind: "select", value: "recorded_manual_email", placeholder: "", required: true, hint: "Sending from ASAP is not connected, so this is how you sent it yourself.", error: null,
          options: [{ value: "recorded_manual_email", label: "By email, from my own mailbox" }, { value: "recorded_portal", label: "Uploaded to the insurer's portal" }, { value: "recorded_post", label: "By post" }, { value: "recorded_in_person", label: "Delivered in person" }] },
        { name: "recipient", label: "To whom", kind: "text", value: "", placeholder: "policy@insurer.co.ke", required: true, hint: "", error: null, options: [] },
        { name: "sentAt", label: "When", kind: "date", value: "", placeholder: "", required: true, hint: "", error: null, options: [] },
        { name: "evidenceNote", label: "What shows it was sent", kind: "textarea", value: "", placeholder: "", required: true, hint: "The time, the mailbox or portal, and any reference.", error: null, options: [] },
      ],
    });
  }
  if (drafting === "document" && r?.submission && a === null) {
    blocks.push({
      id: "document-form", type: "form", label: "RECORD THE INSURER'S POLICY DOCUMENT", evidence: [], state: "ready", stateNote: null,
      submitLabel: "Record the document", busy: state.busy, actions: [act("Record the document", "document-form", "record_evidence")],
      fields: [
        { name: "documentId", label: "Which document", kind: "select", value: d.documentOptions[0]?.id ?? "", placeholder: "", required: true, hint: d.documentOptions.length === 0 ? "No document is on this client's file yet. Upload it to the client's documents first; ASAP reads it there, on its own extractor." : "From this client's documents. ASAP reads it on its own extractor.", error: null,
          options: d.documentOptions.slice(0, 40).map((o) => ({ value: o.id, label: `${o.filename} — ${day(o.createdAt)}`.slice(0, 160) })) },
        { name: "receivedAt", label: "When it arrived", kind: "date", value: "", placeholder: "", required: true, hint: "", error: null, options: [] },
      ],
    });
  }
  if (drafting?.startsWith("correct:")) {
    const fieldId = drafting.slice("correct:".length);
    const f = doc?.fields.find((x) => x.id === fieldId);
    if (f) {
      blocks.push({
        id: "correct-form", type: "form", label: `CORRECT ${(FIELD_WORDS[f.key] ?? f.key).toUpperCase()}`, evidence: [], state: "ready", stateNote: null,
        submitLabel: "Save the correction", busy: state.busy, actions: [act("Save the correction", `correct-form:${f.id}`, "resolve")],
        fields: [{ name: "value", label: "What the document says", kind: "text", value: f.proposedValue ?? "", placeholder: "", required: true, hint: evidenceNote(f.evidence), error: null, options: [] }],
      });
    }
  }
  if (drafting?.startsWith("resolve:") && c !== null) {
    const it = c.items.find((x) => x.id === drafting.slice("resolve:".length));
    if (it) {
      blocks.push({
        id: "resolve-form", type: "form", label: `RESOLVE: ${it.label.toUpperCase()}`.slice(0, 120), evidence: [], state: "ready", stateNote: null,
        submitLabel: "Record the decision", busy: state.busy, actions: [act("Record the decision", `resolve-form:${it.id}`, "resolve")],
        fields: [
          { name: "resolution", label: "Decision", kind: "choice", value: "client_accepted_issued_value", placeholder: "", required: true, hint: "", error: null,
            options: [{ value: "client_accepted_issued_value", label: "The client accepted the issued value" }, { value: "confirmed_immaterial", label: "It does not change the cover" }] },
          { name: "reason", label: "Why", kind: "textarea", value: "", placeholder: "", required: true, hint: "", error: null, options: [] },
          { name: "resolvedAt", label: "When it was decided", kind: "date", value: "", placeholder: "", required: true, hint: "", error: null, options: [] },
          { name: "evidenceNote", label: "What shows it", kind: "textarea", value: "", placeholder: "", required: true, hint: "Who decided, when, and where it is.", error: null, options: [] },
        ],
      });
    }
  }
  if (drafting === "apply" && d.stage === "ready_to_apply") {
    blocks.push({
      id: "apply-form", type: "form", label: "WRITE THE ISSUED POLICY TO THE POLICY RECORD", evidence: [], state: "ready", stateNote: null,
      submitLabel: "Preview the change", busy: state.busy, actions: [act("Preview the change", "preview-form", "prepare")],
      fields: [
        { name: "target", label: "Target", kind: "choice", value: "", placeholder: "", required: true, hint: "ASAP never chooses this for you.", error: null,
          options: [{ value: "create", label: "Create a new policy" }, ...d.candidates.slice(0, 30).map((cd) => ({ value: `update:${cd.policyId}:${cd.periodId}`, label: `Update ${cd.policyNumber ?? "(no number)"} with ${cd.insurerName}, ${day(cd.periodStart)} to ${day(cd.periodEnd)}`.slice(0, 160) }))] },
        { name: "premiumBasis", label: "The issued premium is", kind: "choice", value: "", placeholder: "", required: true, hint: "The document does not decide this.", error: null,
          options: [{ value: "gross", label: "The gross premium" }, { value: "total_payable", label: "The total payable" }] },
      ],
    });
  }

  /* ---- The server's preview, before anything is written ------------------------------------ */

  if (preview !== null && a === null) {
    blocks.push({
      id: "preview", type: "table", label: `WHAT APPLYING WILL DO — ${preview.target.label.toUpperCase()}`.slice(0, 120), ...ready,
      columns: [{ label: "What" }, { label: "Now" }, { label: "Issued policy" }, { label: "Agreed" }, { label: "Result" }],
      rows: preview.rows.map((pr) => ({
        id: pr.field,
        cells: [
          { value: pr.label, tone: "neutral" as SpaceTone },
          { value: pr.current ?? "—", tone: "neutral" as SpaceTone },
          { value: `${pr.issued ?? "—"}${pr.evidence?.page ? ` (p. ${pr.evidence.page})` : ""}`, tone: "neutral" as SpaceTone },
          { value: pr.accepted ?? "—", tone: "neutral" as SpaceTone },
          { value: pr.status === "will_change" ? "Will change" : pr.status === "unchanged" ? "Unchanged" : (pr.note ?? "Blocked"), tone: pr.status === "blocked" ? ("attention" as SpaceTone) : pr.status === "will_change" ? ("active" as SpaceTone) : ("neutral" as SpaceTone) },
        ],
      })),
    });
    if (preview.conflicts.length + preview.blocked.length > 0) {
      blocks.push({ id: "preview-blocked", type: "missing", label: "IT CANNOT BE APPLIED YET", ...ready, items: [...preview.conflicts, ...preview.blocked].slice(0, 12).map((text) => ({ text: text.slice(0, 400) })) });
    } else {
      blocks.push({
        id: "apply-gate", type: "approval_gate", label: null, evidence: [], state: "ready", stateNote: null,
        heading: "Apply the issued policy to the policy record",
        detail: "Written once, with the policy document, the check and the request linked. If the target changes before you apply, nothing is written and you are asked to preview again.",
        blockedNote: d.permissions.canApply ? null : "You may not apply an issued policy. Someone who may approve placements must.",
        actions: [act("Apply it", "apply", "approve", null, d.permissions.canApply ? null : "You may not apply an issued policy.")],
      });
    }
  }

  /* ---- Prepared actions from Ask ------------------------------------------------------------ */

  const waiting = d.preparedActions.filter((p) => p.state === "prepared");
  if (waiting.length > 0) {
    blocks.push({
      id: "prepared", type: "rows", label: "PREPARED FOR YOU TO CONFIRM", ...ready,
      rows: waiting.slice(0, 5).map((p) => row(`prep-${p.id}`, p.changes[0] ?? "A prepared action", [...p.changes.slice(1), ...p.blockers].join(" · "), {
        badge: "Waiting for you to confirm", badgeTone: "attention",
        actions: [act("Confirm", `confirm:${p.id}`, "approve", p.blockers.length > 0 ? p.blockers[0]! : null, p.permitted ? null : "You may not do this."), act("Discard", `discard:${p.id}`, "exception")],
      })),
    });
  }

  /* ---- What happens next ------------------------------------------------------------------- */

  const actions: SpaceFrameAction[] = [];
  const perm = d.permissions;
  if (d.stage === "ready" || d.stage === "approval_required") {
    actions.push(act(r === null ? "Prepare the issuance request" : "Prepare a new version", "prepare", "prepare", null, perm.canPrepare ? null : "You may not prepare an issuance request."));
  }
  if (d.stage === "approval_required" && r !== null) actions.push(act(`Approve version ${r.version}`, `approve:${r.id}`, "approve", null, perm.canApprove ? null : "You may not approve an issuance request."));
  if (d.stage === "submission_required" && r !== null) actions.push(act("Record that it was sent", "submit", "record_send", null, perm.canSubmit ? null : "You may not record that it was sent."));
  if (d.stage === "with_insurer" || d.stage === "review_required") actions.push(act("Record the insurer's policy document", "document", "record_evidence", null, perm.canPrepare ? null : "You may not record the insurer's document."));
  if (d.stage === "review_required" && doc !== undefined) {
    actions.push(act("Check it against what was agreed", "check", "prepare", doc.reviewComplete ? null : "Review every value read from the document first.", perm.canPrepare ? null : "You may not run the check."));
  }
  if (d.stage === "ready_to_apply") actions.push(act("Preview writing it to the policy record", "apply-open", "prepare", null, perm.canApply ? null : "You may not apply an issued policy."));

  blocks.push({
    id: "next", type: "rows", label: "WHAT HAPPENS NEXT", ...ready,
    rows: [
      row("next", d.nextAction, work.label, { badge: d.work[0] === undefined ? TASK_LABELS.done : d.work[0].taskStatus === "with_party" ? TASK_LABELS.with_party : TASK_LABELS[d.work[0].taskStatus], badgeTone: work.tone, actions: actions.slice(0, 4) }),
      row("placement", "The placement", "The client's instruction, what they accepted, the request and the cover confirmation.", { related: placementRef, actions: [open("Open", placementRef)] }),
    ],
  });

  /* ---- History ------------------------------------------------------------------------------ */

  const events: { id: string; at: string; text: string; tone: SpaceTone }[] = [];
  for (const h of d.requestHistory) events.push({ id: `h-${h.version}`, at: h.preparedAt, text: `Request version ${h.version} prepared${h.approvedAt ? ", approved" : ""}; superseded: ${h.supersededReason ?? ""}`, tone: "neutral" });
  if (r) events.push({ id: "r", at: r.preparedAt, text: `Request version ${r.version} prepared.`, tone: "neutral" });
  if (r?.approval) events.push({ id: "a", at: r.approval.approvedAt, text: `Version ${r.version} approved by ${r.approval.approvedByName ?? "a colleague"}.`, tone: "active" });
  if (r?.submission) events.push({ id: "s", at: r.submission.sentAt, text: `Sent to ${d.insurer.name}, recorded by ${r.submission.recordedByName ?? "a colleague"}.`, tone: "active" });
  for (const x of d.documents) events.push({ id: `d-${x.id}`, at: x.receivedAt, text: `${d.insurer.name}'s policy document received: ${x.filename}.`, tone: "active" });
  if (c) events.push({ id: "c", at: c.comparedAt, text: c.materialDifferences === 0 ? "Checked: it matches what was agreed." : `Checked: ${c.materialDifferences} ${c.materialDifferences === 1 ? "difference" : "differences"} from what was agreed.`, tone: c.materialDifferences === 0 ? "done" : "attention" });
  if (a) events.push({ id: "p", at: a.appliedAt, text: `Written to the policy record by ${a.appliedByName ?? "a colleague"}.`, tone: "done" });
  if (events.length > 0) {
    blocks.push({
      id: "timeline", type: "timeline", label: "WHAT HAS HAPPENED", ...ready,
      events: events.sort((x, y) => x.at.localeCompare(y.at)).slice(-30).map((e) => ({ id: e.id, when: day(e.at), text: e.text.slice(0, 400), tone: e.tone, link: null, related: null })),
    });
  }

  return {
    ...base,
    related: [placementRef, clientRef],
    actions: [],
    /* The status slot is short: the party and the date, and what the work is only when it fits. */
    status: work.label.startsWith(TASK_LABELS.done) ? stage : { ...work, label: work.label.length > 60 ? work.label.split(" — ")[0]!.slice(0, 60) : work.label },
    state: "ready",
    emptyState: null,
    blocks: blocks.slice(0, 24),
  };
}

function emailOf(subject: string, body: string, insurer: string, sent: boolean) {
  return {
    headLabel: sent ? "Sent — recorded by a person" : "Not sent — a draft for you to send",
    headMeta: `To ${insurer}`.slice(0, 160),
    tone: (sent ? "done" : "neutral") as SpaceTone,
    to: insurer.slice(0, 300),
    subject: subject.slice(0, 400),
    body: body.slice(0, 8000),
    attachments: [],
  };
}
