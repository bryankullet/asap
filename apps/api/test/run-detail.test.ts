/**
 * `GET /runs/:id` — one run in full, and the "For review" Work view.
 *
 * The rule both of these hold: **a run is what ASAP is doing, Work is what a person owns, and
 * insurance status is what is true of the business.** A finished run is never, on its own, a
 * renewal, a confirmation, an acceptance or a payment.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const ITEM = "30000000-0000-4000-8000-000000000001";
const ITEM_DRAFTED = "30000000-0000-4000-8000-000000000002";
const RUN_FAILED = "40000000-0000-4000-8000-000000000001";
const RUN_ORPHAN = "40000000-0000-4000-8000-000000000002";
const RUN_DONE = "40000000-0000-4000-8000-000000000003";
const iso = "2026-09-05T09:00:00.000Z";

const step = (over: Record<string, unknown>) => ({
  actor: "you", state: "todo", guards: [], evidence: [], actions: [],
  party: null, reason: null, recorded: [], runId: null, ...over,
});

const item = (over: Record<string, unknown>) => ({
  organization_id: ORG, kind: "renewal", client_id: null, policy_period_id: null,
  insurer_id: null, class_of_business: null, owner_id: null, task_status: "needs_you",
  task_party: null, task_since: null, task_next_check: null, cover_status: null,
  cover_inception_at: null, money_status: null, reason: "Something is waiting.", steps: [],
  exception: null, version: 1, created_at: iso, updated_at: iso, completed_at: null,
  deleted_at: null, ...over,
});

const run = (over: Record<string, unknown>) => ({
  organization_id: ORG, work_item_id: ITEM, title: "Renewal pack prepared", status: "finished",
  next_step: null, started_by: null, boot_token: null, started_at: iso, ended_at: iso,
  created_at: iso, updated_at: iso, ...over,
});

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA },
    inserts: [],
    rpc: {},
    tables: {
      users: [{ id: AMINA.id, email: AMINA.email, full_name: "Amina", display_name: null, active_organization_id: ORG }],
      organization_memberships: [
        {
          id: "60000000-0000-4000-8000-000000000001", organization_id: ORG, user_id: AMINA.id,
          is_owner: true, status: "active", joined_at: "2026-01-01T00:00:00Z",
          organization: { id: ORG, name: "Acme", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
          role: { id: "30000000-0000-4000-8000-000000000001", key: "brokerage_admin", name: "Admin", description: null, is_system: true },
        },
      ],
      role_permissions: [],
      work_items: [
        item({
          id: ITEM,
          title: "Acme Motors — renewal terms from Jubilee",
          steps: [
            step({ id: "review", label: "Expiring policy reviewed", actor: "asap", state: "now", runId: RUN_FAILED,
              recorded: [{ kind: "document", reference: "Renewal pack 2026", recordedBy: "Amina", recordedAt: iso }] }),
          ],
        }),
        item({ id: ITEM_DRAFTED, title: "Acme Motors — chase Jubilee", steps: [] }),
      ],
      runs: [
        run({ id: RUN_FAILED, status: "could_not_finish", next_step: "The schedule had no premium line. Check the file.", ended_at: iso }),
        run({ id: RUN_ORPHAN, work_item_id: null, title: "Mailbox sweep", status: "could_not_finish", next_step: "Nothing to sweep." }),
        run({ id: RUN_DONE, status: "finished", title: "Term comparison prepared", next_step: null }),
      ],
      run_events: [
        { id: 1, run_id: RUN_FAILED, seq: 1, kind: "step", message: "Read the expiring policy", created_at: iso },
        { id: 2, run_id: RUN_FAILED, seq: 2, kind: "error", message: "The schedule had no premium line", created_at: iso },
      ],
      // One unsent draft: the item it belongs to is what "For review" means.
      drafts: [
        {
          id: "90000000-0000-4000-8000-000000000001", organization_id: ORG, work_item_id: ITEM_DRAFTED,
          step_id: "request_terms", to_address: "renewals@jubilee.example", subject: "Terms",
          body: "Please share the terms.", copied_at: null, sent_at: null, sent_evidence: null,
          outcome_unknown: false, created_by: null, created_at: iso, updated_at: iso,
        },
      ],
    },
  };
}

let db: FakeDb;
let app: ReturnType<typeof createApp>;
const silentMailer: Mailer = { sendInvitation: async () => {} };

beforeEach(() => {
  db = makeDb();
  app = createApp({
    logger: pino({ level: "silent" }), build: { version: "t", commit: "t" },
    supabase: fakeFactory(db), mailer: silentMailer, webBaseUrl: "http://localhost:5173",
    invitationTtlHours: 168, exposeAcceptUrl: true, executor: () => async () => {}, bootToken: "t",
  });
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();
const get = async (p: string) => readJson(await app.request(p, { headers: auth("tok-amina") }));

describe("GET /runs/:id", () => {
  it("requires a session", async () => {
    expect((await app.request(`/runs/${RUN_FAILED}`)).status).toBe(401);
  });

  it("returns what ASAP did, step by step", async () => {
    const body = await get(`/runs/${RUN_FAILED}`);
    expect(body.run.title).toBe("Renewal pack prepared");
    expect(body.events.map((e: { message: string }) => e.message)).toEqual([
      "Read the expiring policy",
      "The schedule had no premium line",
    ]);
  });

  it("says what it could not finish, in the run's own words", async () => {
    const body = await get(`/runs/${RUN_FAILED}`);
    expect(body.waitingFor).toBe("The schedule had no premium line. Check the file.");
    // Never a business outcome: the run says what it could not do, not what is true of the policy.
    expect(body.waitingFor).not.toMatch(/renewed|confirmed|accepted|paid/i);
  });

  it("names nothing to wait for when a run finished", async () => {
    const body = await get(`/runs/${RUN_DONE}`);
    expect(body.waitingFor).toBeNull();
    // A finished run carries no claim about the business; that lives on the work.
    expect(JSON.stringify(body.run)).not.toMatch(/renewed|confirmed|accepted/i);
  });

  it("links to the work a person owns, and carries its evidence", async () => {
    const body = await get(`/runs/${RUN_FAILED}`);
    expect(body.relatedWork).toMatchObject({
      id: ITEM,
      title: "Acme Motors — renewal terms from Jubilee",
      taskStatus: "needs_you",
      nowStep: "Expiring policy reviewed",
    });
    expect(body.evidence[0]).toMatchObject({
      label: "Expiring policy reviewed",
      reference: "Renewal pack 2026",
      recordedBy: "Amina",
    });
  });

  it("offers opening the work, and offers retry disabled with its reason rather than hiding it", async () => {
    const body = await get(`/runs/${RUN_FAILED}`);
    const kinds = body.recovery.map((r: { kind: string }) => r.kind);
    expect(kinds).toContain("open_work");
    expect(kinds).toContain("retry");
    const open = body.recovery.find((r: { kind: string }) => r.kind === "open_work");
    expect(open.disabledReason).toBeNull();
    // Re-running is an action on a step, so the step's guards must decide — never this view.
    const retry = body.recovery.find((r: { kind: string }) => r.kind === "retry");
    expect(retry.disabledReason).toMatch(/from the step on the record, so its guards are checked/);
  });

  it("offers no retry for a run that finished", async () => {
    const body = await get(`/runs/${RUN_DONE}`);
    expect(body.recovery.map((r: { kind: string }) => r.kind)).not.toContain("retry");
  });

  it("says so when a run has no work of its own", async () => {
    const body = await get(`/runs/${RUN_ORPHAN}`);
    expect(body.relatedWork).toBeNull();
    expect(body.evidence).toEqual([]);
    // With no work item there is nothing to open, so nothing is offered as if there were.
    expect(body.recovery.map((r: { kind: string }) => r.kind)).not.toContain("open_work");
    const retry = body.recovery.find((r: { kind: string }) => r.kind === "retry");
    expect(retry.disabledReason).toMatch(/no work item/);
  });
});

describe("GET /work?view=review", () => {
  it("is the work where ASAP prepared something nobody has acted on", async () => {
    const body = await get("/work?view=review");
    expect(body.label).toBe("For review");
    expect(body.items.map((i: { item: { id: string } }) => i.item.id)).toEqual([ITEM_DRAFTED]);
  });

  it("is derived from unsent drafts, so it empties when one is recorded as sent", async () => {
    (db.tables["drafts"]![0] as Record<string, unknown>)["sent_at"] = iso;
    const body = await get("/work?view=review");
    expect(body.items).toEqual([]);
    expect(body.visible).toBe(0);
  });

  it("does not offer Pinned as a view", async () => {
    // docs/ui-contract.md: "Pinned is a personal marker, not a view."
    const body = await get("/work?view=pinned");
    expect(body.view).toBe("needs");
  });
});
