/**
 * First-use onboarding (D-082).
 *
 * What these lock:
 *   - progress is a server row, so a refresh returns a person to the step they were on;
 *   - a skip is a recorded answer, audited, not an absence;
 *   - finishing twice finishes once, and audits once;
 *   - somebody who joined an existing brokerage sees its details and cannot overwrite them;
 *   - a person sees their own progress and nobody else's;
 *   - what is "set up" is counted from real rows, never from a step being marked done.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { MailboxProvider, SyncLimits } from "../src/mailbox/types.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const JOINER = { id: "a0000000-0000-4000-8000-000000000002", email: "new@acme-brokers.test" };
const ADMIN_ROLE = "30000000-0000-4000-8000-000000000001";
const CLERK_ROLE = "30000000-0000-4000-8000-000000000002";
const iso = "2026-09-05T09:00:00.000Z";

const LIMITS: SyncLimits = {
  windowDays: 30,
  maxThreads: 10,
  maxAttachments: 5,
  maxAttachmentBytes: 1024,
  attachmentMimeTypes: ["application/pdf"],
};

const gmail = {
  id: "gmail",
  async list() {
    return { messages: [], cursor: null, checkpointExpired: false, reachedLimit: false };
  },
  async fetchAttachment() {
    return null;
  },
  async send() {
    return { outcome: "failed" as const, reason: "not in this test" };
  },
  async refresh() {
    return "needs_reauthorisation" as const;
  },
  async exchangeCode() {
    return { outcome: "failed" as const, reason: "not in this test" };
  },
  async revoke() {},
} satisfies MailboxProvider;

function membership(userId: string, roleId: string, orgId = ORG) {
  return {
    id: `60000000-0000-4000-8000-0000000000${roleId.slice(-2)}${userId.slice(-1)}`,
    organization_id: orgId,
    user_id: userId,
    is_owner: roleId === ADMIN_ROLE,
    status: "active",
    joined_at: iso,
    organization: {
      id: orgId,
      name: orgId === ORG ? "Acme Brokers" : "Beta Brokers",
      country: "KE",
      currency: "KES",
      timezone: "Africa/Nairobi",
    },
    role: {
      id: roleId,
      key: roleId === ADMIN_ROLE ? "brokerage_admin" : "policy_administrator",
      name: roleId === ADMIN_ROLE ? "Admin" : "Policy administrator",
      description: null,
      is_system: true,
    },
  };
}

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA, "tok-joiner": JOINER },
    inserts: [],
    rpc: {},
    tables: {
      users: [
        { id: AMINA.id, email: AMINA.email, full_name: "Amina", display_name: "Amina", active_organization_id: ORG },
        { id: JOINER.id, email: JOINER.email, full_name: "Bahati", display_name: "Bahati", active_organization_id: ORG },
      ],
      organizations: [
        {
          id: ORG,
          name: "Acme Brokers",
          country: "KE",
          currency: "KES",
          timezone: "Africa/Nairobi",
          created_by: AMINA.id,
        },
      ],
      organization_memberships: [
        membership(AMINA.id, ADMIN_ROLE),
        membership(JOINER.id, CLERK_ROLE),
      ],
      role_permissions: [
        { role_id: ADMIN_ROLE, permission: { object_type: "organization", verb: "edit" } },
      ],
      user_onboarding: [],
      documents: [],
      import_batches: [],
      clients: [],
      mailboxes: [],
      audit_log: [],
    },
  };
}

let db: FakeDb;
const silentMailer: Mailer = { sendInvitation: async () => {} };

const build = (withGmail = false) =>
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
    ...(withGmail
      ? { mailbox: { providers: { gmail }, limits: LIMITS, encryptionKey: "a-test-encryption-key-of-at-least-32-chars" } }
      : {}),
  });

beforeEach(() => {
  db = makeDb();
});

const amina = { Authorization: "Bearer tok-amina" };
const joiner = { Authorization: "Bearer tok-joiner" };
const json = (h: Record<string, string>) => ({ ...h, "Content-Type": "application/json" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

const read = async (who = amina, withGmail = false) =>
  readJson(await build(withGmail).request("/onboarding", { headers: who }));

const save = (body: Record<string, unknown>, who = amina) =>
  build().request("/onboarding", { method: "PUT", headers: json(who), body: JSON.stringify(body) });

const complete = (who = amina) =>
  build().request("/onboarding/complete", { method: "POST", headers: who });

describe("where a person got to", () => {
  it("requires a session", async () => {
    expect((await build().request("/onboarding")).status).toBe(401);
  });

  it("starts at step one without creating a row", async () => {
    const body = await read();
    expect(body.onboarding.step).toBe(1);
    expect(body.onboarding.completedAt).toBeNull();
    // Reading it is not starting it: somebody who never opens onboarding never acquires a row.
    expect(db.tables["user_onboarding"]).toHaveLength(0);
  });

  it("remembers the step, so a refresh returns to it", async () => {
    await save({ step: 3 });
    expect((await read()).onboarding.step).toBe(3);
  });

  it("refuses a step that has no screen", async () => {
    // 422: the shape is wrong, which the contract catches before the route sees it.
    expect((await save({ step: 9 })).status).toBe(422);
  });

  it("refuses a request that says nothing", async () => {
    expect((await save({})).status).toBe(400);
  });
});

describe("a skip is an answer", () => {
  it("records skipping records, and audits it", async () => {
    await save({ recordsChoice: "skip", step: 3 });
    const body = await read();
    expect(body.onboarding.recordsChoice).toBe("skip");
    expect(
      db.tables["audit_log"]?.some((r) => r["action"] === "onboarding.choice_recorded"),
    ).toBe(true);
  });

  it("records skipping the mailbox", async () => {
    await save({ mailboxChoice: "skip", step: 4 });
    expect((await read()).onboarding.mailboxChoice).toBe("skip");
  });

  it("does not audit merely paging between steps", async () => {
    await save({ step: 2 });
    await save({ step: 3 });
    expect(db.tables["audit_log"] ?? []).toHaveLength(0);
  });
});

describe("finishing", () => {
  it("records completion and audits it once", async () => {
    const first = await complete();
    expect(first.status).toBe(200);
    expect((await readJson(first)).onboarding.completedAt).not.toBeNull();
    expect(db.tables["audit_log"]!.filter((r) => r["action"] === "onboarding.completed")).toHaveLength(1);
  });

  it("finishes once however many times it is pressed", async () => {
    const one = await readJson(await complete());
    const two = await readJson(await complete());
    const three = await readJson(await complete());

    expect(two.onboarding.completedAt).toBe(one.onboarding.completedAt);
    expect(three.onboarding.completedAt).toBe(one.onboarding.completedAt);
    expect(db.tables["user_onboarding"]).toHaveLength(1);
    expect(db.tables["audit_log"]!.filter((r) => r["action"] === "onboarding.completed")).toHaveLength(1);
  });
});

describe("somebody who joined an existing brokerage", () => {
  it("sees the brokerage's details and is told they are not theirs to change", async () => {
    const body = await read(joiner);
    expect(body.onboarding.company).toMatchObject({
      name: "Acme Brokers",
      canEdit: false,
      createdByYou: false,
    });
  });

  it("gets their own first day, separate from their colleague's", async () => {
    await save({ step: 3 }, amina);
    expect((await read(joiner)).onboarding.step).toBe(1);
    expect((await read(amina)).onboarding.step).toBe(3);
  });

  it("does not change the brokerage by going through it", async () => {
    await save({ step: 2 }, joiner);
    await complete(joiner);
    expect(db.tables["organizations"]![0]).toMatchObject({ name: "Acme Brokers", country: "KE" });
  });
});

describe("whoever created the brokerage", () => {
  it("is the one told they may edit it", async () => {
    const body = await read(amina);
    expect(body.onboarding.company).toMatchObject({ canEdit: true, createdByYou: true });
  });
});

describe("what is set up", () => {
  it("is counted from real rows, not from a step being marked done", async () => {
    await save({ recordsChoice: "upload", step: 4 });
    expect((await read()).onboarding.progress).toMatchObject({ documents: 0, clients: 0, imports: 0 });

    db.tables["documents"] = [{ id: "d1", organization_id: ORG }];
    db.tables["clients"] = [{ id: "c1", organization_id: ORG }];
    expect((await read()).onboarding.progress).toMatchObject({ documents: 1, clients: 1 });
  });

  it("counts only this brokerage's rows", async () => {
    db.tables["documents"] = [
      { id: "d1", organization_id: ORG },
      { id: "d2", organization_id: OTHER_ORG },
    ];
    expect((await read()).onboarding.progress.documents).toBe(1);
  });

  it("says a mailbox is connected only when one is", async () => {
    expect((await read()).onboarding.progress.mailboxConnected).toBe(false);
    db.tables["mailboxes"] = [{ id: "m1", organization_id: ORG, status: "connected" }];
    expect((await read()).onboarding.progress.mailboxConnected).toBe(true);
  });
});

describe("Gmail, honestly", () => {
  it("says it is not configured when this deployment has no credentials", async () => {
    const body = await read(amina, false);
    expect(body.onboarding.gmailConfigured).toBe(false);
    expect(body.onboarding.gmailUnavailableReason).toMatch(/not configured/i);
    // Words, never variable names.
    expect(body.onboarding.gmailUnavailableReason).not.toMatch(/CLIENT_ID|SECRET|OAUTH/);
  });

  it("offers it where the credentials exist", async () => {
    const body = await read(amina, true);
    expect(body.onboarding.gmailConfigured).toBe(true);
    expect(body.onboarding.gmailUnavailableReason).toBeNull();
  });

  it("never carries a token or a secret, in any shape", async () => {
    const body = await read(amina, true);
    expect(JSON.stringify(body)).not.toMatch(/token|secret|client_id/i);
  });
});
