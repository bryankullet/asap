import { createHash } from "node:crypto";
import { LIVING_REGISTRY, type LivingBlock, type LivingSurface, type WorkspaceFocus } from "@asap/schema";
import type { WorkspaceVocabulary } from "./ask-workspace.js";
import { changes, consequences, obligations, progressOpportunities } from "./renewal.js";
import type { RenewalLivingFacts } from "./facts.js";
import type { ServicingFacts } from "./servicing.js";

/**
 * Recomposing a workspace around a request (D-165). The answer is built from the same facts the
 * workspace shows — revisions, quotes, blockers, evidence, obligations — so it can say nothing the
 * records do not. The blocks it concerns move forward and are marked; nothing else changes. When
 * the records hold nothing for the request, the answer says so (abstention), never a blank.
 */

type Item = { label: string; detail: string | null; tone: "green" | "gold" | "red" | "grey"; ref: Record<string, string> | null };
type Answer = { understood: string; items: Item[]; empty: string | null; emphasis: string[] };
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const matches = (hay: string, target: string | null) => !target || hay.toLowerCase().includes(target.toLowerCase().replace(/\.(pdf|docx?)$/i, "").replace(/s$/, ""));

/** The names a renewal's requests may use: insurers that answered, their terms, the documents behind them. */
export function renewalVocabulary(f: RenewalLivingFacts): WorkspaceVocabulary {
  const ins = (f.opportunity?.insurers ?? []).filter((i) => !i.removedAt);
  return {
    insurers: ins.map((i) => ({ id: i.response ? i.id : null, name: i.insurerName })),
    terms: [...new Set(ins.flatMap((i) => (i.response?.terms ?? []).map((t) => t.label)))].slice(0, 40),
    documents: [...new Set([...ins.map((i) => i.response?.source?.label).filter((x): x is string => !!x), ...(f.issuance?.documents ?? []).map((d) => d.filename)])].slice(0, 40),
  };
}
export function servicingVocabulary(f: ServicingFacts): WorkspaceVocabulary {
  return {
    insurers: f.policy?.insurer ? [{ id: null, name: f.policy.insurer }] : [],
    terms: (f.endorsement?.endorsement.items ?? []).map((i) => i.label).slice(0, 40),
    documents: (f.claim?.documents ?? []).map((d) => d.label).slice(0, 40),
  };
}

