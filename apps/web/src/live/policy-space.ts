import {
  TASK_LABELS,
  type PolicyEvidence,
  type PolicySpaceResponse,
  type SpaceFrame,
  type SpaceFrameAction,
  type SpaceFrameBlock,
  type SpaceRef,
  type SpaceTone,
  type ValueSource,
} from "@asap/schema";

/**
 * One policy as a Space (4C-1), composed the way the approved prototype composes it: the facts
 * grid (insured, insurer, period, premium, cover proof), what is covered, endorsements, money,
 * and the source documents — then the periods, the Work, the timeline and what to open next.
 *
 * Nothing here decides anything. Cover state, the period being read, each value's source and every
 * available action come from `GET /policies/:id/space`; this only lays them out. The cover line
 * and the Work headline are separate slots, and a premium never carries a payment word.
 */

export const SOURCE_WORDS: Record<ValueSource, { label: string; tone: SpaceTone }> = {
  confirmed: { label: "Confirmed by insurer", tone: "done" },
  extracted_accepted: { label: "Read and accepted", tone: "done" },
  corrected: { label: "Corrected by a person", tone: "active" },
  manually_recorded: { label: "Recorded by hand", tone: "neutral" },
  missing: { label: "Missing", tone: "attention" },
  conflicting: { label: "Conflicting", tone: "attention" },
  unverified: { label: "Not verified", tone: "waiting" },
};

/* The fixed status colours: green is active, gold is waiting, grey is done or over, red needs review. */
const COVER_TONE: Record<string, SpaceTone> = { active: "active", confirmed: "waiting", expired: "neutral", cancelled: "attention", requested: "waiting", submitted: "waiting" };

const TERM_WORDS: Record<string, string> = {
  excess: "Excess", limit: "Limit", condition: "Condition", exclusion: "Exclusion", benefit: "Benefit",
  levy: "Levy", tax: "Tax", subjectivity: "Subject to", other: "Other",
};

