import { describe, expect, it } from "vitest";
import { insurerStage, quotationNext, workStateFrom } from "../src/quotation/next.js";

const ID = "30000000-0000-4000-8000-000000000001";
const INS = "31000000-0000-4000-8000-000000000001";
const REQ = "32000000-0000-4000-8000-000000000001";
const T = "2026-09-30T08:00:00Z";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a minimal opportunity view for a pure function
const view = (over: Record<string, any> = {}): any => ({
  opportunity: { id: ID, title: "Motor fleet", closedAt: null, closedReason: null },
  client: { id: ID, name: "Kifaru Traders" },
  requirements: [],
  insurers: [],
  ...over,
});
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const insurer = (over: Record<string, any> = {}): any => {
  const base = { id: INS, insurerId: INS, insurerName: "CIC General", addedAt: T, removedAt: null, removedReason: null, request: null, response: null, ...over };
  return { ...base, ...insurerStage(base) };
};
const request = (over: Record<string, unknown> = {}) => ({ id: REQ, subject: "s", body: "b", preparedAt: T, preparedByName: null, approvedAt: null, approvedByName: null, sentAt: null, sentEmailMessageId: null, delivery: null, ...over });

describe("quotation next action, derived from the records", () => {
  it("walks the sequence in order, one step at a time", () => {
    const req = [{ id: ID, label: "Logbooks", required: true, suppliedAt: null }];
    // An outstanding requirement is named, but it does not stop choosing insurers or drafting.
    const first = quotationNext(view({ requirements: req }));
    expect(first.what).toBe("Choose the insurers to approach");
    expect(first.missing).toEqual(["At least one insurer", "Logbooks"]);
    expect(first.why).toMatch(/Still outstanding from the client: Logbooks — it does not stop this step, but it must be supplied before a request is delivered/);
    expect(quotationNext(view({ requirements: req, insurers: [insurer()] })).what).toBe("Prepare the request to CIC General");
    expect(quotationNext(view({ requirements: req, insurers: [insurer({ request: request() })] })).what).toBe("Review and approve the request to CIC General");
    // Approved and nothing delivered yet: now the requirement stands in front of delivery.
    const beforeDelivery = quotationNext(view({ requirements: req, insurers: [insurer({ request: request({ approvedAt: T }) })] }));
    expect(beforeDelivery).toMatchObject({ what: "Collect the outstanding requirement from the client before delivering", missing: ["Logbooks"], stage: "requirements" });
    expect(beforeDelivery.action?.name).toBe("supply_requirement");
    expect(quotationNext(view()).what).toBe("Choose the insurers to approach");
    expect(quotationNext(view({ insurers: [insurer()] })).what).toBe("Prepare the request to CIC General");
    expect(quotationNext(view({ insurers: [insurer({ request: request() })] })).what).toBe("Review and approve the request to CIC General");
    const approved = quotationNext(view({ insurers: [insurer({ request: request({ approvedAt: T }) })] }));
    expect(approved.what).toBe("Deliver the approved request to CIC General and record how");
    expect(approved.action?.name).toBe("record_delivery");
    const withIns = quotationNext(view({ insurers: [insurer({ request: request({ approvedAt: T, delivery: { method: "own_email", reference: "r", deliveredAt: T, recordedByName: null, evidenceDocumentId: null } }) })] }));
    expect(withIns).toMatchObject({ what: "Chase CIC General for terms", holder: "outside_party", party: "CIC General", since: T, checkAt: "2026-10-03T08:00:00.000Z" });
    expect(workStateFrom(withIns)).toMatchObject({ p_task_status: "with_party", p_task_party: "CIC General", p_task_since: T });
    const quoted = quotationNext(view({ insurers: [insurer({ response: { id: ID, outcome: "quoted" } })] }));
    expect(quoted.what).toBe("Review the terms from CIC General and compare them for the client");
    expect(quotationNext(view({ insurers: [insurer({ response: { id: ID, outcome: "declined" } })] })).stage).toBe("all_declined");
    expect(workStateFrom(quotationNext(view({ opportunity: { id: ID, title: "t", closedAt: T, closedReason: "Won" } }))).p_task_status).toBe("done");
  });

  it("never offers a generic first step once requirements and insurers exist", () => {
    const n = quotationNext(view({ requirements: [{ id: ID, label: "Logbooks", required: true, suppliedAt: T }], insurers: [insurer()] }));
    expect(n.what).not.toMatch(/Decide the first step/);
  });
});
