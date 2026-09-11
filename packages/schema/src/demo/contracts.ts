import { z } from "zod";

/**
 * The approved demo's fictional brokerage, as contracts (D-064).
 *
 * Two rules govern this directory:
 *
 *  1. **No client name ever appears inside a reusable component.** Acme, Karibu, Bluewave,
 *     GreenCare, Mara Foods and Northstar live here as fixture data and reach the UI through these
 *     contracts. A component that hardcoded "Acme" would stop being a component.
 *  2. **Everything here is fictional and says so.** `DEMO_NOTICE` is rendered wherever demo data
 *     is shown. The demo must never be mistaken for a brokerage's real book, and a simulated send
 *     must never read as a delivered email.
 */

export const DEMO_NOTICE =
  "Demonstration data. These clients, policies, claims and messages are fictional.";

export const DemoEvidenceState = z.enum([
  "known",
  "inferred",
  "conflicting",
  "missing",
  "stale",
  "waiting",
]);
export type DemoEvidenceState = z.infer<typeof DemoEvidenceState>;

/** A client in the fictional book. */
export const demoClientSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string(),
  initials: z.string(),
  sector: z.string(),
  /** What this client is in the demo to demonstrate. Shown on the client's own context. */
  demonstrates: z.array(z.string()),
});
export type DemoClient = z.infer<typeof demoClientSchema>;

export const demoPolicySchema = z.object({
  id: z.string(),
  clientId: z.string(),
  name: z.string(),
  policyNumber: z.string(),
  insurer: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.string(),
  /** Plain-language facts. Never computed in a component: the fixture is the source. */
  facts: z.array(z.tuple([z.string(), z.string()])),
});
export type DemoPolicy = z.infer<typeof demoPolicySchema>;

/** One row of a Work panel's evidence table: the source, what it says, and how well it is known. */
export const demoEvidenceRowSchema = z.object({
  source: z.string(),
  finding: z.string(),
  state: DemoEvidenceState,
  freshness: z.string(),
});

/** The generated Work panel that accompanies an Ask answer. */
export const demoPanelSchema = z.object({
  type: z.string(),
  title: z.string(),
  desc: z.string(),
  facts: z.array(z.tuple([z.string(), z.string()])).default([]),
  /** [tone, text, meta] — tone is "red" | "green" | "" as the approved demo uses it. */
  issues: z.array(z.tuple([z.string(), z.string(), z.string()])).default([]),
  actions: z.array(z.string()).default([]),
  /** Shown when a request must not be mistaken for a confirmation. */
  warning: z.string().nullable().default(null),
  evidence: z.array(demoEvidenceRowSchema).default([]),
  /**
   * A prepared message. Preparing is not sending: the draft carries no provider id and no sent
   * state, and the surface that shows it says so.
   */
  draft: z
    .object({ to: z.string().nullable(), subject: z.string().nullable(), body: z.string() })
    .nullable()
    .default(null),
  timeline: z.array(z.tuple([z.string(), z.string()])).default([]),
  /** A shown calculation: [label, value] rows a person can check line by line. */
  calc: z.array(z.tuple([z.string(), z.string()])).default([]),
  /** A side-by-side comparison: [what, how it differs]. */
  diff: z.array(z.tuple([z.string(), z.string()])).default([]),
});
export type DemoPanel = z.infer<typeof demoPanelSchema>;

/**
 * One scenario: what a person asked, what ASAP answered, and the panel it generated.
 *
 * `lead` is the one-sentence answer; `text` is the reasoning. Neither ever asserts a status, a
 * cover outcome or an approval — the same rule that governs a real Ask answer (§45 rules 10, 12).
 */
/**
 * The record Ask is working in, as the approved demo's policy strip shows it: who the client is,
 * which policy or opportunity, its reference, insurer and period, and three headline facts.
 *
 * It is fixture data, per scenario, so no component ever names a client (D-064).
 */
export const demoContextSchema = z.object({
  initials: z.string(),
  client: z.string(),
  title: z.string(),
  number: z.string(),
  insurer: z.string(),
  period: z.string(),
  facts: z.array(z.tuple([z.string(), z.string()])),
});
export type DemoContext = z.infer<typeof demoContextSchema>;

