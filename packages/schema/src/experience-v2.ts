import { z } from "zod";
import { uuidSchema } from "./api/common.js";

/**
 * The progressive experience contract, version 2 (D-172).
 *
 * An *experience* is one person's continuing working context around an intention ("add a new
 * client", "motor policies expiring this month", "renew Acme's motor fleet"). It is interface state,
 * never an alternative business record: every value it shows is read from records the viewer may
 * read, on the server, at composition time.
 *
 *   intention → interpretation → authorized context → composition (this contract) → validation →
 *   registered components rendered inside a layout tree → interactions → governed actions through
 *   the endpoints that already own them → recomposition
 *
 * The composition is declarative: a bounded tree of spatial primitives (stack, grid, split, flow,
 * table, tabs, overlay, dock, focus) whose leaves are slots naming registered component instances.
 * Nothing here is markup, style or code; a primitive controls structure, never business meaning.
 */

export const EXPERIENCE_CONTRACT = "asap.experience/v2" as const;
export const EXPERIENCE_LIMITS = { depth: 6, nodes: 60, components: 24, actions: 40, children: 12 } as const;

const line = z.string().trim().min(1).max(500);
const label = z.string().trim().min(1).max(200);
const short = z.string().trim().min(1).max(80);
const nodeId = z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/, "a node id is lower-case letters, digits, - and _");
const tone = z.enum(["green", "gold", "red", "grey"]);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/* ----------------------------------------------------------------------------------------------
 * Subjects and sources — references to records, never their values
 * -------------------------------------------------------------------------------------------- */

export const SubjectType = z.enum(["client", "policy", "policy_period", "work_item", "opportunity", "insurer", "document", "workflow_run", "approval"]);
export type SubjectType = z.infer<typeof SubjectType>;
export const subjectRefSchema = z.strictObject({ type: SubjectType, id: uuidSchema, label: label.nullable().default(null) });
export type SubjectRef = z.infer<typeof subjectRefSchema>;
export const subjectKey = (r: Pick<SubjectRef, "type" | "id">) => `${r.type}:${r.id}`;

/** Where a shown fact comes from. A material insurance fact carries one (§ evidence). */
export const sourceRefSchema = z.strictObject({
  label,
  reference: line,
  documentId: uuidSchema.nullable().default(null),
  recordedAt: z.string().max(40).nullable().default(null),
});
export type SourceRef = z.infer<typeof sourceRefSchema>;

/* ----------------------------------------------------------------------------------------------
 * Intent — the person's objective, independent of what is shown
 * -------------------------------------------------------------------------------------------- */

export const IntentKind = z.enum(["create_client", "explore_policies", "renew_policy", "clarify", "unsupported"]);
export type IntentKind = z.infer<typeof IntentKind>;

export const intentSchema = z.strictObject({
  kind: IntentKind,
  /** The person's own words, as typed. */
  expression: z.string().trim().min(1).max(500),
  /** What ASAP understood, in plain words. */
  understood: line,
  resolution: z.enum(["resolved", "ambiguous", "needs_input", "unsupported"]),
  /** Who read it: deterministic rules, or the model through the gateway, schema-checked. */
  interpretedBy: z.enum(["rules", "model"]),
  missing: z.array(line).max(8).default([]),
  /** Interface progress of the intention — never an insurance workflow status. */
  progress: z.enum(["started", "working", "waiting_input", "complete", "blocked"]),
  /** Set when the person explicitly changed direction inside this experience. */
  directionChangedAt: z.string().max(40).nullable().default(null),
});
export type ExperienceIntent = z.infer<typeof intentSchema>;

/* ----------------------------------------------------------------------------------------------
 * Context — authorized references the experience carries
 * -------------------------------------------------------------------------------------------- */

