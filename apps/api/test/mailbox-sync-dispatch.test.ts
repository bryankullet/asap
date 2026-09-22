/**
 * The worker path for reading a mailbox.
 *
 * The worker schedules and the API is the engine (§29): a `mailbox.sync_requested` event is
 * claimed by the worker, dispatched here with a shared secret, and the pass runs behind the
 * caller's own rights. What these lock is the seam itself — that the event reaches the consumer,
 * that a second delivery of the same event cannot read the same mail twice, and that a deployment
 * with no provider says so rather than failing.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { encryptToken } from "../src/mailbox/crypto.js";
import type { FetchedMessage, MailboxProvider, SyncLimits } from "../src/mailbox/types.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const MAILBOX = "80000000-0000-4000-8000-000000000001";
const EVENT = "e0000000-0000-4000-8000-000000000001";
const KEY = "worker-secret-0123456789abcdef";
const ENC = "a-test-encryption-key-of-at-least-32-chars";
const iso = "2026-09-05T09:00:00.000Z";

const LIMITS: SyncLimits = {
  windowDays: 30,
  maxThreads: 10,
  maxAttachments: 5,
  maxAttachmentBytes: 1_048_576,
  attachmentMimeTypes: ["application/pdf"],
};

const MESSAGE: FetchedMessage = {
  providerMessageId: "gmail-msg-1",
  providerThreadId: "gmail-thread-1",
  direction: "inbound",
  from: "ops@jubilee.test",
  to: ["broking@acme-brokers.test"],
  cc: [],
  subject: "Renewal terms",
  bodyText: "Terms attached.",
  snippet: "Terms attached.",
  sentAt: iso,
  attachments: [],
};

function provider(messages: FetchedMessage[] = [MESSAGE]): MailboxProvider & { listed: number } {
  const p = {
    id: "gmail" as const,
    listed: 0,
    async list() {
      p.listed += 1;
      return { messages, cursor: "history-2", checkpointExpired: false, reachedLimit: false };
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
  };
  return p;
}

function makeDb(): FakeDb {
  return {
    users: {},
    inserts: [],
    rpc: {},
    tables: {
      events: [
        {
          id: EVENT,
          organization_id: ORG,
          event_type: "mailbox.sync_requested",
          entity_type: "mailbox",
          entity_id: MAILBOX,
          payload: { trigger: "first_connection" },
        },
      ],
      mailboxes: [
        {
          id: MAILBOX,
          organization_id: ORG,
          provider: "gmail",
          email_address: "broking@acme-brokers.test",
          display_name: null,
          connected_by: "a0000000-0000-4000-8000-000000000001",
          status: "connected",
          status_reason: null,
          access_token_encrypted: encryptToken("access", ENC),
          refresh_token_encrypted: null,
          token_expires_at: null,
          sync_cursor: null,
          sync_cursor_updated_at: null,
          last_synced_at: null,
          created_at: iso,
          updated_at: iso,
        },
      ],
      mailbox_sync_runs: [],
      email_threads: [],
      email_messages: [],
      email_attachments: [],
      documents: [],
      automations: [],
      work_items: [],
      audit_log: [],
    },
  };
}

let db: FakeDb;
const silentMailer: Mailer = { sendInvitation: async () => {} };

const build = (adapter?: MailboxProvider) =>
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
    apiInternalKey: KEY,
    ...(adapter
      ? { mailbox: { providers: { gmail: adapter }, limits: LIMITS, encryptionKey: ENC } }
      : {}),
  });

beforeEach(() => {
  db = makeDb();
});

const internal = { "x-asap-internal-key": KEY };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

const dispatch = (adapter?: MailboxProvider) =>
  build(adapter).request(`/internal/events/${EVENT}/dispatch`, { method: "POST", headers: internal });

describe("dispatching a mailbox sync", () => {
  it("is not reachable without the worker's key", async () => {
    const res = await build(provider()).request(`/internal/events/${EVENT}/dispatch`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(db.tables["mailbox_sync_runs"]).toHaveLength(0);
  });

  it("runs the pass and reports what it saved", async () => {
    const adapter = provider();
    const body = await readJson(await dispatch(adapter));
    const result = body.results.find((r: { consumer: string }) => r.consumer === "mailbox_sync");
    expect(result.result).toBe("success");
    expect(result.detail).toMatch(/1 messages/);
    expect(adapter.listed).toBe(1);
    expect(db.tables["email_messages"]).toHaveLength(1);
    expect(db.tables["mailbox_sync_runs"]![0]!["state"]).toBe("succeeded");
  });

  it("delivered twice, reads the same mail once", async () => {
    const adapter = provider();
    await dispatch(adapter);
    await dispatch(adapter);
    expect(db.tables["email_messages"]).toHaveLength(1);
    expect(db.tables["email_threads"]).toHaveLength(1);
  });

  it("says plainly that nothing reads a mailbox when no provider is configured", async () => {
    const body = await readJson(await dispatch());
    const result = body.results.find((r: { consumer: string }) => r.consumer === "mailbox_sync");
    expect(result.result).toBe("skipped");
    expect(result.detail).toMatch(/no mailbox provider/i);
    // Skipped is not failed: there is nothing here for a dispatcher to retry into.
    expect(db.tables["mailbox_sync_runs"]).toHaveLength(0);
  });

  it("reports a failed pass as a failure, with what it managed", async () => {
    const broken: MailboxProvider = {
      ...provider(),
      async list() {
        throw Object.assign(new Error("boom"), { status: 500 });
      },
    };
    const body = await readJson(await dispatch(broken));
    const result = body.results.find((r: { consumer: string }) => r.consumer === "mailbox_sync");
    expect(result.result).toBe("failure");
    expect(db.tables["mailbox_sync_runs"]![0]!["state"]).toBe("failed");
    // The provider's own words never travel: no url, no token, no message body.
    expect(result.detail).not.toMatch(/boom|googleapis|Bearer/);
  });
});
