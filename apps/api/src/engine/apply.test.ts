/**
 * Engine tests (UI Build Spec v1 Part 11): guards block; evidence advances; the task is derived
 * from the steps; exceptions need reasons; run titles never name a business outcome.
 */
import {
  BANNED_RUN_TITLE_PHRASES,
  RENEWAL_RUN_TITLES,
  deriveTask,
  renewalSteps,
  type ActRequest,
  type WorkItemRow,
} from "@asap/schema";
import { describe, expect, it } from "vitest";
import { advance, applyAction, evaluateGuard, runTitleFor } from "./apply.js";

const NOW = new Date("2026-09-08T10:00:00Z");
const CTX = { userId: "a0000000-0000-4000-8000-000000000002", now: NOW };

function item(over: Partial<WorkItemRow> = {}): WorkItemRow {
  const steps = renewalSteps({ clientName: "Acme Motors", insurers: ["Jubilee", "CIC"] });
  return {
    id: "30000000-0000-4000-8000-000000000010",
    organization_id: "10000000-0000-4000-8000-00000000000a",
    title: "Acme Motors — renewal",
    kind: "renewal",
    client_id: null,
    policy_period_id: null,
    insurer_id: null,
    class_of_business: null,
    owner_id: CTX.userId,
    task_status: "in_progress",
    task_party: null,
    task_since: null,
    task_next_check: null,
    cover_status: "active",
    cover_inception_at: null,
    money_status: null,
    reason: null,
    steps,
    exception: null,
    version: 1,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    completed_at: null,
    deleted_at: null,
    ...over,
  };
}

/** Moves the item to `stepId` being the current step, all earlier steps done. */
function at(stepId: string, over: Partial<WorkItemRow> = {}): WorkItemRow {
  const base = item(over);
  const idx = base.steps.findIndex((s) => s.id === stepId);
  const steps = base.steps.map((s, i) => ({
    ...s,
    state: i < idx ? ("done" as const) : i === idx ? ("now" as const) : ("todo" as const),
    recorded:
      i < idx && s.evidence.length > 0
        ? [
            {
              kind: s.evidence[0]!.kind,
              reference: "ref",
              recordedBy: CTX.userId,
              recordedAt: NOW.toISOString(),
            },
          ]
        : s.recorded,
  }));
  const task = deriveTask(steps);
  return {
    ...base,
    steps,
    task_status: task.status,
    task_party: task.party,
    task_since: task.status === "with_party" ? NOW.toISOString() : null,
  };
}

const req = (o: Partial<ActRequest> & Pick<ActRequest, "stepId" | "verb">): ActRequest => ({
  version: 1,
  ...o,
});

