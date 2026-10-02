/**
 * The acceptance-test path, connected (D-134).
 *
 * A fresh client added with its contact, the contact corrected afterwards, and insurers added to
 * the client's quotation by name with a draft request to each — against real Postgres, real RLS,
 * the real `insurer_create` function and the real unique indexes. Nothing here sends anything:
 * every request stays a draft, unapproved and unsent, and the client requirement stays outstanding.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { AMINA, BETA, buildApp, caller, CIC, JUBILEE, newApiKey, ORG_A, OWNER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const tag = randomUUID().slice(0, 6);
const CLIENT_NAME = `UX TEST Karibu Logistics ${tag} Ltd`;

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-acceptance')`;
  app = buildApp(API_KEY);
});
afterAll(async () => {
  await sql.end();
});

describe("client and contact, connected", () => {
  let clientId = "";
  let contactId = "";

  it("a client created with a contact has that contact as its primary, read back from the database", async () => {
    const contact = { fullName: "UX TEST David Otieno", roleLabel: "Finance Manager", email: `david.otieno.${tag}@example.test` };
    const preview = await call(AMINA, "POST", "/clients", { name: CLIENT_NAME, kind: "corporate", preview: true, contact });
    expect(preview.body.writes).toContain(`Primary contact: UX TEST David Otieno · Finance Manager · ${contact.email}`);
    expect(preview.body.missing).toEqual(["Phone"]);
    const res = await call(AMINA, "POST", "/clients", { name: CLIENT_NAME, kind: "corporate", confirmNew: true, contact });
    expect(res.status).toBe(201);
    expect(res.body.contact.state).toBe("saved");
    clientId = res.body.file.client.id;
    contactId = res.body.contact.contactId;
    const space = await call(AMINA, "GET", `/clients/${clientId}/space`);
    expect(space.body.contacts).toEqual([expect.objectContaining({ id: contactId, fullName: "UX TEST David Otieno", roleLabel: "Finance Manager", email: contact.email, isPrimary: true })]);
    const [audit] = await sql`select new_state from audit_log where action = 'client_contact.created' and object_id = ${contactId}`;
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit!["new_state"])).not.toContain(contact.email);
    // The same create again finds the client and the contact; nothing is doubled.
    const again = await call(AMINA, "POST", "/clients", { name: CLIENT_NAME, kind: "corporate", confirmNew: true, contact });
    expect(again.body.outcome).toBe("already_on_file");
    expect(again.body.contact.state).toBe("already_on_file");
    const [{ n }] = await sql`select count(*)::int as n from client_contacts where client_id = ${clientId} and deleted_at is null` as unknown as [{ n: number }];
    expect(n).toBe(1);
  });

  it("the contact is corrected afterwards, audited, and the correction survives a fresh read", async () => {
    const res = await call(AMINA, "PATCH", `/contacts/${contactId}`, { phone: "+254 700 000 111", roleLabel: "Finance Director" });
    expect(res.status).toBe(200);
    const space = await call(AMINA, "GET", `/clients/${clientId}/space`);
    expect(space.body.contacts[0]).toMatchObject({ phone: "+254 700 000 111", roleLabel: "Finance Director" });
    const [audit] = await sql`select new_state, previous_state from audit_log where action = 'client_contact.updated' and object_id = ${contactId}`;
    expect(audit!["new_state"]).toMatchObject({ changed: ["role_label", "phone"] });
    expect(audit!["previous_state"]).toMatchObject({ role_label: "Finance Manager" });
  });

  it("another brokerage cannot read or change the contact", async () => {
    expect((await call(BETA, "PATCH", `/contacts/${contactId}`, { roleLabel: "x" })).status).toBe(404);
  });
});

describe("insurers and drafts on an existing quotation, connected", () => {
  let opportunityId = "";

  it("adds APA (new), CIC and Jubilee (on file) and prepares one unsent draft each; a retry writes nothing", async () => {
    const created = await call(AMINA, "POST", "/opportunities", {
      clientId: (await sql`select id from clients where name = ${CLIENT_NAME}`)[0]!["id"], title: `UX TEST comprehensive motor cover for five vehicles ${tag}`, classOfBusiness: "Commercial motor", requestKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    opportunityId = created.body.opportunityId;
    expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_requirement", label: "UX TEST: five vehicle values and logbooks" })).body.outcome).toBe("done");

    const apa = `APA Insurance ${tag}`;
    const res = await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "approach_insurers", insurers: [{ name: apa }, { name: "CIC" }, { name: "Jubilee" }], prepare: true });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe("done");
    expect(res.body.results).toEqual([
      expect.objectContaining({ insurerName: apa, newOnFile: true, approach: "added", request: "prepared" }),
      expect.objectContaining({ insurerId: CIC, newOnFile: false, approach: "added", request: "prepared" }),
      expect.objectContaining({ insurerId: JUBILEE, newOnFile: false, approach: "added", request: "prepared" }),
    ]);
    const reqs = await sql`select q.subject, q.body_text, q.approved_at, q.sent_at, oi.opportunity_id, oi.organization_id from quote_requests q join opportunity_insurers oi on oi.id = q.opportunity_insurer_id where q.opportunity_id = ${opportunityId}`;
    expect(reqs).toHaveLength(3);
    for (const r of reqs) {
      expect(r["approved_at"]).toBeNull();
      expect(r["sent_at"]).toBeNull();
      expect(r["opportunity_id"]).toBe(opportunityId);
      expect(r["organization_id"]).toBe(ORG_A);
      expect(r["subject"]).toBe(`Quotation request — ${CLIENT_NAME}, Commercial motor`);
      expect(r["body_text"]).toContain("To follow from the client (not yet supplied):\n- UX TEST: five vehicle values and logbooks");
    }
    const opp = res.body.opportunity;
    expect(opp.requirements.find((r: { label: string }) => r.label === "UX TEST: five vehicle values and logbooks").suppliedAt).toBeNull();
    expect(opp.next.what).toBe("Review and approve the request to 3 insurers");
    // The Work item carries the same next action.
    const [work] = await sql`select required_action, evidence_needed from work_items where id = ${opp.workItem.id}`;
    expect(work!["required_action"]).toBe("Review and approve the request to 3 insurers");
    expect(String(work!["evidence_needed"])).toContain("UX TEST: five vehicle values and logbooks");

    const again = await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "approach_insurers", insurers: [{ name: apa }, { name: "CIC" }, { name: "Jubilee" }], prepare: true });
    expect(again.body.outcome).toBe("already");
    const [{ n }] = await sql`select count(*)::int as n from quote_requests where opportunity_id = ${opportunityId}` as unknown as [{ n: number }];
    expect(n).toBe(3);
    const [{ m }] = await sql`select count(*)::int as m from insurers where organization_id = ${ORG_A} and name = ${apa}` as unknown as [{ m: number }];
    expect(m).toBe(1);
  });

  it("the drafts survive a fresh read, and a reply attaches to the right quote and insurer", async () => {
    const opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    expect(opp.insurers.every((i: { stage: string; request: { sentAt: string | null } }) => i.stage === "request_prepared" && i.request.sentAt === null)).toBe(true);
    const cic = opp.insurers.find((i: { insurerId: string }) => i.insurerId === CIC);
    const r = await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "record_response", opportunityInsurerId: cic.id, outcome: "declined", declineReason: "UX TEST: outside appetite", withoutRequest: true, sourceNote: "UX TEST simulated reply recorded for software testing." });
    expect(r.body.outcome).toBe("done");
    const [resp] = await sql`select opportunity_insurer_id, outcome from insurer_responses where opportunity_insurer_id = ${cic.id}`;
    expect(resp).toMatchObject({ opportunity_insurer_id: cic.id, outcome: "declined" });
  });

  it("an ambiguous name is refused with its matches and writes nothing", async () => {
    await sql`insert into insurers (organization_id, name) values (${ORG_A}, ${`Zeta One ${tag}`}), (${ORG_A}, ${`Zeta Two ${tag}`})`;
    const before = await sql`select count(*)::int as n from opportunity_insurers where opportunity_id = ${opportunityId}`;
    const res = await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "approach_insurers", insurers: [{ name: "Zeta" }], prepare: true });
    expect(res.body.outcome).toBe("blocked");
    expect(res.body.reason).toContain("matches");
    const after = await sql`select count(*)::int as n from opportunity_insurers where opportunity_id = ${opportunityId}`;
    expect(after[0]!["n"]).toBe(before[0]!["n"]);
  });
});
