import { describe, expect, it } from "vitest";
import { EXPERIENCE_CONTRACT, subjectKey, validateExperienceSpec, type ASAPExperienceSpec, type LayoutNode } from "./experience-v2.js";

const CLIENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const r = { narrow: "keep" as const };
const slot = (id: string, instance: string): LayoutNode => ({ type: "slot", id, instance, priority: "primary", responsive: r });

function base(overrides: Partial<ASAPExperienceSpec> = {}): ASAPExperienceSpec {
  return {
    contract: EXPERIENCE_CONTRACT,
    experienceId: "33333333-3333-4333-8333-333333333333",
    revision: 1,
    composedAt: "2026-10-13T10:00:00Z",
    title: "Add a new client",
    intent: { kind: "create_client", expression: "Add a new client", understood: "Add a client", resolution: "resolved", interpretedBy: "rules", missing: [], progress: "waiting_input", directionChangedAt: null },
    context: { primary: null, related: [], permissions: {}, constraints: [], unresolved: [], unavailable: [] },
    layout: { type: "stack", id: "root", gap: "normal", priority: "primary", responsive: r, children: [slot("s-form", "form")] },
    components: [
      {
        instance: "form", component: "ProgressiveForm", version: 1, title: null, sources: [], continuity: ["draft"], hash: "h", actions: ["save"],
        props: { title: "New client", intro: null, fields: [{ name: "name", label: "Name", kind: "text", required: true, options: [], help: null, stage: 0, maxLength: 200 }], revealLabel: null, submit: "save", duplicates: [], error: null },
      },
    ],
    actions: [{ id: "save", label: "Add client", class: "mutate", payload: { kind: "client.create", form: "form" }, primary: true, confirm: null, disabledReason: null }],
    notices: [],
    withdrawn: [],
    ...overrides,
  };
}

