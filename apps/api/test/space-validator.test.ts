/**
 * The plan validator (D-059). Each test drives one of the ten rules with a plan that breaks it,
 * because a validator nobody has watched reject anything is not a validator.
 *
 * `component-registry.test.ts` covers the other half: that the JSON Schema stored in migration
 * 0031 is the same shape as the Zod definition in packages/schema.
 */
import {
  RENEWAL_SPACE_BLOCK_PROPS,
  propsJsonSchema,
  type SpaceBlock,
  type SpacePlan,
  type WorkItemRow,
} from "@asap/schema";
import { describe, expect, it } from "vitest";
import { validatePlan, type ComponentDefinition } from "../src/spaces/validate.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const RECORD = "30000000-0000-4000-8000-000000000001";
const iso = () => "2026-09-10T10:00:00.000Z";

const record: WorkItemRow = {
  id: RECORD,
  organization_id: ORG,
  title: "Acme Motors — renewal terms from Jubilee",
  kind: "renewal",
  client_id: null,
  policy_period_id: null,
  insurer_id: null,
  class_of_business: null,
  owner_id: null,
  task_status: "needs_you",
  task_party: null,
  task_since: null,
  task_next_check: null,
  cover_status: "active",
  cover_inception_at: null,
  money_status: null,
  reason: "Terms were requested from Jubilee five days ago.",
  steps: [
    {
      id: "request_terms",
      label: "Terms requested",
      actor: "you",
      state: "now",
      guards: [],
      evidence: [],
      actions: [
        { verb: "draft", label: "Draft the request", guards: [], disabledReason: null },
        {
          verb: "record_send",
          label: "I sent this",
          guards: ["evidence_present"],
          disabledReason: "Record what you sent first.",
        },
      ],
      party: null,
      reason: null,
      recorded: [],
      runId: null,
    },
  ],
  exception: null,
  version: 4,
  created_at: iso(),
  updated_at: iso(),
  completed_at: null,
  deleted_at: null,
};

/** The registry rows as migration 0031 seeds them, with the schemas generated from the same Zod. */
const definition = (
  id: keyof typeof RENEWAL_SPACE_BLOCK_PROPS,
  over: Partial<ComponentDefinition> = {},
): ComponentDefinition => ({
  component_id: id,
  version: 1,
  allowed_spaces: ["renewal"],
  required_permissions: [],
  can_contain_action: id === "RenewalReadiness" || id === "DraftEmail",
  requires_evidence:
    id === "PolicyCard" ||
    id === "InsurerResponseTracker" ||
    id === "TermComparison" ||
    id === "SourceEvidence",
  props_schema: propsJsonSchema(id),
  deprecated_at: null,
  ...over,
});

const DEFS = (
  Object.keys(RENEWAL_SPACE_BLOCK_PROPS) as (keyof typeof RENEWAL_SPACE_BLOCK_PROPS)[]
).map((id) => definition(id));

const focus: SpaceBlock = {
  component: "RenewalReadiness",
  version: 1,
  props: {
    eyebrow: "Next step",
    headline: "Ask Jubilee for the renewal terms",
    why: "Terms were requested five days ago and the check was due yesterday.",
    blockedBy: null,
    ready: ["Client file checked"],
    outstanding: ["Terms requested"],
  },
  evidence: [],
  actions: [],
};

const plan = (over: Partial<SpacePlan> = {}): unknown => ({
  spaceType: "renewal",
  view: "summary",
  recordId: RECORD,
  title: record.title,
  blocks: [focus],
  source: "recipe",
  suggestions: [],
  ...over,
});

const run = (p: unknown, over: Partial<Parameters<typeof validatePlan>[0]> = {}) =>
  validatePlan({
    plan: p,
    record,
    definitions: DEFS,
    permissions: new Set<string>(),
    ...over,
  });

const rules = (r: ReturnType<typeof validatePlan>) =>
  r.ok ? [] : [...new Set(r.failures.map((f) => f.rule))];

describe("the plan validator accepts a valid plan", () => {
  it("passes a plan built from the recipes", () => {
    const result = run(plan());
    expect(result.ok).toBe(true);
  });
});

