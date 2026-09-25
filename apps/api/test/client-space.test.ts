/**
 * One client, assembled (D-083).
 *
 * What these lock:
 *   - every list is this brokerage's and this client's, never another's;
 *   - a premium is reported as recorded, with its source and whether a document backs it;
 *   - what does not exist is a named gap rather than a silence or a zero;
 *   - permissions come from the session, and a person without them is told, not hidden from.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const CLERK = { id: "a0000000-0000-4000-8000-000000000002", email: "clerk@acme-brokers.test" };
const ADMIN_ROLE = "30000000-0000-4000-8000-000000000001";
const READONLY_ROLE = "30000000-0000-4000-8000-000000000002";

const ACME = "20000000-0000-4000-8000-00000000000a";
const SOLO = "20000000-0000-4000-8000-00000000000b";
const BARE = "20000000-0000-4000-8000-00000000000c";
const THEIRS = "20000000-0000-4000-8000-00000000000d";
const INSURER = "21000000-0000-4000-8000-00000000000a";
const iso = "2026-09-05T09:00:00.000Z";

function membership(userId: string, roleId: string) {
  return {
    id: `60000000-0000-4000-8000-00000000000${userId.slice(-1)}`,
    organization_id: ORG,
    user_id: userId,
    is_owner: roleId === ADMIN_ROLE,
    status: "active",
    joined_at: iso,
    organization: { id: ORG, name: "Acme Brokers", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
    role: { id: roleId, key: roleId === ADMIN_ROLE ? "brokerage_admin" : "read_only", name: "R", description: null, is_system: true },
  };
}

/** Today, so a period can be made genuinely current without depending on the clock's date. */
const TODAY = new Date().toISOString().slice(0, 10);
const nextYear = `${Number(TODAY.slice(0, 4)) + 1}${TODAY.slice(4)}`;
const lastYear = `${Number(TODAY.slice(0, 4)) - 1}${TODAY.slice(4)}`;
/* The day before today, so the prior period is genuinely over rather than ending today. */
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA, "tok-clerk": CLERK },
    inserts: [],
    rpc: {},
    tables: {
      users: [
        { id: AMINA.id, email: AMINA.email, full_name: "Amina", display_name: "Amina", active_organization_id: ORG },
        { id: CLERK.id, email: CLERK.email, full_name: "Bahati", display_name: "Bahati", active_organization_id: ORG },
      ],
      organization_memberships: [membership(AMINA.id, ADMIN_ROLE), membership(CLERK.id, READONLY_ROLE)],
      role_permissions: [
        { role_id: ADMIN_ROLE, permission: { object_type: "client", verb: "edit" } },
        { role_id: ADMIN_ROLE, permission: { object_type: "document", verb: "create" } },
        { role_id: ADMIN_ROLE, permission: { object_type: "space", verb: "create" } },
      ],
      clients: [
        { id: ACME, organization_id: ORG, name: "Acme Ltd", kind: "corporate", file_status: "in_review", created_at: iso, deleted_at: null },
        { id: SOLO, organization_id: ORG, name: "Grace Otieno", kind: "individual", file_status: "cleared", created_at: iso, deleted_at: null },
        { id: BARE, organization_id: ORG, name: "Bare Holdings", kind: "corporate", file_status: "not_started", created_at: iso, deleted_at: null },
        { id: THEIRS, organization_id: OTHER_ORG, name: "Someone else's client", kind: "corporate", file_status: "cleared", created_at: iso, deleted_at: null },
      ],
      client_contacts: [
        { id: "22000000-0000-4000-8000-00000000000a", organization_id: ORG, client_id: ACME, full_name: "Wanjiku Kamau", role_label: "Finance manager", email: "w@acme.test", phone: "+254700000000", is_primary: true },
        { id: "22000000-0000-4000-8000-00000000000b", organization_id: ORG, client_id: ACME, full_name: "Peter Mwangi", role_label: "Operations", email: null, phone: null, is_primary: false },
        { id: "22000000-0000-4000-8000-00000000000c", organization_id: ORG, client_id: SOLO, full_name: "Grace Otieno", role_label: null, email: null, phone: "+254711111111", is_primary: true },
      ],
      insurers: [{ id: INSURER, organization_id: ORG, name: "Jubilee" }],
      policies: [
        { id: "23000000-0000-4000-8000-00000000000a", organization_id: ORG, client_id: ACME, insurer_id: INSURER, policy_number: "MOT-1188", class_of_business: "Motor", deleted_at: null },
        { id: "23000000-0000-4000-8000-00000000000b", organization_id: ORG, client_id: ACME, insurer_id: INSURER, policy_number: "FIR-2200", class_of_business: "Fire", deleted_at: null },
        { id: "23000000-0000-4000-8000-00000000000c", organization_id: ORG, client_id: SOLO, insurer_id: null, policy_number: null, class_of_business: "Personal accident", deleted_at: null },
        { id: "23000000-0000-4000-8000-00000000000z", organization_id: OTHER_ORG, client_id: THEIRS, insurer_id: null, policy_number: "NOT-YOURS", class_of_business: "Motor", deleted_at: null },
      ],
      policy_periods: [
        { id: "24000000-0000-4000-8000-00000000000a", organization_id: ORG, policy_id: "23000000-0000-4000-8000-00000000000a", period_start: TODAY, period_end: nextYear, premium_amount: "214500.00", premium_currency: "KES", premium_basis: "gross", commission_amount: "32175.00", premium_source: "document", premium_verified_at: iso, premium_evidence_document_id: "25000000-0000-4000-8000-00000000000a" },
        { id: "24000000-0000-4000-8000-00000000000b", organization_id: ORG, policy_id: "23000000-0000-4000-8000-00000000000a", period_start: lastYear, period_end: yesterday, premium_amount: "198000.00", premium_currency: "KES", premium_basis: "gross", commission_amount: null, premium_source: "import", premium_verified_at: null, premium_evidence_document_id: null },
        { id: "24000000-0000-4000-8000-00000000000c", organization_id: ORG, policy_id: "23000000-0000-4000-8000-00000000000b", period_start: TODAY, period_end: nextYear, premium_amount: null, premium_currency: null, premium_basis: null, commission_amount: null, premium_source: "manual", premium_verified_at: null, premium_evidence_document_id: null },
      ],
      work_items: [
        { id: "26000000-0000-4000-8000-00000000000a", organization_id: ORG, client_id: ACME, kind: "renewal", title: "Motor renewal", task_status: "with_party", task_party: "Jubilee", task_since: iso, owner_id: AMINA.id, completed_at: null, created_at: iso, deleted_at: null },
        { id: "26000000-0000-4000-8000-00000000000b", organization_id: ORG, client_id: ACME, kind: "claim", title: "Windscreen claim", task_status: "done", task_party: null, task_since: null, owner_id: null, completed_at: iso, created_at: iso, deleted_at: null },
        { id: "26000000-0000-4000-8000-00000000000z", organization_id: OTHER_ORG, client_id: THEIRS, kind: "renewal", title: "Not yours", task_status: "needs_you", task_party: null, task_since: null, owner_id: null, completed_at: null, created_at: iso, deleted_at: null },
      ],
      claims: [
        { id: "27000000-0000-4000-8000-00000000000a", organization_id: ORG, client_id: ACME, work_item_id: "26000000-0000-4000-8000-00000000000b", status: "registered", incident_on: "2026-08-01", incident_summary: "Windscreen broken", insurer_reference: "JUB-99", policy_id: "23000000-0000-4000-8000-00000000000a" },
      ],
      endorsements: [
        { id: "28000000-0000-4000-8000-00000000000a", organization_id: ORG, client_id: ACME, work_item_id: "26000000-0000-4000-8000-00000000000a", kind: "add_vehicle", status: "applied", effective_on: "2026-07-01", policy_id: "23000000-0000-4000-8000-00000000000a", created_at: iso },
      ],
      documents: [
        { id: "25000000-0000-4000-8000-00000000000a", organization_id: ORG, client_id: ACME, filename: "schedule.pdf", kind: "policy_schedule", extraction_state: "extracted", created_at: iso, deleted_at: null },
      ],
      email_threads: [
        { id: "29000000-0000-4000-8000-00000000000a", organization_id: ORG, client_id: ACME, subject: "Renewal terms", last_message_at: iso },
      ],
      email_messages: [
        { id: "2a000000-0000-4000-8000-00000000000a", organization_id: ORG, thread_id: "29000000-0000-4000-8000-00000000000a" },
        { id: "2a000000-0000-4000-8000-00000000000b", organization_id: ORG, thread_id: "29000000-0000-4000-8000-00000000000a" },
      ],
      client_file_documents: [
        { id: "2b000000-0000-4000-8000-00000000000a", organization_id: ORG, client_id: ACME, kind: "kra_pin", label: "KRA PIN certificate", received_at: null },
        { id: "2b000000-0000-4000-8000-00000000000b", organization_id: ORG, client_id: ACME, kind: "id", label: "Certificate of incorporation", received_at: iso },
      ],
      mailboxes: [],
      audit_log: [],
    },
  };
}