export const experienceContextSchema = z.strictObject({
  primary: subjectRefSchema.nullable(),
  related: z.array(subjectRefSchema).max(20).default([]),
  /** What the viewer's role allows here. Informational: every endpoint checks again. */
  permissions: z.record(z.string().max(40), z.boolean()).default({}),
  constraints: z.array(line).max(8).default([]),
  unresolved: z.array(line).max(8).default([]),
  /** Parts that could not be read for this viewer — said, never shown as absent facts. */
  unavailable: z.array(line).max(8).default([]),
});
export type ExperienceContext = z.infer<typeof experienceContextSchema>;

/* ----------------------------------------------------------------------------------------------
 * Layout grammar — structure only
 * -------------------------------------------------------------------------------------------- */

const responsive = z
  .strictObject({
    /** Under 900px: keep in place, collapse behind a disclosure, or hide (secondary content only). */
    narrow: z.enum(["keep", "collapse", "hide"]).default("keep"),
  })
  .default({ narrow: "keep" });
const nodeBase = { id: nodeId, priority: z.enum(["primary", "secondary"]).default("primary"), responsive };

export type LayoutNode =
  | { type: "slot"; id: string; instance: string; priority: "primary" | "secondary"; responsive: { narrow: "keep" | "collapse" | "hide" } }
  | { type: "stack"; id: string; gap: "tight" | "normal" | "loose"; children: LayoutNode[]; priority: "primary" | "secondary"; responsive: { narrow: "keep" | "collapse" | "hide" } }
  | { type: "grid"; id: string; columns: 2 | 3 | 4; children: LayoutNode[]; priority: "primary" | "secondary"; responsive: { narrow: "keep" | "collapse" | "hide" } }
  | { type: "split"; id: string; ratio: "1:1" | "2:1" | "1:2"; narrow: "stack" | "first"; children: [LayoutNode, LayoutNode]; priority: "primary" | "secondary"; responsive: { narrow: "keep" | "collapse" | "hide" } }
  | { type: "flow"; id: string; steps: { id: string; label: string; state: "done" | "current" | "next" }[]; current: LayoutNode; priority: "primary" | "secondary"; responsive: { narrow: "keep" | "collapse" | "hide" } }
  | { type: "table"; id: string; table: LayoutNode; detail: LayoutNode | null; priority: "primary" | "secondary"; responsive: { narrow: "keep" | "collapse" | "hide" } }
  | { type: "tabs"; id: string; tabs: { id: string; label: string; child: LayoutNode }[]; active: string; priority: "primary" | "secondary"; responsive: { narrow: "keep" | "collapse" | "hide" } }
  | { type: "overlay"; id: string; base: LayoutNode; overlay: LayoutNode | null; title: string | null; priority: "primary" | "secondary"; responsive: { narrow: "keep" | "collapse" | "hide" } }
  | { type: "dock"; id: string; main: LayoutNode; dock: LayoutNode; side: "end" | "bottom"; priority: "primary" | "secondary"; responsive: { narrow: "keep" | "collapse" | "hide" } }
  | { type: "focus"; id: string; primary: LayoutNode; context: LayoutNode[]; contextLabel: string; priority: "primary" | "secondary"; responsive: { narrow: "keep" | "collapse" | "hide" } };

export const LayoutType = z.enum(["slot", "stack", "grid", "split", "flow", "table", "tabs", "overlay", "dock", "focus"]);

