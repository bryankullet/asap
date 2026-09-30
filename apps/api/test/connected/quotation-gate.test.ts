/**
 * Quotation records, connected (4B-5 Part A).
 *
 * A signed-in person's own PostgREST session — exactly what a browser holding the anon key and the
 * person's JWT can do — cannot insert, update or delete any opportunity, quotation, response, term,
 * comparison, rule, revision or proposal record. The API, acting on the same person's behalf with
 * the server-held key, still can: every legitimate action below goes through the real routes.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, BETA, browser, buildApp, caller, CIC, JUBILEE, newApiKey, ORG_A, OWNER, READER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);

const PROTECTED = [
  "requirement_templates", "opportunities", "opportunity_requirements", "opportunity_insurers", "quote_requests",
  "insurer_responses", "quote_terms", "quote_request_approvals", "quote_comparisons", "quote_comparison_inputs",
  "quote_comparison_terms", "insurer_response_revisions", "quote_term_revisions", "company_rules",
  "company_rule_versions", "document_term_proposals",
];

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-quotation-gate')`;
  app = buildApp(API_KEY);
});
afterAll(async () => {
  await sql.end();
});

describe("quotation records through the API only, connected", () => {
  let opportunityId = "";
  const ids: Record<string, string> = {};

  it("the legitimate API actions still work, as the signed-in person in their own brokerage", async () => {
    const created = await call(AMINA, "POST", "/opportunities", {
      clientId: ACME, title: `Gate quotation — ${randomUUID().slice(0, 8)}`, classOfBusiness: "Commercial motor", requestKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    opportunityId = created.body.opportunityId;
    for (const insurerId of [JUBILEE, CIC]) {
      expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_insurer", insurerId })).body.outcome).toBe("done");
    }
    expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_requirement", label: "Vehicle schedule" })).body.outcome).toBe("done");
    let opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const jubilee = opp.insurers.find((i: { insurerId: string }) => i.insurerId === JUBILEE);
    expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, {
      action: "prepare_request", opportunityInsurerId: jubilee.id, subject: "Quotation request", body: "We invite terms for commercial motor cover.",
    })).body.outcome).toBe("done");
    opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const request = opp.insurers.find((i: { insurerId: string }) => i.insurerId === JUBILEE).request;
    expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "approve_request", quoteRequestId: request.id })).body.outcome).toBe("done");
    for (const [insurerId, premium] of [[JUBILEE, "5310000.00"], [CIC, "5620000.00"]] as const) {
      const oi = opp.insurers.find((i: { insurerId: string }) => i.insurerId === insurerId);
      expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, {
        action: "record_response", withoutRequest: true, opportunityInsurerId: oi.id, outcome: "quoted", receivedAt: "2026-09-05T09:00:00.000Z",
        premiumAmount: premium, premiumCurrency: "KES", validUntil: "2027-06-30", sourceNote: "Quotation letter received by email.",
      })).body.outcome).toBe("done");
    }
    opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    ids["response"] = opp.insurers.find((i: { insurerId: string }) => i.insurerId === JUBILEE).response.id;
    expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, {
      action: "record_term", insurerResponseId: ids["response"], termType: "excess", label: "Own damage", extractedValue: "5% min KES 30,000",
    })).body.outcome).toBe("done");
    opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const term = opp.insurers.find((i: { insurerId: string }) => i.insurerId === JUBILEE).response.terms[0];
    expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "correct_term", termId: term.id, correctedValue: "5% min KES 35,000" })).body.outcome).toBe("done");
    const generated = await call(AMINA, "POST", `/opportunities/${opportunityId}/comparison/actions`, { action: "generate_comparison" });
    expect(generated.body.outcome).toBe("done");
    expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/comparison/actions`, {
      action: "present_comparison", comparisonId: generated.body.comparison.comparison.id,
    })).body.outcome).toBe("done");
    const rule = await call(AMINA, "PUT", "/rules", {
      key: "quote.recommendation", value: { mode: "cheapest_when_like_for_like", minimumGapPercent: 8 },
      source: "Partners meeting, 4 September 2026.", verifiedAt: "2026-09-04",
    });
    expect(rule.status).toBeLessThan(300);

    /* The writes carry the person's identity and brokerage, and are audited. */
    const [row] = await sql<{ created_by: string; organization_id: string }[]>`select created_by, organization_id from opportunities where id = ${opportunityId}`;
    expect(row).toEqual({ created_by: AMINA.id, organization_id: ORG_A });
    const [revisions] = await sql<{ n: number }[]>`select count(*)::int as n from quote_term_revisions where quote_term_id = ${term.id}`;
    expect(revisions!.n).toBe(2);
    const [audits] = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where organization_id = ${ORG_A} and actor_user_id = ${AMINA.id} and object_id = ${opportunityId}`;
    expect(audits!.n).toBeGreaterThan(0);
  });

  it("a browser session can still read its own rows", async () => {
    for (const table of ["opportunities", "insurer_responses", "quote_terms", "quote_comparisons", "insurer_response_revisions", "company_rules"]) {
      const res = await browser(AMINA, "GET", `${table}?select=id&organization_id=eq.${ORG_A}&limit=1`);
      expect(res.status, table).toBe(200);
      expect(res.body.length, table).toBe(1);
    }
  });

  it("a browser session cannot insert into any of the sixteen tables", async () => {
    for (const table of PROTECTED) {
      const res = await browser(AMINA, "POST", table, { organization_id: ORG_A });
      expect(res.status, table).toBe(403);
      expect(JSON.stringify(res.body), table).toMatch(/api_only/);
    }
  });

  it("nor update a row it can see, nor delete one", async () => {
    const before = await sql`select title, updated_at from opportunities where id = ${opportunityId}`;
    let refusedOnVisibleRows = 0;
    for (const table of PROTECTED) {
      const visible = (await browser(AMINA, "GET", `${table}?select=id&organization_id=eq.${ORG_A}`)).body.length as number;
      const patched = await browser(AMINA, "PATCH", `${table}?organization_id=eq.${ORG_A}`, { organization_id: ORG_A });
      const deleted = await browser(AMINA, "DELETE", `${table}?organization_id=eq.${ORG_A}`);
      /* No browser role holds DELETE at all: refused whether or not a row matches. */
      expect(deleted.status, `${table} delete`).toBe(403);
      if (visible > 0) {
        expect(patched.status, `${table} update`).toBe(403);
        refusedOnVisibleRows += 1;
      } else {
        /* Nothing this brokerage can see in it here; pgTAP 0330 proves the refusal on a visible row. */
        expect(patched.body ?? [], `${table} update`).toEqual([]);
      }
    }
    expect(refusedOnVisibleRows).toBeGreaterThanOrEqual(12);
    /* A forged "approval" straight through PostgREST changes nothing. */
    const forged = await browser(AMINA, "PATCH", `opportunities?id=eq.${opportunityId}`, { title: "Forged" });
    expect(forged.status).toBe(403);
    expect(await sql`select title, updated_at from opportunities where id = ${opportunityId}`).toEqual(before);
  });

  it("anon can do nothing, and a read-only member cannot write even through the API", async () => {
    for (const table of PROTECTED) {
      const res = await browser("anon", "POST", table, { organization_id: ORG_A });
      expect(res.status, table).toBeGreaterThanOrEqual(401);
    }
    const refused = await call(READER, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_requirement", label: "Driver list" });
    expect(refused.body.outcome ?? refused.status).not.toBe("done");
  });

  it("another brokerage sees none of it, directly or through the API", async () => {
    for (const table of PROTECTED) {
      const res = await browser(BETA, "GET", `${table}?select=id&organization_id=eq.${ORG_A}`);
      expect(res.status, table).toBe(200);
      expect(res.body, table).toEqual([]);
    }
    expect((await call(BETA, "GET", `/opportunities/${opportunityId}`)).status).toBe(404);
  });
});