let db: FakeDb;
const silentMailer: Mailer = { sendInvitation: async () => {} };
const build = () =>
  createApp({
    logger: pino({ level: "silent" }),
    build: { version: "t", commit: "t" },
    supabase: fakeFactory(db),
    mailer: silentMailer,
    webBaseUrl: "http://localhost:5173",
    invitationTtlHours: 168,
    exposeAcceptUrl: true,
    executor: () => async () => {},
    bootToken: "t",
  });

beforeEach(() => {
  db = makeDb();
});

const amina = { Authorization: "Bearer tok-amina" };
const clerk = { Authorization: "Bearer tok-clerk" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();
const space = async (id: string, who = amina) => readJson(await build().request(`/clients/${id}/space`, { headers: who }));

describe("who may read it", () => {
  it("requires a session", async () => {
    expect((await build().request(`/clients/${ACME}/space`)).status).toBe(401);
  });

  it("refuses another brokerage's client", async () => {
    expect((await build().request(`/clients/${THEIRS}/space`, { headers: amina })).status).toBe(404);
  });

  it("refuses a client that does not exist", async () => {
    expect(
      (await build().request(`/clients/20000000-0000-4000-8000-0000000000ff/space`, { headers: amina })).status,
    ).toBe(404);
  });
});

describe("a company with several policies", () => {
  it("is named by its own name", async () => {
    const body = await space(ACME);
    expect(body.client).toMatchObject({ name: "Acme Ltd", kind: "corporate" });
    expect(JSON.stringify(body)).not.toMatch(/Client Space/);
  });

  it("carries every policy and period, newest first, with the insurer named", async () => {
    const body = await space(ACME);
    expect(body.policies).toHaveLength(2);
    const motor = body.policies.find((p: { policyNumber: string }) => p.policyNumber === "MOT-1188");
    expect(motor.insurerName).toBe("Jubilee");
    expect(motor.periods).toHaveLength(2);
    expect(motor.periods.filter((r: { current: boolean }) => r.current)).toHaveLength(1);
  });

  it("reports a premium as recorded, with where it came from and whether a document backs it", async () => {
    const body = await space(ACME);
    const motor = body.policies.find((p: { policyNumber: string }) => p.policyNumber === "MOT-1188");
    const verified = motor.periods.find((r: { premiumVerifiedAt: string | null }) => r.premiumVerifiedAt !== null);
    expect(verified).toMatchObject({ premiumAmount: "214500.00", premiumCurrency: "KES", premiumSource: "document" });
    expect(verified.premiumEvidenceDocumentId).not.toBeNull();

    const unverified = motor.periods.find((r: { premiumVerifiedAt: string | null }) => r.premiumVerifiedAt === null);
    expect(unverified).toMatchObject({ premiumSource: "import", premiumEvidenceDocumentId: null });
  });

  it("leaves a period with no premium empty rather than guessing one", async () => {
    const body = await space(ACME);
    const fire = body.policies.find((p: { policyNumber: string }) => p.policyNumber === "FIR-2200");
    expect(fire.periods[0]).toMatchObject({ premiumAmount: null, premiumCurrency: null, premiumBasis: null });
  });

  it("carries contacts, with the main one first and a missing address left null", async () => {
    const body = await space(ACME);
    expect(body.contacts).toHaveLength(2);
    expect(body.contacts[0]).toMatchObject({ fullName: "Wanjiku Kamau", isPrimary: true });
    expect(body.contacts.find((c: { fullName: string }) => c.fullName === "Peter Mwangi").email).toBeNull();
  });

  it("carries work, claims, endorsements, documents and email, each linked to its record", async () => {
    const body = await space(ACME);
    expect(body.work).toHaveLength(2);
    expect(body.work[0]).toMatchObject({ kind: "renewal", taskStatus: "with_party", taskParty: "Jubilee", ownerName: "Amina" });
    expect(body.claims[0]).toMatchObject({ status: "registered", workItemId: "26000000-0000-4000-8000-00000000000b" });
    expect(body.endorsements[0]).toMatchObject({ kind: "add_vehicle", status: "applied" });
    expect(body.documents[0]).toMatchObject({ filename: "schedule.pdf" });
    expect(body.threads[0]).toMatchObject({ subject: "Renewal terms", messageCount: 2 });
  });

  it("says what the compliance file is still waiting for", async () => {
    const body = await space(ACME);
    expect(body.fileMissing).toEqual(["KRA PIN certificate"]);
  });
});

describe("a person with one policy", () => {
  it("carries it, with no insurer where none is recorded", async () => {
    const body = await space(SOLO);
    expect(body.client).toMatchObject({ name: "Grace Otieno", kind: "individual" });
    expect(body.policies).toHaveLength(1);
    expect(body.policies[0]).toMatchObject({ policyNumber: null, insurerName: null, classOfBusiness: "Personal accident" });
  });

  it("carries the one contact, whose email is genuinely absent", async () => {
    const body = await space(SOLO);
    expect(body.contacts).toHaveLength(1);
    expect(body.contacts[0].email).toBeNull();
  });
});

describe("a client with nothing on file", () => {
  it("returns empty lists rather than inventing anything", async () => {
    const body = await space(BARE);
    expect(body.policies).toEqual([]);
    expect(body.contacts).toEqual([]);
    expect(body.work).toEqual([]);
    expect(body.claims).toEqual([]);
    expect(body.documents).toEqual([]);
    expect(body.threads).toEqual([]);
    expect(body.fileMissing).toEqual([]);
  });
});

describe("tenant isolation", () => {
  it("never mixes another brokerage's policies, work or clients into this one", async () => {
    const body = await space(ACME);
    const all = JSON.stringify(body);
    expect(all).not.toMatch(/NOT-YOURS/);
    expect(all).not.toMatch(/Not yours/);
    expect(all).not.toMatch(/Someone else/);
  });
});

describe("what a person may do", () => {
  it("resolves permissions from the session, not from the browser", async () => {
    expect((await space(ACME)).permissions).toEqual({
      canEditContacts: true,
      canUploadDocuments: true,
      canStartWork: true,
    });
  });

  it("says no to somebody whose role carries nothing, rather than hiding it", async () => {
    const body = await space(ACME, clerk);
    expect(body.permissions).toEqual({
      canEditContacts: false,
      canUploadDocuments: false,
      canStartWork: false,
    });
    // They can still read the client: refusal is about acting, not about looking.
    expect(body.client.name).toBe("Acme Ltd");
  });
});

describe("what does not exist yet", () => {
  it("is named, with the increment that builds it", async () => {
    const body = await space(ACME);
    const ids = body.gaps.map((g: { id: string }) => g.id);
    expect(ids).toContain("quotation");
    expect(ids).toContain("money");
    for (const gap of body.gaps) {
      expect(gap.reason.length).toBeGreaterThan(10);
      expect(gap.gap).toMatch(/^4[A-E]/);
    }
  });

  it("does not invent a balance", async () => {
    const body = await space(ACME);
    expect(body).not.toHaveProperty("balance");
    expect(body).not.toHaveProperty("outstanding");
  });
});

describe("email, honestly", () => {
  it("says whether a mailbox is connected, so no email can be told from no reading", async () => {
    expect((await space(ACME)).mailboxConnected).toBe(false);
    db.tables["mailboxes"] = [{ id: "m1", organization_id: ORG, status: "connected" }];
    expect((await space(ACME)).mailboxConnected).toBe(true);
  });
});