export const layoutNodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.literal("slot"), ...nodeBase, instance: nodeId }),
    z.strictObject({ type: z.literal("stack"), ...nodeBase, gap: z.enum(["tight", "normal", "loose"]).default("normal"), children: z.array(layoutNodeSchema).min(1).max(EXPERIENCE_LIMITS.children) }),
    z.strictObject({ type: z.literal("grid"), ...nodeBase, columns: z.union([z.literal(2), z.literal(3), z.literal(4)]), children: z.array(layoutNodeSchema).min(1).max(EXPERIENCE_LIMITS.children) }),
    z.strictObject({ type: z.literal("split"), ...nodeBase, ratio: z.enum(["1:1", "2:1", "1:2"]).default("1:1"), narrow: z.enum(["stack", "first"]).default("stack"), children: z.tuple([layoutNodeSchema, layoutNodeSchema]) }),
    z.strictObject({
      type: z.literal("flow"),
      ...nodeBase,
      steps: z.array(z.strictObject({ id: nodeId, label, state: z.enum(["done", "current", "next"]) })).min(1).max(10),
      current: layoutNodeSchema,
    }),
    z.strictObject({ type: z.literal("table"), ...nodeBase, table: layoutNodeSchema, detail: layoutNodeSchema.nullable() }),
    z.strictObject({ type: z.literal("tabs"), ...nodeBase, tabs: z.array(z.strictObject({ id: nodeId, label: short, child: layoutNodeSchema })).min(2).max(6), active: nodeId }),
    z.strictObject({ type: z.literal("overlay"), ...nodeBase, base: layoutNodeSchema, overlay: layoutNodeSchema.nullable(), title: label.nullable().default(null) }),
    z.strictObject({ type: z.literal("dock"), ...nodeBase, main: layoutNodeSchema, dock: layoutNodeSchema, side: z.enum(["end", "bottom"]).default("end") }),
    z.strictObject({ type: z.literal("focus"), ...nodeBase, primary: layoutNodeSchema, context: z.array(layoutNodeSchema).max(6), contextLabel: short }),
  ]),
) as z.ZodType<LayoutNode>;

/** Children of any node, in reading (and keyboard) order. */
export function layoutChildren(n: LayoutNode): LayoutNode[] {
  switch (n.type) {
    case "slot": return [];
    case "stack": case "grid": return n.children;
    case "split": return [...n.children];
    case "flow": return [n.current];
    case "table": return n.detail ? [n.table, n.detail] : [n.table];
    case "tabs": return n.tabs.map((t) => t.child);
    case "overlay": return n.overlay ? [n.base, n.overlay] : [n.base];
    case "dock": return [n.main, n.dock];
    case "focus": return [n.primary, ...n.context];
  }
}

/* ----------------------------------------------------------------------------------------------
 * Actions — typed and governed. A closed set of kinds; the browser maps each kind to one fixed
 * endpoint (ActionDispatcher). An action name never becomes an arbitrary URL.
 * -------------------------------------------------------------------------------------------- */

export const ActionClass = z.enum(["interface", "explore", "propose", "mutate"]);
export const actionPayloadSchema = z.discriminatedUnion("kind", [
  /* Interface only: changes what is shown, never a record. */
  z.strictObject({ kind: z.literal("ui.select"), target: nodeId, ref: subjectRefSchema }),
  z.strictObject({ kind: z.literal("ui.reveal"), node: nodeId }),
  z.strictObject({ kind: z.literal("ui.dismiss"), node: nodeId }),
  /* Exploration: recomposes the experience; writes nothing to business records. */
  z.strictObject({ kind: z.literal("experience.refine"), text: z.string().trim().min(1).max(500) }),
  /* Starts another experience, from words or from a record already on screen (re-authorized on the server). */
  z.strictObject({ kind: z.literal("experience.start"), text: z.string().trim().min(1).max(500), subject: subjectRefSchema.nullable().default(null) }),
  z.strictObject({ kind: z.literal("document.open"), documentId: uuidSchema }),
  /* Business mutations, each owned by an existing endpoint that checks permission again. */
  z.strictObject({ kind: z.literal("client.create"), form: nodeId }),
  z.strictObject({ kind: z.literal("renewal.start"), policyId: uuidSchema }),
  /* The exact bundle the person saw: the endpoint refuses a decision on any other version. */
  z.strictObject({ kind: z.literal("approval.decide"), approvalId: uuidSchema, bundleSha256: z.string().regex(/^[0-9a-f]{64}$/), decision: z.enum(["approve", "reject"]) }),
]);
export type ActionPayload = z.infer<typeof actionPayloadSchema>;
export type ActionKind = ActionPayload["kind"];
export const ACTION_CLASS: Record<ActionKind, z.infer<typeof ActionClass>> = {
  "ui.select": "interface",
  "ui.reveal": "interface",
  "ui.dismiss": "interface",
  "experience.refine": "explore",
  "experience.start": "explore",
  "document.open": "explore",
  "client.create": "mutate",
  "renewal.start": "mutate",
  "approval.decide": "mutate",
};

