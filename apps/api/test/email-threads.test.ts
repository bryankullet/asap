/**
 * One conversation, in full (D-078).
 *
 * The rules this route exists to keep, each of which is easy to lose to a convenience:
 *   - the reply being written is a server row, so two conversations keep two;
 *   - an approval is of one exact body, and editing the reply clears it — decided here, not in
 *     the browser;
 *   - a link is only ever written by a person, and only to a record of their own brokerage;
 *   - nothing is described as sendable while this deployment has no send path.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const MAILBOX = "80000000-0000-4000-8000-000000000001";
const THREAD_A = "81000000-0000-4000-8000-00000000000a";
const THREAD_B = "81000000-0000-4000-8000-00000000000b";
const CLIENT = "82000000-0000-4000-8000-00000000000a";
const OTHER_CLIENT = "82000000-0000-4000-8000-00000000000b";
const iso = "2026-09-05T09:00:00.000Z";

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA },
    inserts: [],
    rpc: {},
    tables: {
      users: [
        { id: AMINA.id, email: AMINA.email, full_name: "Amina", display_name: "Amina", active_organization_id: ORG },
      ],
      organization_memberships: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          user_id: AMINA.id,
          is_owner: true,
          status: "active",
          joined_at: iso,
          organization: { id: ORG, name: "Acme", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
          role: { id: "30000000-0000-4000-8000-000000000001", key: "brokerage_admin", name: "Admin", description: null, is_system: true },
        },
      ],
      role_permissions: [
        { role_id: "30000000-0000-4000-8000-000000000001", permission: { object_type: "email", verb: "edit" } },
        { role_id: "30000000-0000-4000-8000-000000000001", permission: { object_type: "email", verb: "approve" } },
      ],
      mailboxes: [
        {
          id: MAILBOX,
          organization_id: ORG,
          provider: "gmail",
          email_address: "broking@acme-brokers.test",
          display_name: "Acme broking",
          connected_by: AMINA.id,
          status: "connected",
          status_reason: null,
          last_synced_at: null,
          created_at: iso,
          updated_at: iso,
        },
      ],
      email_threads: [
        {
          id: THREAD_A,
          organization_id: ORG,
          mailbox_id: MAILBOX,
          provider_thread_id: "gmail-1",
          subject: "Renewal terms",
          client_id: null,
          policy_id: null,
          work_item_id: null,
          last_message_at: iso,
          created_at: iso,
        },
        {
          id: THREAD_B,
          organization_id: ORG,
          mailbox_id: MAILBOX,
          provider_thread_id: "gmail-2",
          subject: "Claim 4471",
          client_id: null,
          policy_id: null,
          work_item_id: null,
          last_message_at: iso,
          created_at: iso,
        },
      ],
      email_messages: [
        {
          id: "83000000-0000-4000-8000-00000000000a",
          organization_id: ORG,
          thread_id: THREAD_A,
          provider_message_id: "gmail-msg-1",
          direction: "inbound",
          from_address: "ops@jubilee.test",
          to_addresses: ["broking@acme-brokers.test"],
          cc_addresses: ["finance@acme-brokers.test"],
          subject: "Renewal terms",
          body_text: "Terms attached for policy MOT-1188.",
          snippet: "Terms attached",
          sent_at: iso,
          has_attachments: true,
        },
      ],
      email_attachments: [
        {
          id: "84000000-0000-4000-8000-00000000000a",
          organization_id: ORG,
          message_id: "83000000-0000-4000-8000-00000000000a",
          provider_attachment_id: "gmail-att-1",
          filename: "terms.pdf",
          mime_type: "application/pdf",
          byte_size: 2048,
          document_id: null,
        },
      ],
      email_drafts: [],
      clients: [
        { id: CLIENT, organization_id: ORG, name: "Otieno Holdings" },
        { id: OTHER_CLIENT, organization_id: OTHER_ORG, name: "Someone else's client" },
      ],
      client_contacts: [
        { id: "85000000-0000-4000-8000-00000000000a", organization_id: ORG, client_id: CLIENT, email: "ops@jubilee.test", full_name: "Jubilee operations" },
      ],
      policies: [
        { id: "86000000-0000-4000-8000-00000000000a", organization_id: ORG, policy_number: "MOT-1188" },
      ],
      work_items: [],
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

const auth = { Authorization: "Bearer tok-amina" };
const json = { ...auth, "Content-Type": "application/json" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

describe("GET /email/threads/:id", () => {
  it("requires a session", async () => {
    expect((await build().request(`/email/threads/${THREAD_A}`)).status).toBe(401);
  });

  it("returns the message with the provider's own id, its recipients and its attachments", async () => {
    const body = await readJson(await build().request(`/email/threads/${THREAD_A}`, { headers: auth }));
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({
      direction: "inbound",
      from: "ops@jubilee.test",
      to: ["broking@acme-brokers.test"],
      cc: ["finance@acme-brokers.test"],
      providerMessageId: "gmail-msg-1",
    });
    expect(body.messages[0].attachments[0]).toMatchObject({
      filename: "terms.pdf",
      providerAttachmentId: "gmail-att-1",
      // Not filed yet: an attachment we know about is not a document we hold.
      documentId: null,
    });
    expect(body.thread.participants).toContain("ops@jubilee.test");
    expect(body.thread.provider).toBe("gmail");
  });

  it("does not offer sending, because this deployment cannot send", async () => {
    const body = await readJson(await build().request(`/email/threads/${THREAD_A}`, { headers: auth }));
    expect(body.sending.available).toBe(false);
    expect(body.sending.reason).toMatch(/not connected yet/i);
  });

  it("suggests a client from a contact's own address, and says why", async () => {
    const body = await readJson(await build().request(`/email/threads/${THREAD_A}`, { headers: auth }));
    const client = body.suggestions.find((s: { target: string }) => s.target === "client");
    expect(client).toMatchObject({ id: CLIENT, label: "Otieno Holdings", unambiguous: true });
    expect(client.because).toMatch(/ops@jubilee.test/);
    // A suggestion is not a link.
    expect(body.links.clientId).toBeNull();
  });

  it("suggests a policy only because its number is written out in the conversation", async () => {
    const body = await readJson(await build().request(`/email/threads/${THREAD_A}`, { headers: auth }));
    const policy = body.suggestions.find((s: { target: string }) => s.target === "policy");
    expect(policy.because).toMatch(/MOT-1188/);
  });
});

describe("the reply being written", () => {
  const save = (thread: string, body: Record<string, unknown>) =>
    build().request(`/email/threads/${thread}/draft`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify(body),
    });

  it("keeps two conversations' replies apart", async () => {
    await save(THREAD_A, { to: ["client@acme.test"], subject: "Re: Renewal terms", body: "Terms received." });
    await save(THREAD_B, { to: ["assessor@acme.test"], subject: "Re: Claim 4471", body: "Report is with us." });

    const a = await readJson(await build().request(`/email/threads/${THREAD_A}`, { headers: auth }));
    const b = await readJson(await build().request(`/email/threads/${THREAD_B}`, { headers: auth }));
    expect(a.draft.body).toBe("Terms received.");
    expect(a.draft.to).toEqual(["client@acme.test"]);
    expect(b.draft.body).toBe("Report is with us.");
    expect(b.draft.to).toEqual(["assessor@acme.test"]);
  });

  it("is never described as sent", async () => {
    await save(THREAD_A, { to: ["client@acme.test"], subject: "Re: Renewal terms", body: "Terms received." });
    const body = await readJson(await build().request(`/email/threads/${THREAD_A}`, { headers: auth }));
    expect(JSON.stringify(body.draft)).not.toMatch(/sent/i);
    // And no send was attempted, in any shape.
    expect(db.tables["email_send_attempts"] ?? []).toHaveLength(0);
  });

  it("clears the approval when the reply is edited afterwards", async () => {
    await save(THREAD_A, { to: ["client@acme.test"], subject: "Re: Renewal terms", body: "Terms received." });
    await build().request(`/email/threads/${THREAD_A}/draft/approve`, { method: "POST", headers: auth });

    const approved = await readJson(await build().request(`/email/threads/${THREAD_A}`, { headers: auth }));
    expect(approved.draft.approvedAt).not.toBeNull();
    expect(approved.draft.approvedByName).toBe("Amina");

    await save(THREAD_A, { to: ["client@acme.test"], subject: "Re: Renewal terms", body: "Terms received. One change." });
    const edited = await readJson(await build().request(`/email/threads/${THREAD_A}`, { headers: auth }));
    expect(edited.draft.approvedAt).toBeNull();
    expect(
      db.tables["audit_log"]?.some((r) => r["action"] === "email.draft_approval_invalidated"),
    ).toBe(true);
  });

  it("treats adding a recipient as a material change too", async () => {
    await save(THREAD_A, { to: ["client@acme.test"], subject: "Re: Renewal terms", body: "Terms received." });
    await build().request(`/email/threads/${THREAD_A}/draft/approve`, { method: "POST", headers: auth });
    await save(THREAD_A, {
      to: ["client@acme.test", "someone.else@acme.test"],
      subject: "Re: Renewal terms",
      body: "Terms received.",
    });
    const body = await readJson(await build().request(`/email/threads/${THREAD_A}`, { headers: auth }));
    expect(body.draft.approvedAt).toBeNull();
  });

  it("keeps the approval when the same text is saved again", async () => {
    const same = { to: ["client@acme.test"], subject: "Re: Renewal terms", body: "Terms received." };
    await save(THREAD_A, same);
    await build().request(`/email/threads/${THREAD_A}/draft/approve`, { method: "POST", headers: auth });
    await save(THREAD_A, same);
    const body = await readJson(await build().request(`/email/threads/${THREAD_A}`, { headers: auth }));
    expect(body.draft.approvedAt).not.toBeNull();
  });

  it("never copies the reply itself into the audit row", async () => {
    await save(THREAD_A, { to: ["client@acme.test"], subject: "Re: Renewal terms", body: "A private thing." });
    await build().request(`/email/threads/${THREAD_A}/draft/approve`, { method: "POST", headers: auth });
    await save(THREAD_A, { to: ["client@acme.test"], subject: "Re: Renewal terms", body: "A different private thing." });
    expect(JSON.stringify(db.tables["audit_log"] ?? [])).not.toMatch(/private thing/);
  });
});

describe("what a conversation is about", () => {
  const link = (body: Record<string, unknown>) =>
    build().request(`/email/threads/${THREAD_A}/links`, {
      method: "PUT",
      headers: json,
      body: JSON.stringify(body),
    });

  it("writes the link and an audit row", async () => {
    const res = await link({ clientId: CLIENT });
    expect(res.status).toBe(200);
    expect((await readJson(res)).links).toMatchObject({ clientId: CLIENT, clientName: "Otieno Holdings" });
    expect(db.tables["audit_log"]?.some((r) => r["action"] === "email.thread_linked")).toBe(true);
  });

  it("removes a link when asked to", async () => {
    await link({ clientId: CLIENT });
    const res = await link({ clientId: null });
    expect((await readJson(res)).links.clientId).toBeNull();
  });

  it("refuses a record from another brokerage", async () => {
    const res = await link({ clientId: OTHER_CLIENT });
    expect(res.status).toBe(404);
    const body = await readJson(await build().request(`/email/threads/${THREAD_A}`, { headers: auth }));
    expect(body.links.clientId).toBeNull();
  });

  it("refuses a request that says nothing", async () => {
    expect((await link({})).status).toBe(400);
  });
});
