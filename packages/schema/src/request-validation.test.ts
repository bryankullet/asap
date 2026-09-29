import { describe, expect, it } from "vitest";
import { createClientRequestSchema } from "./api/compliance.js";
import { createOpportunityRequestSchema, opportunityActionSchema } from "./api/opportunities.js";
import { createWorkItemRequestSchema } from "./api/work.js";

/* The server refuses what is not a real value, rather than storing it or replacing it (live retest). */
const CLIENT = "20000000-0000-4000-8000-00000000000a";
const POLICY = "23000000-0000-4000-8000-00000000000a";

describe("request validation", () => {
  it("a claim names its policy, or says in so many words that it is not known", () => {
    const base = { kind: "claim", clientId: CLIENT, incidentOn: "2026-09-20", incidentSummary: "Rear-ended at Westlands" };
    expect(createWorkItemRequestSchema.safeParse(base).success).toBe(false);
    expect(createWorkItemRequestSchema.safeParse({ ...base, policyId: POLICY }).success).toBe(true);
    expect(createWorkItemRequestSchema.safeParse({ ...base, policyUnknown: true }).success).toBe(true);
  });

  it("a client is a company or a person, with a real name", () => {
    expect(createClientRequestSchema.safeParse({ name: "A", kind: "corporate" }).success).toBe(false);
    expect(createClientRequestSchema.safeParse({ name: "Simba Traders", kind: "banana" }).success).toBe(false);
    expect(createClientRequestSchema.safeParse({ name: "Simba Traders", kind: "corporate" }).success).toBe(true);
  });

  it("quotation work and requirements are described, not a letter", () => {
    const base = { clientId: CLIENT, requestKey: POLICY };
    expect(createOpportunityRequestSchema.safeParse({ ...base, title: "x", classOfBusiness: "Motor" }).success).toBe(false);
    expect(createOpportunityRequestSchema.safeParse({ ...base, title: "Motor fleet", classOfBusiness: "Motor" }).success).toBe(true);
    expect(opportunityActionSchema.safeParse({ action: "add_requirement", label: "x" }).success).toBe(false);
  });
});