export const demoScenarioSchema = z.object({
  id: z.string(),
  name: z.string(),
  group: z.string(),
  /** Which client this scenario is about, so the context chip and actions follow it. */
  clientId: z.string().nullable(),
  ask: z.string(),
  lead: z.string(),
  text: z.string(),
  suggest: z.array(z.string()),
  /** The policy strip's contents for this scenario. */
  context: demoContextSchema,
  panel: demoPanelSchema,
});
export type DemoScenario = z.infer<typeof demoScenarioSchema>;

export const DemoWorkState = z.enum(["active", "waiting", "review", "completed"]);
export type DemoWorkState = z.infer<typeof DemoWorkState>;

export const demoWorkSchema = z.object({
  id: z.string(),
  title: z.string(),
  clientId: z.string(),
  state: DemoWorkState,
  /** Why it is in that state, in words. A state with no reason is not a state a person can act on. */
  reason: z.string(),
  /** The scenario this Work opens into, so every item leads somewhere. */
  scenarioId: z.string(),
  owner: z.string(),
  updatedAt: z.string(),
  /** Jobs ASAP has run against this item. */
  jobIds: z.array(z.string()).default([]),
  history: z.array(z.tuple([z.string(), z.string()])).default([]),
});
export type DemoWork = z.infer<typeof demoWorkSchema>;

/**
 * What ASAP is processing. A separate vocabulary from Work's on purpose: a finished Job means ASAP
 * produced an output, never that a policy renewed, a claim was accepted or money arrived.
 */
export const DemoJobState = z.enum(["running", "waiting", "needs_human", "completed", "failed"]);
export type DemoJobState = z.infer<typeof DemoJobState>;

export const demoJobSchema = z.object({
  id: z.string(),
  title: z.string(),
  clientId: z.string().nullable(),
  state: DemoJobState,
  /** Outcome-specific language: "comparison prepared", never "policy renewed". */
  outcome: z.string(),
  startedAt: z.string(),
  steps: z.array(z.object({ label: z.string(), state: z.enum(["done", "now", "todo", "failed"]) })),
  workId: z.string().nullable(),
});
export type DemoJob = z.infer<typeof demoJobSchema>;

export const demoAutomationSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  trigger: z.string(),
  conditions: z.array(z.string()),
  skills: z.array(z.string()),
  preparedAction: z.string(),
  approval: z.string(),
  exceptionHandling: z.string(),
  lastTest: z.string(),
  runs: z.array(z.object({ at: z.string(), outcome: z.string(), detail: z.string() })),
});
export type DemoAutomation = z.infer<typeof demoAutomationSchema>;

export const DemoSearchKind = z.enum([
  "client",
  "policy",
  "claim",
  "work",
  "job",
  "document",
  "email",
  "analysis",
]);
export type DemoSearchKind = z.infer<typeof DemoSearchKind>;

export const demoSearchRecordSchema = z.object({
  id: z.string(),
  kind: DemoSearchKind,
  title: z.string(),
  subtitle: z.string(),
  /** Where opening it goes. Never a dead result. */
  to: z.string(),
});
export type DemoSearchRecord = z.infer<typeof demoSearchRecordSchema>;

export const demoEmailMessageSchema = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  at: z.string(),
  body: z.string(),
  direction: z.enum(["inbound", "outbound"]),
});

export const demoThreadSchema = z.object({
  id: z.string(),
  subject: z.string(),
  clientId: z.string().nullable(),
  counterparty: z.string(),
  messages: z.array(demoEmailMessageSchema),
});
export type DemoThread = z.infer<typeof demoThreadSchema>;

export const demoDocumentSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  name: z.string(),
  kind: z.string(),
  pages: z.number().int(),
  /** The field the demo highlights, with its page and state. */
  highlight: z.object({
    field: z.string(),
    value: z.string(),
    page: z.number().int(),
    state: DemoEvidenceState,
  }),
});
export type DemoDocument = z.infer<typeof demoDocumentSchema>;