export function renewalAnswer(f: RenewalLivingFacts, focus: WorkspaceFocus, now: Date): Answer {
  const t = focus.target;
  const quoteRef = f.opportunity ? { ws: "quote", opportunityId: f.opportunity.opportunity.id } : null;
  switch (focus.intent) {
    case "compare_revisions": {
      const c = changes(f).filter((x) => matches(x.subject, t));
      return { understood: t ? `The revised terms from ${t}, beside the earlier ones` : "The revised terms, beside the earlier ones", emphasis: ["changes", "quotes"],
        items: c.map((x) => ({ label: `${x.subject} · ${x.field}`, detail: `${x.earlier ?? "Not recorded"} → ${x.revised ?? "Not recorded"} (revision ${x.revision})`, tone: "gold" as const, ref: x.documentId ? { ws: "document", documentId: x.documentId } : null })),
        empty: t ? `No revised answer from ${t} is on file.` : "No insurer has revised an answer on file." };
    }
    case "compare_quotes": {
      const ins = (f.opportunity?.insurers ?? []).filter((i) => !i.removedAt && matches(i.insurerName, t));
      return { understood: "The insurers' answers side by side", emphasis: ["quotes", "explore"],
        items: ins.map((i) => ({ label: i.insurerName, detail: i.response ? (i.response.premiumAmount ? `${i.response.premiumCurrency ?? ""} ${Number(i.response.premiumAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`.trim() + (i.response.validUntil ? ` · valid until ${i.response.validUntil}` : "") : i.response.outcome === "declined" ? "Declined" : "No premium on file") : "No answer yet", tone: i.response ? "green" as const : "gold" as const, ref: quoteRef })),
        empty: "No insurer has been approached on this renewal." };
    }
    case "blockers": {
      const items: Item[] = [];
      for (const o of progressOpportunities(f)) for (const b of o.blockedBy) items.push({ label: cut(b, 200), detail: o.title, tone: "red", ref: null });
      for (const b of f.run?.operational.blockers ?? []) if (b.blocking) items.push({ label: cut(b.label, 200), detail: b.fix, tone: "red", ref: f.run ? { ws: "renewal", runId: f.run.id } : null });
      if (f.run?.state === "exception") items.push({ label: cut(f.run.exception?.message ?? "ASAP stopped", 200), detail: f.run.exception?.needs ?? null, tone: "red", ref: null });
      for (const c of consequences(f, now).filter((x) => x.certainty === "missing")) items.push({ label: cut(c.text, 200), detail: "Missing from the records", tone: "gold", ref: null });
      return { understood: "What is blocking this renewal", emphasis: ["next", "consequences", "obligations"], items: items.slice(0, 12), empty: "Nothing on file is blocking this renewal right now." };
    }
    case "evidence": {
      const ev: Item[] = [];
      for (const i of f.opportunity?.insurers ?? []) {
        if (i.response?.source && matches(`${i.insurerName} ${i.response.source.label}`, t)) ev.push({ label: `${i.insurerName}'s answer`, detail: i.response.source.label, tone: "green", ref: i.response.source.kind === "document" && i.response.source.id ? { ws: "document", documentId: i.response.source.id } : null });
        for (const term of i.response?.terms ?? []) if (matches(term.label, t) && t) ev.push({ label: `${i.insurerName} — ${term.label}`, detail: term.evidence ? term.evidence.label : "No source is linked to this term", tone: term.evidence ? "green" : "gold", ref: term.evidence?.kind === "document" && term.evidence.id ? { ws: "document", documentId: term.evidence.id } : null });
      }
      for (const d of f.issuance?.documents ?? []) if (matches(d.filename, t)) ev.push({ label: "Issued policy document", detail: d.filename, tone: "green", ref: { ws: "document", documentId: d.documentId } });
      return { understood: t ? `The evidence behind “${t}”` : "The evidence behind this renewal", emphasis: ["evidence", "quotes"], items: ev.slice(0, 12), empty: t ? `No document on file is linked to “${t}”. Nothing is shown in its place.` : "No document is linked to this renewal yet." };
    }
    case "obligations":
      return { understood: "Who holds the next step", emphasis: ["obligations"], items: obligations(f).map((o) => ({ label: o.kind === "asap" ? "ASAP is handling" : `With ${o.party}`, detail: o.what, tone: o.kind === "outside" ? "gold" as const : "green" as const, ref: null })), empty: "Nobody holds an open step on this renewal." };
    case "consequences":
      return { understood: "What this means", emphasis: ["consequences", "cover"], items: consequences(f, now).map((c) => ({ label: c.certainty === "confirmed" ? "Confirmed" : c.certainty === "potential" ? "Potential" : "Unknown", detail: c.text, tone: c.certainty === "confirmed" ? "red" as const : c.certainty === "potential" ? "gold" as const : "grey" as const, ref: null })), empty: "Nothing on file changes what this renewal means right now." };
    case "messages": {
      const m = (f.run?.communications ?? []).filter((c) => c.state !== "superseded");
      return { understood: "The messages for this renewal", emphasis: ["messages", "approval-run"], items: m.map((c) => ({ label: c.audience === "client" ? `Letter to ${c.partyName}` : `Terms request to ${c.partyName}`, detail: c.state === "delivered" || c.state === "sent" ? `Sent${c.deliveryReference ? ` · ${c.deliveryReference}` : ""}` : c.state === "approved" ? "Approved — not sent yet" : "Prepared — waiting for approval", tone: c.state === "delivered" || c.state === "sent" ? "green" as const : "gold" as const, ref: null })), empty: "No message has been prepared for this renewal." };
    }
    case "history":
      return { understood: "What happened before", emphasis: ["memory", "recent"], items: f.memory.map((p) => ({ label: `${p.periodStart} – ${p.periodEnd}`, detail: `${p.insurer}${p.premiumAmount ? ` · ${p.premiumCurrency ?? ""} ${Number(p.premiumAmount).toLocaleString("en-GB", { minimumFractionDigits: 2 })}` : ""}`, tone: "grey" as const, ref: null })), empty: "No earlier period of this cover is on file." };
    case "next_steps":
      return { understood: "What moves this forward", emphasis: ["next", "approval-run", "approval-placement", "approval-issuance"], items: progressOpportunities(f).map((o) => ({ label: cut(o.title, 200), detail: cut(o.why, 500), tone: o.tone, ref: null })), empty: "Nothing needs a person on this renewal right now." };
    default:
      return { understood: "The whole workspace", emphasis: [], items: [], empty: null };
  }
}