describe("guards block", () => {
  it("evidence_present blocks record_evidence without a reference and names what is wanted", () => {
    const r = applyAction(
      at("exposure"),
      req({ stepId: "exposure", verb: "record_evidence" }),
      CTX,
    );
    expect(r).toMatchObject({ kind: "blocked", guard: "evidence_present" });
    if (r.kind === "blocked") expect(r.reason).toMatch(/Acme Motors's confirmation/);
  });

  it("version_current blocks a stale version", () => {
    const r = applyAction(
      at("exposure"),
      req({ stepId: "exposure", verb: "record_evidence", evidence: "email 12 Sep", version: 0 }),
      CTX,
    );
    expect(r).toMatchObject({ kind: "blocked", guard: "version_current" });
  });

  it("a guard the product cannot evaluate blocks rather than passing", () => {
    const i = at("complete");
    expect(
      evaluateGuard("authority_sufficient", i, i.steps[0]!, req({ stepId: "x", verb: "approve" })),
    ).toMatchObject({ guard: "authority_sufficient" });
    expect(
      evaluateGuard(
        { id: "business_rule_exists", rule: "tor_meaning" },
        i,
        i.steps[0]!,
        req({ stepId: "x", verb: "prepare" }),
      ),
    ).toMatchObject({ guard: "business_rule_exists" });
  });

  it("complete is blocked while any step's evidence is missing", () => {
    const i = at("complete");
    const missing = {
      ...i,
      steps: i.steps.map((s) => (s.id === "instruction" ? { ...s, recorded: [] } : s)),
    };
    const r = applyAction(missing, req({ stepId: "complete", verb: "complete" }), CTX);
    expect(r).toMatchObject({ kind: "blocked", guard: "evidence_present" });
    if (r.kind === "blocked") expect(r.reason).toMatch(/instruction, dated/);
  });

  it("a verb that is not an action on the step is refused", () => {
    expect(
      applyAction(at("exposure"), req({ stepId: "exposure", verb: "approve" }), CTX),
    ).toMatchObject({ kind: "blocked" });
  });

  it("a closed item accepts nothing", () => {
    const closed = {
      ...at("complete"),
      task_status: "done" as const,
      completed_at: NOW.toISOString(),
    };
    expect(applyAction(closed, req({ stepId: "complete", verb: "complete" }), CTX)).toMatchObject({
      kind: "blocked",
    });
  });
});

describe("evidence advances and the task is derived", () => {
  it("recording the client's confirmation moves to requesting terms, which needs you", () => {
    const r = applyAction(
      at("exposure"),
      req({ stepId: "exposure", verb: "record_evidence", evidence: "Call note 8 Sep" }),
      CTX,
    );
    expect(r.kind).toBe("applied");
    if (r.kind !== "applied") return;
    expect(r.derived.steps.find((s) => s.id === "exposure")).toMatchObject({
      state: "done",
      recorded: [{ kind: "confirmation", reference: "Call note 8 Sep" }],
    });
    expect(r.derived.steps.find((s) => s.id === "request_terms")?.state).toBe("now");
    expect(r.derived.task).toMatchObject({ status: "needs_you", party: null });
  });

  it("recording a send moves the item to With <insurers> with a since date and a next check", () => {
    const r = applyAction(
      at("request_terms"),
      req({ stepId: "request_terms", verb: "record_send", evidence: "Sent folder message 42" }),
      CTX,
    );
    expect(r.kind).toBe("applied");
    if (r.kind !== "applied") return;
    expect(r.derived.task).toMatchObject({
      status: "with_party",
      party: "Jubilee, CIC",
      since: NOW.toISOString(),
    });
    expect(r.derived.task.nextCheck).toBe(new Date("2026-09-11T10:00:00Z").toISOString());
  });

  it("draft creates a draft addressed to the step's party and changes no step", () => {
    const r = applyAction(
      at("request_terms"),
      req({ stepId: "request_terms", verb: "draft", to: "Jubilee" }),
      CTX,
    );
    expect(r.kind).toBe("applied");
    if (r.kind !== "applied") return;
    expect(r.effects.createDraft).toMatchObject({
      stepId: "request_terms",
      to: "Jubilee",
      subject: "Acme Motors — renewal terms request",
    });
    expect(r.derived.steps).toEqual(at("request_terms").steps);
  });

  it("prepare starts a run whose title names the output", () => {
    const r = applyAction(at("review"), req({ stepId: "review", verb: "prepare" }), CTX);
    expect(r).toMatchObject({
      kind: "applied",
      effects: { startRun: { stepId: "review", title: RENEWAL_RUN_TITLES.review } },
    });
  });

  it("complete with every evidence recorded finishes the item", () => {
    const r = applyAction(at("complete"), req({ stepId: "complete", verb: "complete" }), CTX);
    expect(r.kind).toBe("applied");
    if (r.kind !== "applied") return;
    expect(r.derived.task.status).toBe("done");
    expect(r.derived.completedAt).toBe(NOW.toISOString());
    expect(r.derived.cover).toBe("active"); // completing never moves cover
  });
});

describe("the lapse path is loud", () => {
  it("a lapse needs a typed reason and proof the client was told", () => {
    const i = at("complete");
    expect(
      applyAction(
        i,
        req({
          stepId: "complete",
          verb: "exception",
          exceptionKind: "lapse",
          reason: "No instruction by expiry",
        }),
        CTX,
      ),
    ).toMatchObject({ kind: "blocked", guard: "evidence_present" });
    const r = applyAction(
      i,
      req({
        stepId: "complete",
        verb: "exception",
        exceptionKind: "lapse",
        reason: "No instruction by expiry",
        clientToldEvidence: "Letter 1 Sep",
      }),
      CTX,
    );
    expect(r.kind).toBe("applied");
    if (r.kind !== "applied") return;
    expect(r.derived.exception).toMatchObject({
      kind: "lapse",
      clientToldEvidence: "Letter 1 Sep",
    });
    expect(r.derived.cover).toBe("expired");
    expect(r.derived.task.status).toBe("done");
  });
});

describe("run titles", () => {
  it("never name a business outcome", () => {
    for (const title of [
      ...Object.values(RENEWAL_RUN_TITLES),
      ...renewalSteps({ clientName: "x", insurers: [] })
        .filter((s) => s.actor === "asap")
        .map(runTitleFor),
    ]) {
      for (const banned of BANNED_RUN_TITLE_PHRASES) expect(title, title).not.toMatch(banned);
    }
    expect("Policy renewed").toMatch(BANNED_RUN_TITLE_PHRASES[0]!);
  });

  it("advance marks done and promotes the next todo step", () => {
    const steps = renewalSteps({ clientName: "x", insurers: [] });
    const out = advance(steps, "file_check");
    expect(out[0]?.state).toBe("done");
    expect(out[1]?.state).toBe("now");
  });
});
