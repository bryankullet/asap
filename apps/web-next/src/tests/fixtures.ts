import { EXPERIENCE_CONTRACT, type ASAPExperienceSpec, type ComponentInstance, type LayoutNode } from "@asap/schema";

export const R = { narrow: "keep" as const };
export const slot = (instance: string, extra: Partial<Extract<LayoutNode, { type: "slot" }>> = {}): LayoutNode => ({ type: "slot", id: `s-${instance}`, instance, priority: "primary", responsive: R, ...extra });

export function comp(instance: string, component: ComponentInstance["component"], props: Record<string, unknown>, extra: Partial<ComponentInstance> = {}): ComponentInstance {
  return { instance, component, version: 1, title: null, props, sources: [], actions: [], continuity: [], hash: `${instance}-1`, ...extra };
}

export function spec(overrides: Partial<ASAPExperienceSpec> = {}): ASAPExperienceSpec {
  return {
    contract: EXPERIENCE_CONTRACT,
    experienceId: "33333333-3333-4333-8333-333333333333",
    revision: 1,
    composedAt: "2026-10-13T10:00:00Z",
    title: "Test",
    intent: { kind: "create_client", expression: "Add a new client", understood: "Add a client", resolution: "resolved", interpretedBy: "rules", missing: [], progress: "waiting_input", directionChangedAt: null },
    context: { primary: null, related: [], permissions: {}, constraints: [], unresolved: [], unavailable: [] },
    layout: { type: "stack", id: "root", gap: "normal", priority: "primary", responsive: R, children: [slot("a")] },
    components: [comp("a", "Answer", { question: null, text: "Hello", items: [], source: "records", refused: false })],
    actions: [],
    notices: [],
    withdrawn: [],
    ...overrides,
  };
}

export const formSpec = (rev = 1, hash = "f-1"): ASAPExperienceSpec =>
  spec({
    revision: rev,
    layout: { type: "flow", id: "root", steps: [{ id: "who", label: "Who they are", state: "current" }, { id: "saved", label: "On file", state: "next" }], current: slot("client"), priority: "primary", responsive: R },
    components: [
      comp("client", "ProgressiveForm", {
        title: "Who is the new client?",
        intro: null,
        fields: [
          { name: "name", label: "Client name", kind: "text", required: true, options: [], help: null, stage: 0, maxLength: 200 },
          { name: "kind", label: "This client is", kind: "choice", required: true, options: [{ value: "corporate", label: "A company" }, { value: "individual", label: "A person" }], help: null, stage: 0, maxLength: 20 },
          { name: "contact.fullName", label: "Contact's full name", kind: "text", required: false, options: [], help: null, stage: 1, maxLength: 200 },
        ],
        revealLabel: "Add the primary contact now",
        submit: "save",
        duplicates: [],
        error: null,
      }, { actions: ["save"], continuity: ["draft"], hash }),
    ],
    actions: [{ id: "save", label: "Add the client", class: "mutate", payload: { kind: "client.create", form: "client" }, primary: true, confirm: null, disabledReason: null }],
  });

export const tableSpec = (): ASAPExperienceSpec =>
  spec({
    intent: { kind: "explore_policies", expression: "Show motor policies expiring this month", understood: "Policies", resolution: "resolved", interpretedBy: "rules", missing: [], progress: "working", directionChangedAt: null },
    layout: { type: "table", id: "root", table: { type: "stack", id: "list", gap: "tight", priority: "primary", responsive: R, children: [slot("filters"), slot("policies")] }, detail: null, priority: "primary", responsive: R },
    components: [
      comp("filters", "FilterBar", { chips: [{ label: "Ending in October 2026", removeAction: null }], basis: "From records.", unclear: null, count: 1 }),
      comp("policies", "RecordTable", {
        caption: "Policies ending in October 2026",
        columns: [{ key: "client", label: "Client", align: "start" }, { key: "premium", label: "Expiring premium", align: "end" }],
        rows: [{ ref: { type: "policy_period", id: "44444444-4444-4444-8444-444444444444", label: "Acme" }, cells: { client: "Acme Motors", premium: "KES 1,850,000.00" }, tone: null }],
        selectable: true,
        emptyText: "None",
        truncated: false,
      }, { continuity: ["selection"] }),
    ],
  });

export const dockSpec = (): ASAPExperienceSpec =>
  spec({
    intent: { kind: "renew_policy", expression: "Help me renew Acme's motor fleet", understood: "Renew", resolution: "resolved", interpretedBy: "rules", missing: [], progress: "working", directionChangedAt: null },
    layout: {
      type: "dock", id: "root", side: "end", priority: "primary", responsive: R,
      main: { type: "stack", id: "main", gap: "normal", priority: "primary", responsive: R, children: [slot("summary"), slot("stages")] },
      dock: slot("holders", { priority: "secondary", responsive: { narrow: "collapse" } }),
    },
    components: [
      comp("summary", "ContextSummary", { eyebrow: "Renewal", heading: "Acme Motors · Commercial motor", status: { label: "Recorded: Waiting on others", tone: "gold" }, facts: [{ label: "Cover ends", value: "18 Oct 2026", source: { label: "Expiring period", reference: "EXP-1", documentId: null, recordedAt: null } }] }),
      comp("stages", "Milestones", { steps: [{ key: "preparing", label: "Preparing", state: "done" }, { key: "awaiting_terms", label: "Waiting for terms", state: "now" }], summary: "Waiting for terms." }),
      comp("holders", "Obligations", { items: [{ party: "Jubilee", what: "Terms for the renewal", since: "2026-10-10", due: null, kind: "outside" }], empty: "None" }, { title: "Who holds it" }),
    ],
  });
