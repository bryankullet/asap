/**
 * The three read surfaces the real UI needs and did not have: search, the brokerage's own audit
 * history, and connected email.
 *
 * What each is here to prove:
 *   - search is a lookup, scoped to the caller's brokerage, and every result opens somewhere;
 *   - the audit history is gated on `audit:view` and never quietly hides a denial or a failure;
 *   - email is read-only, and says "no mailbox connected" rather than "no email" when there is none.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const CLIENT = "20000000-0000-4000-8000-000000000001";
const POLICY = "40000000-0000-4000-8000-000000000001";
const ITEM = "50000000-0000-4000-8000-000000000001";
const MAILBOX = "80000000-0000-4000-8000-000000000001";
const THREAD = "90000000-0000-4000-8000-000000000001";
const iso = "2026-09-05T09:00:00.000Z";

function membership(permissions: string[]) {
  return {
    users: { "tok-amina": AMINA },
    inserts: [],
    rpc: {},
    tables: {
      users: [
        {
          id: AMINA.id,
          email: AMINA.email,
          full_name: "Amina",
          display_name: null,
          active_organization_id: ORG,
        },
      ],
      organization_memberships: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          user_id: AMINA.id,
          is_owner: true,
          status: "active",
          joined_at: "2026-01-01T00:00:00Z",
          organization: {
            id: ORG,
            name: "Acme",
            country: "KE",
            currency: "KES",
            timezone: "Africa/Nairobi",
          },
          role: {
            id: "30000000-0000-4000-8000-000000000001",
            key: "brokerage_admin",
            name: "Admin",
            description: null,
            is_system: true,
          },
        },
      ],
      role_permissions: permissions.map((p) => {
        const [object_type, verb] = p.split(":");
        return {
          role_id: "30000000-0000-4000-8000-000000000001",
          permission: { object_type, verb },
        };
      }),
      clients: [
        {
          id: CLIENT,
          organization_id: ORG,
          name: "Tamarind Exporters Ltd",
          kind: "corporate",
          file_status: "on_file",
          deleted_at: null,
        },
      ],
      policies: [
        {
          id: POLICY,
          organization_id: ORG,
          policy_number: "P-4471",
          class_of_business: "Marine cargo",
          deleted_at: null,
        },
      ],
      work_items: [
        {
          id: ITEM,
          organization_id: ORG,
          title: "Tamarind marine renewal",
          kind: "renewal",
          task_status: "with_us",
          deleted_at: null,
        },
      ],
      claims: [
        {
          id: "b1000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          work_item_id: ITEM,
          client_id: CLIENT,
          status: "registered",
          insurer_reference: "CL-TAMARIND-88",
          incident_summary: "Water damage to a tamarind consignment in transit",
          deleted_at: null,
        },
      ],
      insurers: [
        {
          id: "b2000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          name: "Tamarind Mutual Assurance",
          deleted_at: null,
        },
      ],
      documents: [
        {
          id: "b3000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          client_id: CLIENT,
          kind: "policy_schedule",
          filename: "tamarind-marine-schedule.pdf",
          extraction_state: "extracted",
          deleted_at: null,
        },
        {
          id: "b3000000-0000-4000-8000-000000000002",
          organization_id: ORG,
          client_id: CLIENT,
          kind: "debit_note",
          filename: "tamarind-debit-note.pdf",
          extraction_state: "queued",
          deleted_at: null,
        },
      ],
      runs: [
        {
          id: "b4000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          work_item_id: ITEM,
          title: "Read the tamarind schedule",
          status: "finished",
        },
      ],
      audit_log: [
        {
          id: 1,
          organization_id: ORG,
          actor_type: "user",
          actor_user_id: AMINA.id,
          action: "work_item.applied",
          object_type: "work_item",
          object_id: ITEM,
          previous_state: { task_status: "with_insurer" },
          new_state: { task_status: "with_us" },
          evidence: null,
          result: "success",
          failure_reason: null,
          occurred_at: iso,
        },
        {
          id: 2,
          organization_id: ORG,
          actor_type: "automation",
          actor_user_id: null,
          action: "automation.prepared",
          object_type: "automation_run",
          object_id: null,
          previous_state: null,
          new_state: null,
          evidence: null,
          result: "denied",
          failure_reason: "A person must approve an external message",
          occurred_at: iso,
        },
      ],
      mailboxes: [{ id: MAILBOX, organization_id: ORG, provider: "gmail", status: "connected" }],
      email_threads: [
        {
          id: THREAD,
          organization_id: ORG,
          mailbox_id: MAILBOX,
          subject: "Marine renewal terms",
          client_id: CLIENT,
          work_item_id: ITEM,
          last_message_at: iso,
          clients: { name: "Tamarind Exporters Ltd" },
          email_messages: [{ count: 2 }],
        },
      ],
      email_messages: [
        {
          id: "a1000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          thread_id: THREAD,
          direction: "inbound",
          from_address: "underwriting@jubilee.test",
          to_addresses: ["broking@acme-brokers.test"],
          subject: "Marine renewal terms",
          body_text: "Terms attached.",
          snippet: "Terms attached.",
          sent_at: iso,
          has_attachments: true,
        },
      ],
    },
  } satisfies FakeDb;
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
  db = membership(["audit:view"]);
});

const auth = { Authorization: "Bearer tok-amina" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

describe("GET /search", () => {
  it("requires a session", async () => {
    expect((await build().request("/search?q=tamarind")).status).toBe(401);
  });

  it("answers nothing for an empty query rather than returning the whole book", async () => {
    const body = await readJson(await build().request("/search?q=%20%20", { headers: auth }));
    expect(body.results).toEqual([]);
  });

  it("finds a client, a policy and a piece of work, each with somewhere to open", async () => {
    const body = await readJson(await build().request("/search?q=tamarind", { headers: auth }));
    for (const r of body.results) {
      expect(r.to).toMatch(/^\//);
      expect(r.title.length).toBeGreaterThan(0);
    }
    expect(body.results.map((r: { kind: string }) => r.kind)).toContain("client");
  });

  /*
   * Eight kinds, every one a real table. A search that only looked at three while a person typed a
   * claim reference would return nothing and imply no such claim exists.
   */
  it("searches every kind that has a table", async () => {
    // Each kind is matched on its own column, so each is asked for in the words it holds: a
    // policy is found by its number, not by its client's name.
    const cases: [string, string][] = [
      ["client", "tamarind"],
      ["policy", "P-4471"],
      ["work", "tamarind marine"],
      ["claim", "CL-TAMARIND-88"],
      ["insurer", "Tamarind Mutual"],
      ["document", "tamarind-marine-schedule"],
      ["email", "Marine renewal terms"],
      ["run", "Read the tamarind schedule"],
    ];
    for (const [kind, query] of cases) {
      const body = await readJson(
        await build().request(`/search?q=${encodeURIComponent(query)}`, { headers: auth }),
      );
      const kinds = body.results.map((r: { kind: string }) => r.kind);
      expect(kinds, `${kind} for "${query}"`).toContain(kind);
    }
  });

  it("finds a claim by its insurer reference as well as by what happened", async () => {
    const byRef = await readJson(await build().request("/search?q=CL-TAMARIND-88", { headers: auth }));
    expect(byRef.results.map((r: { kind: string }) => r.kind)).toContain("claim");
    const byIncident = await readJson(await build().request("/search?q=water%20damage", { headers: auth }));
    const claim = byIncident.results.find((r: { kind: string }) => r.kind === "claim");
    expect(claim.title).toBe("CL-TAMARIND-88");
  });

  /* A claim's Space is its work item's: that is where its steps and its evidence live. */
  it("opens a claim at its work item rather than at a route that does not exist", async () => {
    const body = await readJson(await build().request("/search?q=CL-TAMARIND-88", { headers: auth }));
    const claim = body.results.find((r: { kind: string }) => r.kind === "claim");
    expect(claim.to).toBe(`/r/${ITEM}`);
  });

  /* The one claim this product must not make about a document it has not read. */
  it("never describes an unread document as read", async () => {
    const body = await readJson(await build().request("/search?q=tamarind", { headers: auth }));
    const docs = body.results.filter((r: { kind: string }) => r.kind === "document");
    const unread = docs.find((d: { title: string }) => d.title.includes("debit-note"));
    expect(unread.subtitle).toMatch(/not read yet/);
    const read = docs.find((d: { title: string }) => d.title.includes("schedule"));
    expect(read.subtitle).not.toMatch(/not read yet/);
  });

  /* A document called "schedule.pdf" is meaningless alone, and four of them are identical. */
  it("names the client a hit belongs to", async () => {
    const body = await readJson(await build().request("/search?q=tamarind", { headers: auth }));
    const doc = body.results.find((r: { kind: string }) => r.kind === "document");
    expect(doc.clientName).toBe("Tamarind Exporters Ltd");
    const client = body.results.find((r: { kind: string }) => r.kind === "client");
    // A client is its own context; repeating its name beside itself is noise.
    expect(client.clientName).toBeNull();
  });

  it("returns nothing, and says nothing failed, for a query that matches nothing", async () => {
    const body = await readJson(await build().request("/search?q=zzzznothing", { headers: auth }));
    expect(body.results).toEqual([]);
    expect(body.degraded).toEqual([]);
  });
});