describe("experience contract v2", () => {
  it("accepts a well-formed composition", () => {
    const v = validateExperienceSpec(base());
    expect(v.ok).toBe(true);
  });

  it("rejects an unregistered component", () => {
    const s = base();
    (s.components[0] as { component: string }).component = "HtmlBlock";
    expect(validateExperienceSpec(s).ok).toBe(false);
  });

  it("rejects an unregistered version", () => {
    const s = base();
    s.components[0]!.version = 7;
    const v = validateExperienceSpec(s);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues[0]!.message).toMatch(/not registered/);
  });

  it("rejects props outside the component's contract", () => {
    const s = base();
    s.components[0]!.props = { ...s.components[0]!.props, style: "color:red" };
    expect(validateExperienceSpec(s).ok).toBe(false);
  });

  it("rejects an unknown layout primitive and style values", () => {
    const s = base() as unknown as { layout: Record<string, unknown> };
    s.layout = { type: "html", id: "root", markup: "<div/>" };
    expect(validateExperienceSpec(s).ok).toBe(false);
  });

  it("bounds the depth of the layout tree", () => {
    let node: LayoutNode = slot("leaf", "form");
    for (let i = 0; i < 8; i++) node = { type: "stack", id: `n${i}`, gap: "normal", priority: "primary", responsive: r, children: [node] };
    const v = validateExperienceSpec(base({ layout: node }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.some((i) => /deeper/.test(i.message))).toBe(true);
  });

  it("requires every instance to be placed exactly once, and every slot to name an instance", () => {
    const twice = base({ layout: { type: "stack", id: "root", gap: "normal", priority: "primary", responsive: r, children: [slot("a", "form"), slot("b", "form")] } });
    expect(validateExperienceSpec(twice).ok).toBe(false);
    const ghost = base({ layout: { type: "stack", id: "root", gap: "normal", priority: "primary", responsive: r, children: [slot("a", "form"), slot("b", "ghost")] } });
    expect(validateExperienceSpec(ghost).ok).toBe(false);
  });

  it("rejects an action a component may not carry", () => {
    const s = base({
      actions: [
        { id: "save", label: "Add client", class: "mutate", payload: { kind: "client.create", form: "form" }, primary: true, confirm: null, disabledReason: null },
        { id: "go", label: "Approve", class: "mutate", payload: { kind: "approval.decide", approvalId: CLIENT, bundleSha256: "a".repeat(64), decision: "approve" }, primary: false, confirm: { heading: "Approve", effects: ["It is approved"] }, disabledReason: null },
      ],
    });
    s.components[0]!.actions = ["save", "go"];
    const v = validateExperienceSpec(s);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.issues.some((i) => /may not carry approval.decide/.test(i.message))).toBe(true);
  });

  it("rejects an action kind outside the closed set (no arbitrary endpoints)", () => {
    const s = base() as unknown as { actions: { payload: Record<string, unknown> }[] };
    s.actions[0]!.payload = { kind: "http.post", url: "/organizations/current/members" };
    expect(validateExperienceSpec(s).ok).toBe(false);
  });

  it("requires a confirmation on a protected business mutation", () => {
    const s = base({
      actions: [
        { id: "save", label: "Add client", class: "mutate", payload: { kind: "client.create", form: "form" }, primary: true, confirm: null, disabledReason: null },
        { id: "renew", label: "Start", class: "mutate", payload: { kind: "renewal.start", policyId: CLIENT }, primary: false, confirm: null, disabledReason: null },
      ],
    });
    const v = validateExperienceSpec(s);
    expect(v.ok).toBe(false);
  });

  it("rejects a class that misdescribes the payload", () => {
    const s = base();
    s.actions[0]!.class = "interface";
    expect(validateExperienceSpec(s).ok).toBe(false);
  });

  it("refuses records outside the authorized context", () => {
    const s = base({ context: { primary: { type: "client", id: OTHER, label: "Someone else" }, related: [], permissions: {}, constraints: [], unresolved: [], unavailable: [] } });
    expect(validateExperienceSpec(s, { authorizedRefs: new Set([subjectKey({ type: "client", id: CLIENT })]) }).ok).toBe(false);
    expect(validateExperienceSpec(s, { authorizedRefs: new Set([subjectKey({ type: "client", id: OTHER })]) }).ok).toBe(true);
  });

  it("finds references nested inside props", () => {
    const s = base();
    s.components[0]!.props = { ...s.components[0]!.props, duplicates: [{ ref: { type: "client", id: OTHER, label: "X" }, detail: null }] };
    expect(validateExperienceSpec(s, { authorizedRefs: new Set() }).ok).toBe(false);
  });

  it("rejects props naming an action the instance does not carry", () => {
    const s = base();
    s.components[0]!.props = { ...s.components[0]!.props, submit: "elsewhere" };
    expect(validateExperienceSpec(s).ok).toBe(false);
  });

  it("validates every primitive of the grammar", () => {
    const comps = ["a", "b", "c", "d", "e", "f", "g", "h"].map((id) => ({ instance: id, component: "Answer" as const, version: 1, title: null, sources: [], continuity: [], hash: id, actions: [], props: { question: null, text: "t", items: [], source: "records", refused: false } }));
    const layout: LayoutNode = {
      type: "dock", id: "root", side: "end", priority: "primary", responsive: r,
      main: {
        type: "focus", id: "focus", contextLabel: "Context", priority: "primary", responsive: r,
        primary: { type: "split", id: "split", ratio: "2:1", narrow: "stack", priority: "primary", responsive: r, children: [{ type: "table", id: "tbl", table: slot("sa", "a"), detail: slot("sb", "b"), priority: "primary", responsive: r }, { type: "flow", id: "flow", steps: [{ id: "one", label: "One", state: "current" }], current: slot("sc", "c"), priority: "primary", responsive: r }] },
        context: [{ type: "tabs", id: "tabs", active: "t1", priority: "secondary", responsive: { narrow: "collapse" }, tabs: [{ id: "t1", label: "One", child: slot("sd", "d") }, { id: "t2", label: "Two", child: slot("se", "e") }] }],
      },
      dock: { type: "overlay", id: "ov", title: null, base: { type: "grid", id: "grid", columns: 2, priority: "primary", responsive: r, children: [slot("sf", "f"), slot("sg", "g")] }, overlay: slot("sh", "h"), priority: "primary", responsive: r },
    };
    const v = validateExperienceSpec(base({ layout, components: comps, actions: [] }));
    expect(v.ok ? [] : v.issues).toEqual([]);
  });
});
