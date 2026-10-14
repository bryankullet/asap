import type { ActionSpec, ExperienceResponse, SubjectRef } from "@asap/schema";
import { ApiError, api } from "../../services/asap-api.js";
import type { ContinuityStore } from "../continuity/ContinuityStore.js";

/**
 * The closed map from a governed action kind to what it does (D-172). A composition can only name
 * a kind from the contract's closed set; each kind reaches one fixed endpoint, which checks the
 * person's permission again and keeps its own frozen payloads and audit. Interface actions stay in
 * the browser; exploration recomposes the experience; nothing else is reachable.
 */
export type FormResult =
  | { kind: "duplicates"; candidates: { ref: SubjectRef; detail: string | null }[] }
  | { kind: "error"; message: string; fields?: Record<string, string> }
  | { kind: "blocked"; message: string };

export type DispatchDeps = {
  experienceId: string;
  revision: () => number;
  store: ContinuityStore;
  apply: (r: ExperienceResponse) => void;
  navigate: (experienceId: string) => void;
  openDocument: (documentId: string, title: string) => void;
  setFormResult: (instance: string, r: FormResult | null) => void;
  /** The instance that carries the action (forms, tables). */
};

export type DispatchExtra = { instance?: string; note?: string; confirmNew?: boolean; useExisting?: SubjectRef; ref?: SubjectRef };

const message = (e: unknown) => (e instanceof ApiError ? (e.userMessage ?? (e.status === 403 ? "Your role does not allow this. Nothing was changed." : "That did not go through. Nothing was changed.")) : "That did not go through. Nothing was changed.");

export async function dispatchAction(action: ActionSpec, deps: DispatchDeps, extra: DispatchExtra = {}): Promise<void> {
  if (action.disabledReason) return;
  const p = action.payload;
  const id = deps.experienceId;
  switch (p.kind) {
    case "ui.select": {
      const ref = extra.ref ?? p.ref;
      if (!ref) return;
      deps.store.select(p.target, ref);
      deps.apply(await api.event(id, { kind: "select", ref }));
      return;
    }
    case "ui.reveal":
      deps.store.reveal(p.node);
      return;
    case "ui.dismiss":
      // Closing a selection's detail is the server's to recompose; anything else is local.
      if (p.node === "s-detail") {
        deps.store.select("policies", null);
        deps.apply(await api.event(id, { kind: "deselect" }));
      } else deps.store.dismiss(p.node);
      return;
    case "experience.refine":
      deps.apply(await api.ask(id, p.text, deps.revision()));
      return;
    case "experience.start": {
      const r = await api.startExperience(p.text, p.subject);
      deps.navigate(r.spec.experienceId);
      return;
    }
    case "document.open":
      deps.openDocument(p.documentId, action.label);
      return;
    case "client.create": {
      const form = p.form;
      if (extra.useExisting) {
        deps.apply(await api.event(id, { kind: "action_result", action: action.id, ref: extra.useExisting, outcome: "already" }));
        deps.store.clearDraft(form);
        return;
      }
      const d = deps.store.state.drafts[form] ?? {};
      const name = (d["name"] ?? "").trim();
      const kind = d["kind"] === "individual" ? "individual" : d["kind"] === "corporate" ? "corporate" : null;
      const fields: Record<string, string> = {};
      if (name.length < 2) fields["name"] = "Give the client's name.";
      if (!kind) fields["kind"] = "Say whether this is a company or a person.";
      const contactName = (d["contact.fullName"] ?? "").trim();
      const email = (d["contact.email"] ?? "").trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields["contact.email"] = "That does not look like an email address.";
      if (!contactName && (email || (d["contact.phone"] ?? "").trim())) fields["contact.fullName"] = "Give the contact's full name, or clear their details.";
      if (Object.keys(fields).length) {
        deps.setFormResult(form, { kind: "error", message: "A few details are needed first.", fields });
        return;
      }
      try {
        const r = await api.createClient({
          name,
          kind: kind!,
          confirmNew: extra.confirmNew ?? false,
          ...(contactName ? { contact: { fullName: contactName, roleLabel: (d["contact.roleLabel"] ?? "").trim() || null, email: email || null, phone: (d["contact.phone"] ?? "").trim() || null } } : {}),
        });
        if (r.outcome === "possible_duplicates") {
          deps.setFormResult(form, { kind: "duplicates", candidates: r.candidates.map((c) => ({ ref: { type: "client", id: c.id, label: c.name }, detail: c.kind === "individual" ? "A person" : "A company" })) });
          return;
        }
        if (r.outcome === "created" || r.outcome === "already_on_file") {
          deps.setFormResult(form, null);
          deps.apply(await api.event(id, { kind: "action_result", action: action.id, ref: { type: "client", id: r.file.client.id, label: r.file.client.name }, outcome: r.outcome === "created" ? "done" : "already" }));
          deps.store.clearDraft(form);
        }
      } catch (e) {
        deps.setFormResult(form, { kind: "error", message: message(e) });
      }
      return;
    }
    case "renewal.start": {
      try {
        const r = await api.startRenewal(p.policyPeriodId);
        const workItemId = r.run?.workItemId ?? null;
        if (r.outcome === "blocked" || !workItemId) {
          deps.setFormResult(extra.instance ?? "start", { kind: "blocked", message: r.reason ?? "The renewal could not be started." });
          return;
        }
        deps.apply(await api.event(id, { kind: "action_result", action: action.id, ref: { type: "work_item", id: workItemId, label: null }, outcome: r.outcome }));
      } catch (e) {
        deps.setFormResult(extra.instance ?? "start", { kind: "blocked", message: message(e) });
      }
      return;
    }
    case "approval.decide": {
      try {
        await api.decideApproval(p.approvalId, p.decision, p.bundleSha256, extra.note);
        deps.apply(await api.event(id, { kind: "action_result", action: action.id, ref: null, outcome: "done" }));
      } catch (e) {
        deps.setFormResult(extra.instance ?? "approval", { kind: "blocked", message: message(e) });
      }
      return;
    }
  }
}