export const actionSpecSchema = z.strictObject({
  id: nodeId,
  label: short,
  class: ActionClass,
  payload: actionPayloadSchema,
  primary: z.boolean().default(false),
  /** Protected business operations say exactly what will happen, and wait for confirmation. */
  confirm: z.strictObject({ heading: label, effects: z.array(line).min(1).max(6) }).nullable().default(null),
  /** Offered but not available, with the reason — never silently missing. */
  disabledReason: line.nullable().default(null),
});
export type ActionSpec = z.infer<typeof actionSpecSchema>;

/* ----------------------------------------------------------------------------------------------
 * Component registry — interaction purposes, not insurance modules. Each component has a strict
 * prop contract and the action kinds it may carry.
 * -------------------------------------------------------------------------------------------- */

const fact = z.strictObject({ label, value: z.string().max(500), source: sourceRefSchema.nullable().default(null) });
const formField = z.strictObject({
  name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.]{0,47}$/),
  label,
  kind: z.enum(["text", "email", "tel", "choice"]),
  required: z.boolean(),
  options: z.array(z.strictObject({ value: short, label: short })).max(8).default([]),
  help: line.nullable().default(null),
  /** 0 is asked first; higher stages appear only when revealed or needed. */
  stage: z.number().int().min(0).max(3),
  maxLength: z.number().int().min(1).max(500).default(200),
});

