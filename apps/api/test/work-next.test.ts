import { describe, expect, it } from "vitest";
import { documentNext } from "../src/routes/documents.js";
import { workNext } from "../src/work/next.js";

const ID = "60000000-0000-4000-8000-000000000001";
const T = "2026-09-30T08:00:00Z";
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal work row for a pure function
const item = (over: Record<string, any> = {}): any => ({
  id: ID, organization_id: ID, title: "Renew Tausi motor", kind: "renewal", client_id: null, policy_period_id: null, insurer_id: null,
  class_of_business: null, owner_id: null, task_status: "needs_you", task_party: null, task_since: null, task_next_check: null,
  cover_status: null, cover_inception_at: null, money_status: null, reason: "Cover ends 31 Dec.", steps: [], exception: null,
  version: 1, created_at: T, updated_at: T, completed_at: null, deleted_at: null, ...over,
});

describe("next action on a work item, derived from the records (D-120)", () => {
  it("reads the step that is now: who holds it and what evidence it still lacks", () => {
    const n = workNext(item({
      task_status: "with_party", task_party: "CIC General", task_since: T, task_next_check: T,
      steps: [{ id: "terms", label: "Terms from CIC General", actor: "insurer", state: "now", guards: [], evidence: [{ kind: "document", label: "Renewal terms" }], actions: [], party: "CIC General", reason: null, recorded: [], runId: null }],
    }));
    expect(n).toMatchObject({ what: "Terms from CIC General", holder: "outside_party", party: "CIC General", since: T, checkAt: T, missing: ["Renewal terms"] });
  });

  it("reads the state the record's own derivation wrote (quotation, claim)", () => {
    const n = workNext(item({ kind: "new_business", required_action: "Chase CIC General for terms", evidence_needed: null, task_status: "with_party", task_party: "CIC General", task_since: T }));
    expect(n).toMatchObject({ what: "Chase CIC General for terms", holder: "outside_party", party: "CIC General" });
  });

  it("gives a kind-specific first move, never 'decide the first step'", () => {
    const n = workNext(item());
    expect(n.what).toBe("Request renewal terms from the insurer");
    expect(n.what).not.toMatch(/Decide the first step/);
    expect(workNext(item({ task_status: "done", completed_at: T })).holder).toBe("nobody");
  });
});

describe("next action on a document under review", () => {
  const doc = { id: ID, kind: "policy_schedule", filename: "schedule.pdf", mimeType: "application/pdf", byteSize: 1, pageCount: 1, extractionState: "extracted", extractionError: null, clientId: null, workItemId: null, createdAt: T } as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const field = (state: string): any => ({ id: ID, fieldKey: "policy_number", proposedValue: "P-1", correctedValue: null, state, condition: "inferred", page: 1, region: null, reviewedBy: null, reviewedAt: null });
  it("asks for review, then application, and stops on an identity conflict", () => {
    expect(documentNext(doc, [field("proposed")], null).what).toBe("Confirm the 1 value read from schedule.pdf");
    expect(documentNext(doc, [field("accepted")], null).stage).toBe("apply");
    expect(documentNext(doc, [field("accepted")], "It names another insured.").what).toBe("Resolve which client this document belongs to");
    expect(documentNext({ ...doc, extractionState: "failed", extractionError: "Unreadable" }, [], null).stage).toBe("read_failed");
  });
});