export function servicingAnswer(f: ServicingFacts, focus: WorkspaceFocus): Answer {
  const t = focus.target;
  const isClaim = Boolean(f.claim);
  const noun = isClaim ? "claim" : "policy change";
  const run = f.run;
  switch (focus.intent) {
    case "blockers": {
      const items: Item[] = [];
      if (run?.state === "exception") items.push({ label: cut(run.exception?.message ?? "ASAP stopped", 200), detail: run.exception?.needs ?? null, tone: "red", ref: null });
      for (const b of run?.operational.blockers ?? []) if (b.blocking) items.push({ label: cut(b.label, 200), detail: b.fix, tone: "red", ref: null });
      for (const d of f.claim?.documents ?? []) if (!d.received_at) items.push({ label: `${d.label} — not received`, detail: `With ${d.holder}${d.requested_at ? ` since ${d.requested_at.slice(0, 10)}` : ""}`, tone: "gold", ref: null });
      if (f.claim && !f.claim.clock.started) items.push({ label: "The notice clock is not set", detail: f.claim.clock.reason, tone: "gold", ref: null });
      if (f.claim && !f.claim.claim.policy_period_id) items.push({ label: "No policy period is matched to the incident date", detail: null, tone: "gold", ref: null });
      for (const i of f.endorsement?.endorsement.items ?? []) if (i.decision === "pending") items.push({ label: `${i.label} — waiting for the insurer's written decision`, detail: null, tone: "gold", ref: null });
      for (const m of f.endorsement?.missing ?? []) items.push({ label: cut(m, 200), detail: "Missing from the request", tone: "gold", ref: null });
      return { understood: `What is blocking this ${noun}`, emphasis: ["next", isClaim ? "documents" : "items", "consequences", "obligations"], items: items.slice(0, 12), empty: `Nothing on file is blocking this ${noun} right now.` };
    }
    case "evidence": {
      const docs = (f.claim?.documents ?? []).filter((d) => matches(d.label, t));
      const items: Item[] = docs.map((d) => ({ label: d.label, detail: d.received_at ? `Received${d.reference ? ` · ${d.reference}` : ""}` : `Not received — with ${d.holder}`, tone: d.received_at ? "green" as const : "gold" as const, ref: null }));
      for (const i of (f.endorsement?.endorsement.items ?? []).filter((x) => matches(x.label, t))) items.push({ label: i.label, detail: i.decision === "pending" ? "No written decision yet" : `Decided ${i.decision}${f.endorsement?.endorsement.response_reference ? ` · ${f.endorsement.endorsement.response_reference}` : ""}`, tone: i.decision === "pending" ? "gold" : "green", ref: null });
      return { understood: t ? `The evidence for “${t}”` : `The evidence on this ${noun}`, emphasis: [isClaim ? "documents" : "items", "settlement"], items: items.slice(0, 12), empty: t ? `Nothing on file is linked to “${t}”. Nothing is shown in its place.` : `No document is on file for this ${noun} yet.` };
    }
    case "obligations": {
      const items: Item[] = [];
      if (run?.operational.waitingFor) items.push({ label: `With ${run.operational.waitingFor.party}`, detail: run.operational.currentWork.title, tone: "gold", ref: null });
      for (const d of f.claim?.documents ?? []) if (!d.received_at) items.push({ label: `With ${d.holder}`, detail: d.label, tone: "gold", ref: null });
      for (const i of f.endorsement?.endorsement.items ?? []) if (i.decision === "pending") items.push({ label: "With the insurer", detail: i.label, tone: "gold", ref: null });
      return { understood: "Who holds the next step", emphasis: ["obligations", isClaim ? "documents" : "items"], items: items.slice(0, 12), empty: `Nobody outside holds a step on this ${noun}.` };
    }
    case "consequences":
      return { understood: "What this means", emphasis: ["consequences", "settlement"], items: [], empty: null };
    case "history":
      return { understood: "What happened before", emphasis: ["recent", "settlement"], items: (f.claim?.notes ?? []).slice(0, 10).map((n) => ({ label: n.kind === "call_note" ? `Call with ${n.spoke_with ?? "someone"}` : "Note", detail: cut(n.body, 300), tone: "grey" as const, ref: null })), empty: `No notes are on this ${noun}.` };
    case "next_steps":
      return { understood: "What moves this forward", emphasis: ["next"], items: [], empty: null };
    case "messages":
      return { understood: "Messages", emphasis: [], items: [], empty: `No messages are composed on the ${noun} workspace yet; they are in its email thread.` };
    default:
      return { understood: "The whole workspace", emphasis: [], items: [], empty: null };
  }
}

/** The surface with the answer at the front and the blocks it concerns brought forward and marked. */
export function applyFocus(surface: LivingSurface, question: string, answer: Answer, source: "rules" | "model"): LivingSurface {
  const present = new Set(surface.blocks.map((b) => b.id));
  const emphasis = answer.emphasis.filter((id) => present.has(id)).slice(0, 6);
  // Answers that only point at blocks (consequences, next steps) say so rather than listing nothing.
  const pointing = !answer.items.length && !answer.empty && emphasis.length ? "Brought forward below." : null;
  // "Nothing on file…" is an abstention: it is said only when there is nothing to list.
  const props = { question: cut(question, 500), understood: cut(answer.understood, 500), items: answer.items.slice(0, 12).map((i) => ({ ...i, label: cut(i.label, 200), detail: i.detail ? cut(i.detail, 500) : null })), empty: answer.items.length ? null : (answer.empty ?? pointing), emphasis, source };
  const focusBlock: LivingBlock = { id: "focus", component: "FocusPanel", version: LIVING_REGISTRY.FocusPanel.version, role: "main", title: "You asked", props, evidence: [], actions: [], hash: hash(props) };
  const lead = surface.blocks.filter((b) => b.role === "lead");
  const forward = emphasis.map((id) => surface.blocks.find((b) => b.id === id)!).map((b) => ({ ...b, role: "main" as const }));
  const rest = surface.blocks.filter((b) => b.role !== "lead" && !emphasis.includes(b.id));
  const blocks = [...lead, focusBlock, ...forward, ...rest].slice(0, 20);
  return { ...surface, blocks, fingerprint: hash([surface.fingerprint, props]) };
}