export const EXPERIENCE_COMPONENTS = {
  /* Understanding */
  Clarification: {
    version: 1, group: "understanding",
    props: z.strictObject({ question: line, options: z.array(z.strictObject({ label: short, action: nodeId })).max(6), allowText: z.boolean() }),
    actions: ["experience.refine", "experience.start"],
  },
  RecordChoice: {
    version: 1, group: "understanding",
    props: z.strictObject({ prompt: line, choices: z.array(z.strictObject({ ref: subjectRefSchema, detail: z.string().max(300).nullable(), action: nodeId })).min(1).max(8) }),
    actions: ["experience.refine", "ui.select"],
  },
  ContextSummary: {
    version: 1, group: "understanding",
    props: z.strictObject({ eyebrow: short.nullable(), heading: label, status: z.strictObject({ label: short, tone }).nullable(), facts: z.array(fact).max(8) }),
    actions: ["experience.start", "document.open"],
  },
  Answer: {
    version: 1, group: "understanding",
    props: z.strictObject({ question: line.nullable(), text: line, items: z.array(z.strictObject({ label, detail: z.string().max(500).nullable(), tone })).max(10), source: z.enum(["records", "rules", "model"]), refused: z.boolean() }),
    actions: [],
  },
  /* Exploring */
  FilterBar: {
    version: 1, group: "exploring",
    props: z.strictObject({ chips: z.array(z.strictObject({ label: short, removeAction: nodeId.nullable() })).max(12), basis: line, unclear: line.nullable(), count: z.number().int().min(0) }),
    actions: ["experience.refine"],
  },
  RecordTable: {
    version: 1, group: "exploring",
    props: z.strictObject({
      caption: label,
      columns: z.array(z.strictObject({ key: z.string().regex(/^[a-z][a-zA-Z0-9]{0,31}$/), label: short, align: z.enum(["start", "end"]).default("start") })).min(1).max(8),
      rows: z.array(z.strictObject({ ref: subjectRefSchema, cells: z.record(z.string(), z.string().max(200).nullable()), tone: tone.nullable().default(null) })).max(200),
      selectable: z.boolean(),
      emptyText: line,
      truncated: z.boolean().default(false),
    }),
    actions: ["ui.select"],
  },
  RecordDetail: {
    version: 1, group: "exploring",
    props: z.strictObject({ heading: label, eyebrow: short.nullable(), facts: z.array(fact).max(12), note: line.nullable() }),
    actions: ["renewal.start", "experience.start", "experience.refine", "ui.dismiss"],
  },
  Comparison: {
    version: 1, group: "deciding",
    props: z.strictObject({
      caption: label,
      columns: z.array(z.strictObject({ label: short, detail: z.string().max(120).nullable() })).min(1).max(6),
      rows: z.array(z.strictObject({ label: short, values: z.array(z.string().max(200).nullable()), unclear: z.array(z.boolean()) })).max(30),
      note: line,
      hypothetical: z.boolean(),
    }),
    actions: ["experience.refine", "document.open"],
  },
  /* Working */
  ProgressiveForm: {
    version: 1, group: "working",
    props: z.strictObject({
      title: label,
      intro: line.nullable(),
      fields: z.array(formField).min(1).max(16),
      revealLabel: short.nullable(),
      submit: nodeId,
      duplicates: z.array(z.strictObject({ ref: subjectRefSchema, detail: z.string().max(200).nullable() })).max(6).default([]),
      error: line.nullable().default(null),
    }),
    actions: ["client.create", "ui.select", "experience.start"],
  },
  DocumentViewer: {
    version: 1, group: "working",
    props: z.strictObject({ documentId: uuidSchema, title: label }),
    actions: ["ui.dismiss"],
  },
  /* Deciding */
  GovernedAction: {
    version: 1, group: "deciding",
    props: z.strictObject({ heading: label, explanation: line, effects: z.array(line).max(6), action: nodeId }),
    actions: ["renewal.start", "approval.decide", "client.create"],
  },
  ApprovalReview: {
    version: 1, group: "deciding",
    props: z.strictObject({ heading: label, why: line, items: z.array(z.strictObject({ heading: label, to: z.string().max(300).nullable(), subject: z.string().max(300), body: z.string().max(20000) })).min(1).max(10), approve: nodeId, ret: nodeId }),
    actions: ["approval.decide"],
  },
  Confirmation: {
    version: 1, group: "deciding",
    props: z.strictObject({ heading: label, lines: z.array(line).max(6), tone, next: z.array(nodeId).max(4) }),
    actions: ["experience.start", "experience.refine", "renewal.start"],
  },
  /* Progress */
  Milestones: {
    version: 1, group: "progress",
    props: z.strictObject({ steps: z.array(z.strictObject({ key: short, label, state: z.enum(["done", "now", "next"]) })).min(1).max(10), summary: line }),
    actions: [],
  },
  NextSteps: {
    version: 1, group: "progress",
    props: z.strictObject({ items: z.array(z.strictObject({ title: line, why: line, responsible: z.string().max(200).nullable(), blockedBy: z.array(line).max(6), tone, action: nodeId.nullable() })).max(6), empty: line }),
    actions: ["renewal.start", "approval.decide", "experience.refine"],
  },
  Obligations: {
    version: 1, group: "progress",
    props: z.strictObject({ items: z.array(z.strictObject({ party: label, what: line, since: z.string().max(40).nullable(), due: z.string().max(40).nullable(), kind: z.enum(["outside", "brokerage", "asap"]) })).max(10), empty: line }),
    actions: [],
  },
  Consequences: {
    version: 1, group: "progress",
    props: z.strictObject({ items: z.array(z.strictObject({ certainty: z.enum(["confirmed", "potential", "missing"]), text: line })).max(8) }),
    actions: [],
  },
  Timeline: {
    version: 1, group: "progress",
    props: z.strictObject({ events: z.array(z.strictObject({ at: z.string().max(40), text: line, actor: z.string().max(200).nullable() })).max(15) }),
    actions: [],
  },
  /* Evidence */
  SourceList: {
    version: 1, group: "evidence",
    props: z.strictObject({ items: z.array(sourceRefSchema).max(20), empty: line }),
    actions: ["document.open"],
  },
  ChangeList: {
    version: 1, group: "evidence",
    props: z.strictObject({ items: z.array(z.strictObject({ subject: label, field: short, earlier: z.string().max(200).nullable(), revised: z.string().max(200).nullable(), revision: z.number().int().min(1), affects: z.array(line).max(4) })).max(10), empty: line }),
    actions: ["document.open"],
  },
} as const satisfies Record<string, { version: number; group: "understanding" | "exploring" | "working" | "deciding" | "progress" | "evidence"; props: z.ZodType; actions: readonly ActionKind[] }>;

