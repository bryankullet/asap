/**
 * Phase 4 guards (Screen Map v3 Part 4.1, 4.2): client_file_cleared blocks approval with a reason
 * and a link to K02; only the brokerage administrator can override, with a typed reason, and the
 * override is an effect the database audits; agreed_rate_exists counts confirmed rates only.
 */
import { placementSteps, type ActRequest, type WorkItemRow } from "@asap/schema";
import { describe, expect, it } from "vitest";
import { applyAction, evaluateGuard, type GuardFacts } from "./apply.js";

const NOW = new Date("2026-09-09T10:00:00Z");
const AE = {
  userId: "a0000000-0000-4000-8000-000000000002",
  now: NOW,
  roleKey: "account_executive",
};
const ADMIN = {
  userId: "a0000000-0000-4000-8000-000000000001",
  now: NOW,
  roleKey: "brokerage_admin",
};
const CLIENT = "70000000-0000-4000-8000-00000000000a";

function placement(): WorkItemRow {
  const steps = placementSteps({
    clientName: "Acme Motors",
    insurer: "Jubilee",
    classOfBusiness: "Motor commercial",
  }).map((s, i) => ({
    ...s,
    state: i === 0 ? ("done" as const) : i === 1 ? ("now" as const) : ("todo" as const),
  }));
  return {
    id: "30000000-0000-4000-8000-000000000005",
    organization_id: "10000000-0000-4000-8000-00000000000a",
    title: "Acme Motors — Motor commercial placement with Jubilee",
    kind: "placement",
    client_id: CLIENT,
    policy_period_id: null,
    insurer_id: "60000000-0000-4000-8000-00000000000a",
    class_of_business: "Motor commercial",
    owner_id: AE.userId,
    task_status: "needs_you",
    task_party: null,
    task_since: null,
    task_next_check: null,
    cover_status: "requested",
    cover_inception_at: null,
    money_status: null,
    reason: null,
    steps,
    exception: null,
    version: 3,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    completed_at: null,
    deleted_at: null,
  };
}
const approve = (over: Partial<ActRequest> = {}): ActRequest => ({
  stepId: "approve",
  verb: "approve",
  version: 3,
  ...over,
});
const facts = (
  state: GuardFacts["clientFileState"],
  rate: GuardFacts["agreedRate"] = undefined,
): GuardFacts => ({ clientFileState: state, agreedRate: rate, clientId: CLIENT });

describe("the placement gate at X01", () => {
  it.each(["not_started", "incomplete", "in_review", "refresh_due"] as const)(
    "blocks approval while the file is %s, as a reason with a link to the file",
    (state) => {
      const r = applyAction(placement(), approve(), AE, facts(state));
      expect(r).toMatchObject({ kind: "blocked", guard: "client_file_cleared" });
      if (r.kind === "blocked") {
        expect(r.reason).toMatch(
          /We cannot instruct cover for a client whose file is not complete/,
        );
        expect(r.reason).toContain(`/files/${CLIENT}`);
      }
    },
  );

  it("blocks when the item has no client at all", () => {
    expect(
      applyAction({ ...placement(), client_id: null }, approve(), AE, {
        clientFileState: null,
        agreedRate: undefined,
      }),
    ).toMatchObject({ kind: "blocked", guard: "client_file_cleared" });
  });

  it("approves a cleared file, recording the approval as evidence and moving to instruction", () => {
    const r = applyAction(placement(), approve(), AE, facts("cleared"));
    expect(r.kind).toBe("applied");
    if (r.kind !== "applied") return;
    expect(r.effects).toEqual({ approve: true });
    expect(r.derived.steps.find((s) => s.id === "approve")).toMatchObject({
      state: "done",
      recorded: [{ kind: "approval" }],
    });
    expect(r.derived.steps.find((s) => s.id === "instruct")?.state).toBe("now");
  });

  it("an account executive cannot override, even with a reason", () => {
    const r = applyAction(
      placement(),
      approve({ override: { reason: "Known client" } }),
      AE,
      facts("incomplete"),
    );
    expect(r).toMatchObject({ kind: "blocked", guard: "client_file_cleared" });
    if (r.kind === "blocked") expect(r.reason).toMatch(/principal officer/);
  });

  it("the brokerage administrator can override with a typed reason, and the override is an audited effect", () => {
    const r = applyAction(
      placement(),
      approve({ override: { reason: "Documents in the post; cover needed today" } }),
      ADMIN,
      facts("incomplete"),
    );
    expect(r.kind).toBe("applied");
    if (r.kind !== "applied") return;
    expect(r.effects).toEqual({
      approveWithOverride: { reason: "Documents in the post; cover needed today" },
    });
    expect(r.auditAction).toBe("placement.approved.override");
    expect(r.derived.steps.find((s) => s.id === "approve")?.recorded[0]?.reference).toMatch(
      /override/,
    );
  });

  it("an override without a reason is just a blocked approval", () => {
    expect(
      applyAction(placement(), approve({ override: { reason: "  " } }), ADMIN, facts("incomplete")),
    ).toMatchObject({ kind: "blocked" });
  });

  it("a stale version blocks before the gate is even considered", () => {
    expect(
      applyAction(placement(), approve({ version: 1 }), ADMIN, facts("cleared")),
    ).toMatchObject({ kind: "blocked", guard: "version_current" });
  });
});

describe("agreed_rate_exists", () => {
  const item = placement();
  const step = item.steps[0]!;
  const req = approve();
  it("passes only with a confirmed rate", () => {
    expect(
      evaluateGuard(
        "agreed_rate_exists",
        item,
        step,
        req,
        facts("cleared", {
          rate_basis_points: 1250,
          clause_reference: "4.2",
          version: 1,
          effective_from: "2026-01-01",
        }),
      ),
    ).toBeNull();
  });
  it("names the missing rate when none is confirmed", () => {
    expect(
      evaluateGuard("agreed_rate_exists", item, step, req, facts("cleared", null)),
    ).toMatchObject({ reason: "No agreed rate on file for this class." });
  });
  it("says so when the item has no insurer and class", () => {
    expect(
      evaluateGuard("agreed_rate_exists", item, step, req, facts("cleared", undefined))?.reason,
    ).toMatch(/No insurer and class/);
  });
});

describe("cover", () => {
  it("moves to Confirmed only on the insurer's written confirmation, and inception is a date", () => {
    const i = placement();
    const at = (id: string) => ({
      ...i,
      steps: i.steps.map((s) => ({
        ...s,
        state:
          s.id === id
            ? ("now" as const)
            : i.steps.findIndex((x) => x.id === s.id) < i.steps.findIndex((x) => x.id === id)
              ? ("done" as const)
              : ("todo" as const),
      })),
    });
    const r = applyAction(
      at("cover_confirmed"),
      {
        stepId: "cover_confirmed",
        verb: "record_evidence",
        version: 3,
        evidence: "Cover note CN-1",
        inceptionAt: "2026-10-01T00:00:00Z",
      },
      AE,
      facts("cleared"),
    );
    expect(r.kind).toBe("applied");
    if (r.kind === "applied") expect(r.derived.cover).toBe("confirmed");
  });
});
