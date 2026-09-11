/**
 * `GET /work-items/:id/history` — the record's audit history (C05: never rewrite historical
 * outcomes). Read-only, under RLS, gated on `audit:view`, and it never leaks a document or a
 * credential because `audit.ts` refuses to write one in the first place.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG_A = "10000000-0000-4000-8000-00000000000a";
const ORG_B = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const READER = { id: "c0000000-0000-4000-8000-000000000001", email: "shared@consultant.test" };
const ITEM = "30000000-0000-4000-8000-000000000001";
const iso = "2026-09-05T09:00:00.000Z";

const membership = (userId: string, roleId: string, perms: boolean) => ({
  id: `60000000-0000-4000-8000-00000000000${perms ? "1" : "2"}`,
  organization_id: ORG_A,
  user_id: userId,
  is_owner: perms,
  status: "active",
  joined_at: "2026-01-01T00:00:00Z",
  organization: { id: ORG_A, name: "Acme", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
  role: { id: roleId, key: perms ? "brokerage_admin" : "read_only", name: perms ? "Admin" : "Read only", description: null, is_system: true },
});

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA, "tok-reader": READER },
    inserts: [],
    rpc: {},
    tables: {
      users: [
        { id: AMINA.id, email: AMINA.email, full_name: "Amina Otieno", display_name: null, active_organization_id: ORG_A },
        { id: READER.id, email: READER.email, full_name: "Grace Achieng", display_name: null, active_organization_id: ORG_A },
      ],
      organization_memberships: [
        membership(AMINA.id, "30000000-0000-4000-8000-000000000001", true),
        membership(READER.id, "30000000-0000-4000-8000-000000000002", false),
      ],
      // Only the admin's role holds audit:view.
      role_permissions: [
        { role_id: "30000000-0000-4000-8000-000000000001", permission: { object_type: "audit", verb: "view" } },
      ],
      work_items: [
        {
          id: ITEM,
          organization_id: ORG_A,
          title: "Acme Motors — renewal terms from Jubilee",
          kind: "renewal",
          client_id: null,
          policy_period_id: null,
          insurer_id: null,
          class_of_business: null,
          owner_id: null,
          task_status: "needs_you",
          task_party: null,
          task_since: null,
          task_next_check: null,
          cover_status: null,
          cover_inception_at: null,
          money_status: null,
          reason: "Terms are outstanding.",
          steps: [],
          exception: null,
          version: 3,
          created_at: iso,
          updated_at: iso,
          completed_at: null,
          deleted_at: null,
        },
      ],
      audit_log: [
        {
          id: 2,
          organization_id: ORG_A,
          actor_type: "user",
          actor_user_id: AMINA.id,
          action: "External send recorded by human",
          object_type: "work_item",
          object_id: ITEM,
          previous_state: { sent_at: null },
          new_state: { sent_at: iso, sent_evidence: "Sent folder message 42" },
          evidence: [{ reference: "Sent folder message 42" }],
          result: "success",
          failure_reason: null,
          occurred_at: iso,
        },
        {
          id: 1,
          organization_id: ORG_A,
          actor_type: "user",
          actor_user_id: AMINA.id,
          action: "work_item.approve",
          object_type: "work_item",
          object_id: ITEM,
          previous_state: null,
          new_state: null,
          evidence: null,
          // A denial is history too, and it is shown rather than hidden.
          result: "denied",
          failure_reason: "client_file_cleared",
          occurred_at: "2026-09-04T09:00:00.000Z",
        },
        // Another brokerage's row, on the same object id. It must never be returned.
        {
          id: 3,
          organization_id: ORG_B,
          actor_type: "user",
          actor_user_id: null,
          action: "beta.only",
          object_type: "work_item",
          object_id: ITEM,
          previous_state: null,
          new_state: null,
          evidence: null,
          result: "success",
          failure_reason: null,
          occurred_at: iso,
        },
      ],
      runs: [],
      drafts: [],
    },
  };
}

let db: FakeDb;
let app: ReturnType<typeof createApp>;
const silentMailer: Mailer = { sendInvitation: async () => {} };

beforeEach(() => {
  db = makeDb();
  app = createApp({
    logger: pino({ level: "silent" }),
    build: { version: "t", commit: "t" },
    supabase: fakeFactory(db),
    mailer: silentMailer,
    webBaseUrl: "http://localhost:5173",
    invitationTtlHours: 168,
    exposeAcceptUrl: true,
    executor: () => async () => {},
    bootToken: "test-boot",
  });
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

describe("GET /work-items/:id/history", () => {
  it("requires a session", async () => {
    expect((await app.request(`/work-items/${ITEM}/history`)).status).toBe(401);
  });

  it("returns the record's history, newest first, with who and what changed", async () => {
    const res = await app.request(`/work-items/${ITEM}/history`, { headers: auth("tok-amina") });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0]).toMatchObject({
      action: "External send recorded by human",
      actorType: "user",
      actorName: "Amina Otieno",
      result: "success",
    });
    // The fields that changed, not the whole row.
    expect(body.entries[0].changed).toContain("sent_at: nothing → 2026-09-05T09:00:00.000Z");
    expect(body.entries[0].evidence).toEqual(["Sent folder message 42"]);
  });

  it("shows a denial rather than hiding it", async () => {
    const body = await readJson(
      await app.request(`/work-items/${ITEM}/history`, { headers: auth("tok-amina") }),
    );
    const denied = body.entries.find((e: { result: string }) => e.result === "denied");
    expect(denied).toBeTruthy();
    expect(denied.failureReason).toBe("client_file_cleared");
  });

  it("never returns another brokerage's rows, even on the same object id", async () => {
    const body = await readJson(
      await app.request(`/work-items/${ITEM}/history`, { headers: auth("tok-amina") }),
    );
    expect(body.entries.map((e: { action: string }) => e.action)).not.toContain("beta.only");
    expect(body.visible).toBe(2);
  });

  it("refuses a role without audit:view by name, rather than returning an empty list", async () => {
    const res = await app.request(`/work-items/${ITEM}/history`, { headers: auth("tok-reader") });
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect(body.error).toBe("forbidden");
  });

  it("404s for a record the caller cannot read", async () => {
    const res = await app.request(
      "/work-items/30000000-0000-4000-8000-0000000000ff/history",
      { headers: auth("tok-amina") },
    );
    expect(res.status).toBe(404);
  });
});