export type ExperienceComponentId = keyof typeof EXPERIENCE_COMPONENTS;
export const ExperienceComponentId = z.enum(Object.keys(EXPERIENCE_COMPONENTS) as [ExperienceComponentId, ...ExperienceComponentId[]]);
export type ExperienceProps<C extends ExperienceComponentId> = z.infer<(typeof EXPERIENCE_COMPONENTS)[C]["props"]>;

/** What a component instance keeps across recompositions (continuity policy). */
export const ContinuityKey = z.enum(["draft", "selection", "expanded", "scroll", "pinned", "sort"]);

export const componentInstanceSchema = z.strictObject({
  instance: nodeId,
  component: ExperienceComponentId,
  version: z.number().int().min(1),
  title: label.nullable().default(null),
  props: z.record(z.string(), z.unknown()),
  sources: z.array(sourceRefSchema).max(20).default([]),
  /** Action ids (from `actions`) this instance may trigger. */
  actions: z.array(nodeId).max(8).default([]),
  continuity: z.array(ContinuityKey).max(6).default([]),
  /** Content hash: unchanged props keep the instance (and its state) as it is. */
  hash: z.string().max(64),
});
export type ComponentInstance = z.infer<typeof componentInstanceSchema>;

/* ----------------------------------------------------------------------------------------------
 * The specification
 * -------------------------------------------------------------------------------------------- */

export const experienceSpecSchema = z.strictObject({
  contract: z.literal(EXPERIENCE_CONTRACT),
  experienceId: uuidSchema,
  /** Increases with every composition of this experience; an older one never replaces a newer. */
  revision: z.number().int().min(1),
  composedAt: z.string().max(40),
  title: label,
  intent: intentSchema,
  context: experienceContextSchema,
  layout: layoutNodeSchema,
  components: z.array(componentInstanceSchema).max(EXPERIENCE_LIMITS.components),
  actions: z.array(actionSpecSchema).max(EXPERIENCE_LIMITS.actions),
  /** Meaningful changes since the previous composition, said once. */
  notices: z.array(z.strictObject({ tone, text: line })).max(4).default([]),
  /** Actions that were offered before and are no longer, with the reason. */
  withdrawn: z.array(z.strictObject({ action: nodeId, reason: line })).max(8).default([]),
});
export type ASAPExperienceSpec = z.infer<typeof experienceSpecSchema>;

export type SpecIssue = { path: string; message: string };

/**
 * Full validation: the shape, then the rules a shape cannot express — bounded depth and size, every
 * slot naming an existing instance exactly once, registered components and versions, each
 * component's props against its contract, actions known and allowed for the component that carries
 * them, payload classes as declared, mutations carrying a confirmation, unique ids.
 *
 * `authorizedRefs`, when given, is the set of record keys the server loaded under the viewer's
 * session; any reference outside it fails the specification.
 */