describe("GET /audit", () => {
  it("requires a session", async () => {
    expect((await build().request("/audit")).status).toBe(401);
  });

  it("refuses a role without audit:view, by name rather than with an empty list", async () => {
    db = membership([]);
    const res = await build().request("/audit", { headers: auth });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/audit history/i);
  });

  it("shows what changed, and never hides a denial", async () => {
    const body = await readJson(await build().request("/audit", { headers: auth }));
    expect(body.recordId).toBeNull();
    const denial = body.entries.find((e: { result: string }) => e.result === "denied");
    expect(denial).toBeTruthy();
    expect(denial.failureReason).toMatch(/approve/i);
    const applied = body.entries.find((e: { action: string }) => e.action === "work_item.applied");
    expect(applied.changed.join(" ")).toContain("task_status");
    expect(applied.actorName).toBe("Amina");
  });
});

describe("GET /email/threads", () => {
  it("requires a session", async () => {
    expect((await build().request("/email/threads")).status).toBe(401);
  });

  it("returns the brokerage's own threads, with the client they belong to", async () => {
    const body = await readJson(await build().request("/email/threads", { headers: auth }));
    expect(body.mailboxConnected).toBe(true);
    expect(body.threads[0]).toMatchObject({
      subject: "Marine renewal terms",
      clientName: "Tamarind Exporters Ltd",
      workItemId: ITEM,
    });
  });

  it("says a mailbox is not connected rather than implying there is no email", async () => {
    db.tables["mailboxes"] = [];
    db.tables["email_threads"] = [];
    const body = await readJson(await build().request("/email/threads", { headers: auth }));
    expect(body.mailboxConnected).toBe(false);
    expect(body.threads).toEqual([]);
  });

  it("opens one conversation in order, and carries no token anywhere", async () => {
    const body = await readJson(
      await build().request(`/email/threads/${THREAD}`, { headers: auth }),
    );
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]).toMatchObject({ direction: "inbound", hasAttachments: true });
    expect(JSON.stringify(body)).not.toMatch(/token/i);
  });
});