function day(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
const short = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");

type Row = Extract<SpaceFrameBlock, { type: "rows" }>["rows"][number];
const ready = { evidence: [], actions: [], state: "ready" as const, stateNote: null };

function row(id: string, title: string, note: string, extra: Partial<Pick<Row, "badge" | "badgeTone" | "why" | "actions" | "related" | "region">> = {}): Row {
  return { id, title: title.slice(0, 300), note: note.slice(0, 400), badge: extra.badge ?? null, badgeTone: extra.badgeTone ?? "neutral", why: extra.why ?? null, related: extra.related ?? null, region: extra.region ?? null, actions: extra.actions ?? [], evidence: [] };
}
function ref(kind: SpaceRef["spaceKind"], recordType: string, id: string | null, path: string, title: string, label: string): SpaceRef {
  return { spaceKind: kind, recordType, recordId: id, workflowId: null, path, title: title.slice(0, 300), label };
}
function open(label: string, to: SpaceRef): SpaceFrameAction {
  return { verb: "open", label, stepId: null, to, disabledReason: null, notPermittedReason: null };
}

/** Evidence as an openable row part: the source, and its region drawn in place when one was recorded. */
function evidenceParts(e: PolicyEvidence | null, what: string): { region: Row["region"]; actions: SpaceFrameAction[]; note: string } {
  if (e === null) return { region: null, actions: [], note: "" };
  const region = e.page !== null && e.region !== null ? { what: what.slice(0, 200), pageNumber: e.page, pageWidth: null, pageHeight: null, rect: e.region, fileUrl: null } : null;
  const actions = e.path ? [open("Open source", ref("document", "document", e.documentId, e.path, e.label || what, "SOURCE"))] : [];
  const by = [e.recordedByName, e.recordedAt ? day(e.recordedAt) : null].filter(Boolean).join(", ");
  return { region, actions, note: `${e.label}${by ? ` — ${by}` : ""}` };
}

export function workHeadline(w: PolicySpaceResponse["work"][number]): { label: string; tone: SpaceTone } {
  if (w.taskStatus === "with_party") return { label: `${TASK_LABELS.with_party} ${w.taskParty ?? "the other party"}${w.taskSince ? ` since ${short(w.taskSince)}` : ""}`, tone: "waiting" };
  if (w.taskStatus === "needs_you") return { label: TASK_LABELS.needs_you, tone: "attention" };
  if (w.taskStatus === "in_progress") return { label: TASK_LABELS.in_progress, tone: "active" };
  return { label: TASK_LABELS.done, tone: "neutral" };
}

export function policySpace(
  data: PolicySpaceResponse | undefined,
  state: { loading: boolean; error: string | null; missing: boolean; refused: string | null; busy: boolean },
  policyId: string,
): SpaceFrame {
  const title = data?.title ?? "Policy";
  const period = data?.periods.find((p) => p.id === data.selectedPeriodId) ?? null;
  const self: SpaceRef = {
    spaceKind: "policy", recordType: "policy", recordId: policyId, workflowId: period?.id ?? null,
    path: `/policies/${policyId}${period ? `?period=${period.id}` : ""}`, title, label: "POLICY",
  };
  const base = {
    self, title,
    context: "Who is insured, by whom, for what, the periods of cover and the evidence behind each, and what is open on it.",
    filters: [], evidence: [], permission: { canAssign: false, canApprove: false, note: null }, degraded: [],
  };
  if (state.refused !== null) return { ...base, related: [], actions: [], blocks: [], status: { label: "Not permitted", tone: "attention" }, state: "empty", emptyState: { heading: "You may not view this policy", body: state.refused, actions: [] } };
  if (state.error !== null) return { ...base, related: [], actions: [], blocks: [], status: { label: "Could not read", tone: "attention" }, state: "error", emptyState: { heading: "This policy could not be read", body: state.error, actions: [] } };
  if (state.missing) return { ...base, related: [], actions: [], blocks: [], status: { label: "Not found", tone: "neutral" }, state: "empty", emptyState: { heading: "No policy with that address", body: "It may be in another brokerage, or it was never recorded.", actions: [] } };
  if (state.loading || data === undefined) return { ...base, related: [], actions: [], blocks: [], status: { label: "Reading", tone: "active" }, state: "loading", emptyState: null };

  const d = data;
  const blocks: SpaceFrameBlock[] = [];
  const clientRef = ref("client", "client", d.client.id, `/clients/${d.client.id}`, d.client.name, "CLIENT");
  const fact = (key: string) => d.facts.find((f) => f.key === key);

  /* ---- Conflicts first: nothing below is read as settled while periods overlap ---------------- */

  for (const c of d.conflicts) {
    blocks.push({ id: `conflict-${c.periodIds.join("-")}`.slice(0, 80), type: "note", label: null, ...ready, tone: "attention", title: "These periods overlap", text: c.message });
  }

  /* ---- The facts grid, as the prototype has it ------------------------------------------------ */

  const premium = fact("premium");
  blocks.push({
    id: "standing", type: "facts", label: period ? `PERIOD ${day(period.start).toUpperCase()} TO ${day(period.end).toUpperCase()}` : "NO PERIOD CHOSEN", ...ready,
    facts: [
      { key: "Insured", value: d.client.name, missing: false, evidence: [] },
      { key: "Insurer", value: d.insurer.name, missing: false, evidence: [] },
      { key: "Policy number", value: fact("policy_number")?.value ?? "Not recorded", missing: fact("policy_number")?.value == null, evidence: [] },
      { key: "Period", value: period ? `${day(period.start)} – ${day(period.end)}` : "Choose a period below", missing: period === null, evidence: [] },
      { key: "Premium", value: premium?.value ? `${premium.value} — recorded` : "Not recorded", missing: !premium?.value, evidence: [] },
      {
        key: "Cover proof",
        value: (period?.cover.verified ?? d.cover.verified) ? (period?.cover.evidence[0]?.label ?? d.cover.evidence[0]?.label ?? "Evidence linked") : "No confirmation — not Active cover",
        missing: !(period?.cover.verified ?? d.cover.verified), evidence: [],
      },
    ],
  });

  /* The cover line, with its reason, on its own. */
  const coverFor = period?.cover ?? d.cover;
  blocks.push({
    id: "cover", type: "note", label: null, ...ready,
    tone: coverFor.state === null ? "waiting" : (COVER_TONE[coverFor.state] ?? "neutral"),
    title: period && period.id !== d.selectedPeriodId ? coverFor.label : coverFor.label,
    text: `${coverFor.reason}${period && d.selection === "requested" && d.cover.state !== coverFor.state ? ` The policy as a whole today: ${d.cover.label}.` : ""}`.slice(0, 1200),
  });

  if (d.gaps.length > 0) {
    blocks.push({ id: "gaps", type: "missing", label: "NOT KNOWN", ...ready, items: d.gaps.slice(0, 12).map((text) => ({ text: text.slice(0, 400) })) });
  }

  /* ---- Every value, with where it came from ---------------------------------------------------- */

  blocks.push({
    id: "values", type: "rows", label: "WHAT IS RECORDED, AND WHERE IT CAME FROM", ...ready,
    rows: d.facts.map((f) => {
      const e = evidenceParts(f.evidence, f.label);
      const w = SOURCE_WORDS[f.source];
      return row(`fact-${f.key}`, `${f.label}: ${f.value ?? "Not recorded"}`, [e.note, f.note].filter(Boolean).join(" · ") || w.label, { badge: w.label, badgeTone: w.tone, region: e.region, actions: e.actions });
    }),
  });

  /* ---- What is covered: agreed, confirmed, printed, final --------------------------------------- */

  if (d.terms.length > 0) {
    blocks.push({
      id: "terms", type: "table", label: "WHAT IS COVERED", ...ready,
      columns: [{ label: "Term" }, { label: "Agreed" }, { label: "Insurer confirmed" }, { label: "Issued policy" }, { label: "On the policy record" }],
      rows: d.terms.slice(0, 50).map((t, i) => ({
        id: `term-${i}`,
        cells: [
          { value: `${TERM_WORDS[t.termType] ?? t.termType} — ${t.label}`.slice(0, 400), tone: "neutral" as SpaceTone },
          { value: t.agreed ?? "—", tone: "neutral" as SpaceTone },
          { value: t.confirmed ?? "—", tone: "neutral" as SpaceTone },
          { value: `${t.issued ?? "—"}${t.evidence?.page ? ` (p. ${t.evidence.page})` : ""}`.slice(0, 400), tone: "neutral" as SpaceTone },
          { value: t.final === null ? "Missing" : `${t.final}${t.source === "corrected" ? " — corrected" : t.source === "conflicting" ? " — conflicting" : ""}`.slice(0, 400), tone: (t.final === null || t.source === "conflicting" ? "attention" : t.source === "corrected" ? "active" : "done") as SpaceTone },
        ],
      })),
    });
    const withEvidence = d.terms.filter((t) => t.evidence !== null);
    if (withEvidence.length > 0) {
      blocks.push({
        id: "term-sources", type: "rows", label: "WHERE EACH TERM WAS READ", ...ready,
        rows: withEvidence.slice(0, 20).map((t, i) => {
          const e = evidenceParts(t.evidence, t.label);
          return row(`term-src-${i}`, `${t.label}: ${t.final ?? "—"}`, e.note, { badge: SOURCE_WORDS[t.source].label, badgeTone: SOURCE_WORDS[t.source].tone, region: e.region, actions: e.actions });
        }),
      });
    }
  } else {
    blocks.push({ id: "terms-missing", type: "note", label: "WHAT IS COVERED", ...ready, tone: "waiting", title: "No coverage terms on file", text: "No limit, excess, exclusion or condition is recorded for this policy. Nothing is assumed from another period or policy." });
  }

  if (d.differences.length > 0) {
    blocks.push({
      id: "differences", type: "rows", label: "WHERE THE PLACEMENT, THE CONFIRMATION AND THE ISSUED POLICY DIFFERED", ...ready,
      rows: d.differences.slice(0, 20).map((x, i) => row(`diff-${i}`, `${x.label}: ${x.words}`, [`Agreed ${x.agreed ?? "not stated"}`, `confirmed ${x.confirmed ?? "not stated"}`, `issued ${x.issued ?? "not stated"}`, x.resolution].filter(Boolean).join(" · "), {
        badge: x.resolved ? "Resolved" : "Unresolved", badgeTone: x.resolved ? "done" : "attention",
      })),
    });
  }

  if (d.clientConditions.length > 0) {
    blocks.push({
      id: "conditions", type: "rows", label: "THE CLIENT'S CONDITIONS", ...ready,
      rows: d.clientConditions.slice(0, 20).map((c, i) => row(`cond-${i}`, c.text, c.evidence ?? "", { badge: c.state === "unresolved" ? "Unresolved" : c.state.replace(/_/g, " ").replace(/^./, (m) => m.toUpperCase()), badgeTone: c.state === "unresolved" ? "attention" : "done" })),
    });
  }

  /* ---- Endorsements and money: stated honestly, not built here --------------------------------- */

  blocks.push({
    id: "endorsements", type: "rows", label: "ENDORSEMENTS", ...ready,
    rows: [row("endorsements-none", "No endorsement applied to this period", "The schedule is as issued. Endorsements are recorded in a later stage.", { badge: "v1" })],
  });
  blocks.push({ id: "money", type: "note", label: "MONEY", ...ready, tone: "neutral", title: "Payment is not known here", text: d.money.statement });

  if (d.documents.length > 0) {
    blocks.push({
      id: "documents", type: "rows", label: "SOURCE DOCUMENTS", ...ready,
      rows: d.documents.slice(0, 20).map((doc) => row(`doc-${doc.id}`, doc.filename, `${doc.role} · ${doc.extractionState === "extracted" ? "read" : doc.extractionState.replace(/_/g, " ")}`, {
        badge: "Source", actions: [open("Open", ref("document", "document", doc.id, doc.path, doc.filename, "DOCUMENT"))],
      })),
    });
  }

  /* ---- Periods: every one, with which is being read -------------------------------------------- */

  blocks.push({
    id: "periods", type: "rows", label: d.periods.length === 1 ? "PERIOD OF COVER" : `PERIODS OF COVER — ${d.periods.length}`, ...ready,
    rows: [...d.periods].reverse().map((p) => row(
      `period-${p.id}`,
      `${day(p.start)} – ${day(p.end)}${p.id === d.selectedPeriodId ? " · reading this period" : ""}`,
      [p.cover.label, p.when === "current" ? "Covers today" : p.when === "future" ? "Has not started" : "Ended", p.origin === "issuance" ? "From the issued policy" : p.origin === "document" ? "From a reviewed document" : "Recorded by hand", p.overlapsWith.length > 0 ? `Overlaps ${p.overlapsWith.length} other period${p.overlapsWith.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · "),
      {
        badge: p.overlapsWith.length > 0 ? "Overlap" : p.cover.state === null ? "Not verified" : p.cover.label, badgeTone: p.overlapsWith.length > 0 ? "attention" : p.cover.state === null ? "waiting" : (COVER_TONE[p.cover.state] ?? "neutral"),
        actions: p.id === d.selectedPeriodId ? [] : [open("Read this period", ref("policy", "policy", policyId, `/policies/${policyId}?period=${p.id}`, title, "POLICY"))],
      },
    )).slice(0, 50),
  });

  /* ---- Work ---------------------------------------------------------------------------------- */

  if (d.work.length > 0) {
    blocks.push({
      id: "work", type: "rows", label: "IN WORK", ...ready,
      rows: d.work.slice(0, 10).map((w) => {
        const h = workHeadline(w);
        return row(`work-${w.id}`, `${h.label} — ${w.title}`, [w.reason, w.requiredAction ? `To do: ${w.requiredAction}` : null, w.outcomeAfter ? `Then: ${w.outcomeAfter}` : null].filter(Boolean).join(" · "), {
          badge: w.taskStatus === "with_party" ? TASK_LABELS.with_party : TASK_LABELS[w.taskStatus], badgeTone: h.tone,
          why: w.evidenceNeeded ? `Evidence needed: ${w.evidenceNeeded}` : null,
          actions: [open("Open", ref("work_item", "work_item", w.id, w.path, w.title, "WORK"))],
        });
      }),
    });
  }

  /* ---- Prepared by Ask, waiting for the person --------------------------------------------------- */

  const waiting = d.preparedActions.filter((p) => p.state === "prepared");
  if (waiting.length > 0) {
    blocks.push({
      id: "prepared", type: "rows", label: "PREPARED FOR YOU TO CONFIRM", ...ready,
      rows: waiting.slice(0, 5).map((p) => row(`prep-${p.id}`, p.changes[0] ?? "A prepared action", [...p.changes.slice(1), ...p.blockers].join(" · "), {
        badge: "Waiting for you to confirm", badgeTone: "attention",
        actions: [
          { verb: "approve", label: "Confirm", stepId: `confirm:${p.id}`, to: null, disabledReason: null, notPermittedReason: p.permitted ? null : "You may not do this." },
          { verb: "exception", label: "Discard", stepId: `discard:${p.id}`, to: null, disabledReason: null, notPermittedReason: null },
        ],
      })),
    });
  }

  /* ---- What to do, and what to open next ------------------------------------------------------ */

  const actionRows = d.actions.map((a) => {
    const act: SpaceFrameAction = a.key === "start_renewal" && a.path === null
      ? { verb: "prepare", label: a.label, stepId: "start-renewal", to: null, disabledReason: null, notPermittedReason: a.available ? null : a.reason }
      : a.path !== null
        ? { ...open(a.label, ref(a.key === "open_client" ? "client" : a.key.startsWith("open_") ? "placement" : "route", a.key, null, a.path, a.label, "OPEN")), disabledReason: a.available ? null : a.reason }
        : { verb: "prepare", label: a.label, stepId: `unavailable:${a.key}`, to: null, disabledReason: a.reason ?? "Not available.", notPermittedReason: null };
    return act;
  });
  blocks.push({
    id: "next", type: "rows", label: "WHAT YOU CAN DO", ...ready,
    rows: [
      row("act-work", "Start or report", "Each opens its own form or work item. A claim or a change needs the facts from you before anything is recorded.", { actions: actionRows.filter((_, i) => ["start_renewal", "report_claim", "request_endorsement", "open_servicing"].includes(d.actions[i]!.key)) }),
      row("act-open", "Open", "The client, the placement this policy came from, and its documents.", { actions: actionRows.filter((_, i) => ["open_client", "open_placement", "open_issuance", "review_documents"].includes(d.actions[i]!.key)) }),
    ],
  });

  if (d.timeline.length > 0) {
    blocks.push({
      id: "timeline", type: "timeline", label: "WHAT HAS HAPPENED", ...ready,
      events: d.timeline.slice(-40).map((e) => ({ id: e.id.slice(0, 80), when: day(e.at), text: e.text, tone: e.tone, link: e.path, related: null })),
    });
  }

  const related: SpaceRef[] = [clientRef, ...d.related.filter((r) => r.kind !== "client" && r.kind !== "document").slice(0, 8).map((r) => ref(r.kind === "claim" || r.kind === "endorsement" || r.kind === "renewal" ? "work_item" : "placement", r.kind, r.id, r.path, r.title, r.kind.toUpperCase()))];

  const workTop = d.work[0];
  return {
    ...base,
    related: related.filter((r, i, a) => a.findIndex((x) => x.path === r.path) === i),
    actions: [],
    status: workTop ? workHeadline(workTop) : { label: d.cover.label.slice(0, 60), tone: d.cover.state === null ? "waiting" : (COVER_TONE[d.cover.state] ?? "neutral") },
    state: "ready",
    emptyState: null,
    blocks: blocks.slice(0, 24),
  };
}