export function validateExperienceSpec(input: unknown, opts: { authorizedRefs?: ReadonlySet<string> } = {}): { ok: true; spec: ASAPExperienceSpec } | { ok: false; issues: SpecIssue[] } {
  const parsed = experienceSpecSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.slice(0, 20).map((i) => ({ path: i.path.join("."), message: i.message })) };
  const spec = parsed.data;
  const issues: SpecIssue[] = [];
  const nodeIds = new Set<string>();
  const slotted = new Map<string, number>();
  let count = 0;
  const walk = (n: LayoutNode, depth: number, path: string) => {
    count++;
    if (depth > EXPERIENCE_LIMITS.depth) issues.push({ path, message: `layout deeper than ${EXPERIENCE_LIMITS.depth}` });
    if (nodeIds.has(n.id)) issues.push({ path, message: `duplicate node id ${n.id}` });
    nodeIds.add(n.id);
    if (n.type === "slot") slotted.set(n.instance, (slotted.get(n.instance) ?? 0) + 1);
    if (n.type === "tabs" && !n.tabs.some((t) => t.id === n.active)) issues.push({ path, message: "active tab is not one of the tabs" });
    layoutChildren(n).forEach((c, i) => walk(c, depth + 1, `${path}.${i}`));
  };
  walk(spec.layout, 1, "layout");
  if (count > EXPERIENCE_LIMITS.nodes) issues.push({ path: "layout", message: `more than ${EXPERIENCE_LIMITS.nodes} layout nodes` });

  const actions = new Map(spec.actions.map((a) => [a.id, a]));
  if (actions.size !== spec.actions.length) issues.push({ path: "actions", message: "duplicate action id" });
  for (const a of spec.actions) {
    if (ACTION_CLASS[a.payload.kind] !== a.class) issues.push({ path: `actions.${a.id}`, message: `${a.payload.kind} is a ${ACTION_CLASS[a.payload.kind]} action` });
    if (a.class === "mutate" && !a.confirm && a.payload.kind !== "client.create") issues.push({ path: `actions.${a.id}`, message: "a business mutation must carry its confirmation" });
    if (a.payload.kind === "ui.select" && opts.authorizedRefs && !opts.authorizedRefs.has(subjectKey(a.payload.ref))) issues.push({ path: `actions.${a.id}`, message: "references a record outside the authorized context" });
  }

  const instances = new Set<string>();
  for (const c of spec.components) {
    const path = `components.${c.instance}`;
    if (instances.has(c.instance)) issues.push({ path, message: "duplicate instance id" });
    instances.add(c.instance);
    const def = EXPERIENCE_COMPONENTS[c.component];
    if (c.version !== def.version) issues.push({ path, message: `${c.component} v${c.version} is not registered` });
    const props = def.props.safeParse(c.props);
    if (!props.success) issues.push(...props.error.issues.slice(0, 5).map((i) => ({ path: `${path}.props.${i.path.join(".")}`, message: i.message })));
    if (slotted.get(c.instance) !== 1) issues.push({ path, message: "every instance appears in the layout exactly once" });
    for (const id of c.actions) {
      const a = actions.get(id);
      if (!a) issues.push({ path, message: `unknown action ${id}` });
      else if (!(def.actions as readonly string[]).includes(a.payload.kind)) issues.push({ path, message: `${c.component} may not carry ${a.payload.kind}` });
    }
    // Action ids named inside props must be among the instance's own actions.
    for (const id of actionIdsInProps(c.props)) if (!c.actions.includes(id)) issues.push({ path, message: `props name action ${id} the instance does not carry` });
  }
  for (const [inst] of slotted) if (!instances.has(inst)) issues.push({ path: "layout", message: `slot names unknown instance ${inst}` });

  if (opts.authorizedRefs) {
    const refs = [spec.context.primary, ...spec.context.related].filter((r): r is SubjectRef => !!r);
    for (const c of spec.components) refs.push(...refsInProps(c.props));
    for (const r of refs) if (!opts.authorizedRefs.has(subjectKey(r))) issues.push({ path: "refs", message: `${subjectKey(r)} is outside the authorized context` });
  }
  return issues.length ? { ok: false, issues: issues.slice(0, 20) } : { ok: true, spec };
}

