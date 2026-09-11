/**
 * Pins: a personal marker, and the things it must never quietly become.
 *
 * The rules under test are as much about what does *not* happen as what does. Pinning writes one
 * row for one person. It bumps no version, writes no audit row, touches no step, and changes
 * nothing another member of the brokerage can see.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG_A = "10000000-0000-4000-8000-00000000000a";
const ORG_B = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const ITEM = "20000000-0000-4000-8000-00000000000a";
const BETA_ITEM = "20000000-0000-4000-8000-00000000000b";
const silentMailer: Mailer = { send: async () => ({ ok: true as const }) } as unknown as Mailer;

const item = (id: string, title: string, org = ORG_A) => ({
  id,
  organization_id: org,
  title,
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
  reason: null,
  steps: [],
  exception: null,
  version: 1,
  created_at: "2026-09-01T09:00:00Z",
  updated_at: "2026-09-05T09:00:00Z",
  completed_at: null,
  deleted_at: null,
});

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA },
    inserts: [],
    rpc: {},
    tables: {
      users: [
        { id: AMINA.id, email: AMINA.email, full_name: "Amina", display_name: null, active_organization_id: ORG_A },
      ],
      organization_memberships: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          organization_id: ORG_A,
          user_id: AMINA.id,
          is_owner: true,
          status: "active",
          joined_at: "2026-01-01T00:00:00Z",
          organization: { id: ORG_A, name: "Acme Insurance Brokers", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
          role: { id: "30000000-0000-4000-8000-000000000001", key: "brokerage_admin", name: "Brokerage administrator", description: null, is_system: true },
        },
      ],
      role_permissions: [],
      work_items: [item(ITEM, "Acme Motors renewal"), item(BETA_ITEM, "Beta Risk renewal", ORG_B)],
      work_item_pins: [],
      audit_log: [],
    },
  };
}

const auth = { Authorization: "Bearer tok-amina", "Content-Type": "application/json" };
// Test-only: bodies are asserted field by field, so a loose type is the honest one here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

describe("pins", () => {
  let db: FakeDb;
  let app: ReturnType<typeof createApp>;
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

  const pin = (id: string, pinned = true) =>
    app.request(`/work-items/${id}/pin`, { method: "PUT", headers: auth, body: JSON.stringify({ pinned }) });

  it("keeps a record for the person who asked, and lists it back", async () => {
    expect((await pin(ITEM)).status).toBe(200);
    const body = await readJson(await app.request("/pins", { headers: auth }));
    expect(body.pins).toHaveLength(1);
    expect(body.pins[0]).toMatchObject({ workItemId: ITEM, title: "Acme Motors renewal", note: null });
  });

  it("pinning twice is the same pin", async () => {
    await pin(ITEM);
    await pin(ITEM);
    expect(db.tables["work_item_pins"]).toHaveLength(1);
  });

  it("unpinning removes it", async () => {
    await pin(ITEM);
    expect((await pin(ITEM, false)).status).toBe(200);
    const body = await readJson(await app.request("/pins", { headers: auth }));
    expect(body.pins).toHaveLength(0);
  });

  it("changes nothing about the record: no version bump, no step, no audit row", async () => {
    const before = JSON.stringify(db.tables["work_items"]);
    await pin(ITEM);
    expect(JSON.stringify(db.tables["work_items"])).toBe(before);
    expect(db.inserts.filter((i) => i.table === "audit_log")).toHaveLength(0);
  });

  it("refuses a record in another brokerage, without confirming it exists", async () => {
    const res = await pin(BETA_ITEM);
    expect(res.status).toBe(404);
    expect(db.tables["work_item_pins"]).toHaveLength(0);
    expect(JSON.stringify(await readJson(res))).not.toContain("Beta Risk");
  });

  it("drops a pin whose record is no longer readable, rather than naming it", async () => {
    await pin(ITEM);
    // The record is soft-deleted after it was kept.
    (db.tables["work_items"] as Record<string, unknown>[])[0]!["deleted_at"] = "2026-09-10T00:00:00Z";
    const body = await readJson(await app.request("/pins", { headers: auth }));
    expect(body.pins).toHaveLength(0);
  });
});
