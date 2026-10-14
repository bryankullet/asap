import { hasPermission } from "../context.js";
import { mapDatabaseError } from "../errors.js";
import type { Env } from "../placement/service.js";
import { Composition, L, fmtDate } from "./build.js";
import type { Composed } from "./types.js";

/**
 * "Add a new client" (D-172): the work area opens straight into the smallest interaction that can
 * create one — the name and whether it is a company or a person, which is all POST /clients needs.
 * The primary contact appears only when the person asks for it. The duplicate review, the
 * idempotent create and the permission check stay in the endpoint; the browser calls it through the
 * closed `client.create` action and reports the result, which is then read back from the record.
 */
export type CreateClientParams = { stage: "form" | "created"; name: string | null; clientId: string | null };

export async function composeCreateClient(env: Env, p: CreateClientParams): Promise<Composed> {
  const c = new Composition();
  const canCreate = hasPermission(env.ctx, "client", "create");

  if (p.stage === "created" && p.clientId) {
    const r = await env.db.from("clients").select("id, name, kind, created_at").eq("organization_id", env.organizationId).eq("id", p.clientId).is("deleted_at", null).maybeSingle();
    if (r.error) throw mapDatabaseError(r.error);
    const row = r.data as { id: string; name: string; kind: string; created_at: string } | null;
    if (row) {
      const ref = { type: "client" as const, id: row.id, label: row.name };
      c.allow(ref);
      const contact = await env.db.from("client_contacts").select("full_name, email, phone").eq("organization_id", env.organizationId).eq("client_id", row.id).is("deleted_at", null).order("is_primary", { ascending: false }).limit(1).maybeSingle();
      const person = (contact.data ?? null) as { full_name: string; email: string | null; phone: string | null } | null;
      const another = c.action("another", "Add another client", { kind: "experience.start", text: "Add a new client", subject: null });
      const expiring = c.action("expiring", "Policies expiring this month", { kind: "experience.start", text: "Show policies expiring this month", subject: null });
      const done = c.put("done", "Confirmation", {
        heading: `${row.name} is on file`,
        lines: [
          `Added as a ${row.kind === "individual" ? "person" : "company"} on ${fmtDate(row.created_at)}.`,
          person ? `Primary contact: ${person.full_name}${person.email ? `, ${person.email}` : ""}${person.phone ? `, ${person.phone}` : ""}.` : "No contact is on file yet.",
          "Nothing was sent to anyone.",
        ],
        tone: "green",
        next: [another, expiring],
      }, { actions: [another, expiring] });
      return {
        title: `Added ${row.name}`,
        progress: "complete",
        primary: ref,
        layout: L.stack("root", [done]),
        composition: c,
        missing: [],
      };
    }
  }

  const submit = c.action("save", "Add the client", { kind: "client.create", form: "client" }, { primary: true, disabledReason: canCreate ? null : "Your role cannot add clients. A colleague with client access can." });
  const form = c.put("client", "ProgressiveForm", {
    title: "Who is the new client?",
    intro: "ASAP checks for a client with a similar name before adding one.",
    fields: [
      { name: "name", label: "Client name", kind: "text", required: true, options: [], help: "The legal or trading name.", stage: 0, maxLength: 200 },
      { name: "kind", label: "This client is", kind: "choice", required: true, options: [{ value: "corporate", label: "A company" }, { value: "individual", label: "A person" }], help: null, stage: 0, maxLength: 20 },
      { name: "contact.fullName", label: "Contact's full name", kind: "text", required: false, options: [], help: null, stage: 1, maxLength: 200 },
      { name: "contact.roleLabel", label: "Their role", kind: "text", required: false, options: [], help: "For example, Finance manager.", stage: 1, maxLength: 120 },
      { name: "contact.email", label: "Email", kind: "email", required: false, options: [], help: null, stage: 1, maxLength: 320 },
      { name: "contact.phone", label: "Phone", kind: "tel", required: false, options: [], help: null, stage: 1, maxLength: 40 },
    ],
    revealLabel: "Add the primary contact now",
    submit,
    duplicates: [],
    error: null,
  }, { actions: [submit], continuity: ["draft", "expanded"] });
  return {
    title: "Add a new client",
    progress: "waiting_input",
    primary: null,
    layout: L.flow("root", [
      { id: "who", label: "Who they are", state: "current" },
      { id: "saved", label: "On file", state: "next" },
    ], form),
    composition: c,
    missing: ["The client's name", "Company or person"],
    ...(p.name ? { prefill: { client: { name: p.name } } } : {}),
  };
}