const ACTION_PROP_KEYS = new Set(["action", "submit", "approve", "ret", "removeAction"]);
function actionIdsInProps(v: unknown): string[] {
  const out: string[] = [];
  const visit = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === "object")
      for (const [k, val] of Object.entries(x)) {
        if (ACTION_PROP_KEYS.has(k) && typeof val === "string") out.push(val);
        else if (k === "next" && Array.isArray(val)) out.push(...val.filter((s): s is string => typeof s === "string"));
        else visit(val);
      }
  };
  visit(v);
  return out;
}
function refsInProps(v: unknown): SubjectRef[] {
  const out: SubjectRef[] = [];
  const visit = (x: unknown) => {
    if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === "object") {
      const r = subjectRefSchema.safeParse(x);
      if (r.success) out.push(r.data);
      else Object.values(x).forEach(visit);
    }
  };
  visit(v);
  return out;
}

/* ----------------------------------------------------------------------------------------------
 * Requests and responses
 * -------------------------------------------------------------------------------------------- */

/** Interface state kept per experience: drafts, selection, open disclosures. Never a business value. */
export const experienceUiStateSchema = z.strictObject({
  drafts: z.record(nodeId, z.record(z.string().max(48), z.string().max(500))).default({}),
  selection: z.record(nodeId, subjectRefSchema.nullable()).default({}),
  revealed: z.array(nodeId).max(40).default([]),
  dismissed: z.array(nodeId).max(40).default([]),
  /** Unsent text in the Ask bar. */
  ask: z.string().max(500).default(""),
});
export type ExperienceUiState = z.infer<typeof experienceUiStateSchema>;
export const emptyUiState = (): ExperienceUiState => ({ drafts: {}, selection: {}, revealed: [], dismissed: [], ask: "" });

export const experienceSummarySchema = z.strictObject({
  id: uuidSchema,
  title: label,
  kind: IntentKind,
  progress: intentSchema.shape.progress,
  primary: subjectRefSchema.nullable(),
  updatedAt: z.string().max(40),
});
export type ExperienceSummary = z.infer<typeof experienceSummarySchema>;

export const startExperienceRequestSchema = z.strictObject({ text: z.string().trim().min(1).max(500), subject: subjectRefSchema.nullable().default(null) });
export const askExperienceRequestSchema = z.strictObject({ text: z.string().trim().min(1).max(500), baseRevision: z.number().int().min(1) });
export const experienceEventRequestSchema = z.discriminatedUnion("kind", [
  /** A governed action finished through its own endpoint; the server re-reads what it names. */
  z.strictObject({ kind: z.literal("action_result"), action: nodeId, ref: subjectRefSchema.nullable(), outcome: z.enum(["done", "already", "blocked", "refused"]) }),
  /** The person chose a record offered by a RecordChoice or a table. */
  z.strictObject({ kind: z.literal("select"), ref: subjectRefSchema }),
  /** The person closed the detail of what they had selected. */
  z.strictObject({ kind: z.literal("deselect") }),
]);
export const saveUiStateRequestSchema = z.strictObject({ baseVersion: z.number().int().min(0), ui: experienceUiStateSchema });

export const experienceResponseSchema = z.strictObject({
  spec: experienceSpecSchema,
  ui: experienceUiStateSchema,
  uiVersion: z.number().int().min(0),
  /** When asking inside one experience opened another, the browser moves to it (Back returns). */
  redirect: uuidSchema.nullable().default(null),
});
export type ExperienceResponse = z.infer<typeof experienceResponseSchema>;
export const experienceListResponseSchema = z.strictObject({ items: z.array(experienceSummarySchema).max(50) });
export const saveUiStateResponseSchema = z.strictObject({ uiVersion: z.number().int().min(0), ui: experienceUiStateSchema, conflict: z.boolean() });

/** Explore-policies parameters kept with the session (the portfolio's typed query, plus refinements). */
export const exploreParamsSchema = z.strictObject({
  from: day,
  to: day,
  windowLabel: short,
  classOfBusiness: z.string().max(100).nullable().default(null),
  overdueOnly: z.boolean().default(false),
  insurer: uuidSchema.nullable().default(null),
});
export type ExploreParams = z.infer<typeof exploreParamsSchema>;