describe("it rejects", () => {
  it("an unknown component", () => {
    // QuoteComparison is a real name in the library and is not in the registry yet.
    const r = run(plan({ blocks: [{ ...focus, component: "QuoteComparison" }] as SpaceBlock[] }));
    expect(rules(r)).toContain("unknown_component");
  });

  it("a component at a version the registry does not hold", () => {
    const r = run(plan({ blocks: [{ ...focus, version: 2 }] }));
    expect(rules(r)).toContain("unknown_component");
  });

  it("a deprecated component", () => {
    const r = run(plan(), {
      definitions: [definition("RenewalReadiness", { deprecated_at: iso() })],
    });
    expect(rules(r)).toContain("deprecated_component");
  });

  it("a component that is not allowed in this Space type", () => {
    const r = run(plan(), {
      definitions: [definition("RenewalReadiness", { allowed_spaces: ["claim"] })],
    });
    expect(rules(r)).toContain("component_not_allowed_here");
  });

  it("invalid properties: a missing one, a wrong type, and one that is not allowed at all", () => {
    const missing = run(
      plan({
        blocks: [{ ...focus, props: { eyebrow: "Next step", headline: "x", why: "y" } }],
      }),
    );
    expect(rules(missing)).toContain("invalid_props");

    const wrongType = run(plan({ blocks: [{ ...focus, props: { ...focus.props, ready: "one" } }] }));
    expect(rules(wrongType)).toContain("invalid_props");

    // The shape a model would use to smuggle a value in: an extra key.
    const extra = run(
      plan({ blocks: [{ ...focus, props: { ...focus.props, premium: "KSh 240,000" } }] }),
    );
    expect(rules(extra)).toContain("invalid_props");

    // A closed enum: the four task words and nothing else.
    const badEnum = run(
      plan({
        blocks: [
          {
            component: "ClientHeader",
            version: 1,
            props: {
              clientName: "Acme Motors",
              clientKind: "corporate",
              taskStatus: "waiting",
              taskParty: null,
              taskSince: null,
              fileStatus: null,
            },
            evidence: [],
            actions: [],
          },
        ],
      }),
    );
    expect(rules(badEnum)).toContain("invalid_props");
  });

  it("a record the caller cannot read, without revealing that it exists", () => {
    const r = run(plan(), { record: null });
    expect(rules(r)).toEqual(["record_unreadable"]);
    // One rule, one detail: nothing about the record's kind, title or blocks leaks out.
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failures).toHaveLength(1);
  });

  it("a plan that names a different record from the one that was read", () => {
    const r = run(plan({ recordId: "30000000-0000-4000-8000-0000000000ff" }));
    expect(rules(r)).toContain("record_mismatch");
  });

  it("an action on a block the registry does not let carry one", () => {
    const r = run(
      plan({
        blocks: [
          {
            component: "Checklist",
            version: 1,
            props: { items: [] },
            evidence: [],
            actions: [
              { verb: "complete", label: "Complete", stepId: "request_terms", disabledReason: null },
            ],
          },
        ],
      }),
    );
    expect(rules(r)).toContain("action_not_allowed");
  });

  it("an action on a step that does not exist, and one the step does not offer", () => {
    const noStep = run(
      plan({
        blocks: [
          {
            ...focus,
            actions: [
              { verb: "draft", label: "Draft", stepId: "invented_step", disabledReason: null },
            ],
          },
        ],
      }),
    );
    expect(rules(noStep)).toContain("unknown_step");

    const notOffered = run(
      plan({
        blocks: [
          {
            ...focus,
            actions: [
              { verb: "approve", label: "Approve", stepId: "request_terms", disabledReason: null },
            ],
          },
        ],
      }),
    );
    expect(rules(notOffered)).toContain("action_not_on_step");
  });

  it("an action the record says is blocked but the plan offers as available", () => {
    const r = run(
      plan({
        blocks: [
          {
            ...focus,
            actions: [
              { verb: "record_send", label: "I sent this", stepId: "request_terms", disabledReason: null },
            ],
          },
        ],
      }),
    );
    // The step carries "Record what you sent first." A plan may repeat a guard, never soften it.
    expect(rules(r)).toContain("action_unblocked");
  });

  it("a block the caller lacks the permission for, before it reaches the browser", () => {
    const r = run(plan(), {
      definitions: [definition("RenewalReadiness", { required_permissions: ["money:read"] })],
    });
    expect(rules(r)).toContain("permission_missing");
    // Held permission passes.
    expect(
      run(plan(), {
        definitions: [definition("RenewalReadiness", { required_permissions: ["money:read"] })],
        permissions: new Set(["money:read"]),
      }).ok,
    ).toBe(true);
  });

  it("a block that must cite a source and cites none", () => {
    const r = run(
      plan({
        blocks: [
          {
            component: "InsurerResponseTracker",
            version: 1,
            props: { insurers: [{ name: "Jubilee", state: "on_file", reference: "Email 42", recordedAt: null }] },
            evidence: [],
            actions: [],
          },
        ],
      }),
    );
    expect(rules(r)).toContain("evidence_missing");
  });

  it("invented progress or confidence, at any depth", () => {
    const top = run(
      plan({ blocks: [{ ...focus, props: { ...focus.props, progress: 60 } }] }),
    );
    // It fails as an unlisted property and as a derived fact: both rules are meant to catch it.
    expect(rules(top)).toContain("derived_fact_in_plan");

    const nested = run(
      plan({
        blocks: [
          {
            component: "Checklist",
            version: 1,
            props: {
              items: [
                { label: "Terms requested", state: "now", actor: "you", note: null, confidence: 0.8 },
              ],
            },
            evidence: [],
            actions: [],
          },
        ],
      }),
    );
    expect(rules(nested)).toContain("derived_fact_in_plan");
  });

  it("a money status carried as a fact in a plan", () => {
    const r = run(plan({ blocks: [{ ...focus, props: { ...focus.props, moneyStatus: "unpaid" } }] }));
    expect(rules(r)).toContain("derived_fact_in_plan");
  });

  it("more blocks than the limit", () => {
    const many = Array.from({ length: 9 }, () => focus);
    const r = run(plan({ blocks: many }));
    expect(rules(r)).toContain("shape");
  });

  it("a plan that is not a plan at all", () => {
    expect(rules(run({ hello: "world" }))).toEqual(["shape"]);
    expect(rules(run("<h1>hello</h1>"))).toEqual(["shape"]);
  });
});
