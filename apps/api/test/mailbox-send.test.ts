/**
 * Sending: approval, idempotency, and evidence.
 *
 * The failure this suite exists to prevent is a client receiving the same letter twice, and its
 * twin — ASAP telling a broker something went out when nobody can prove it did. Every case here
 * is one of those two.
 */
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendThroughMailbox } from "../src/mailbox/send.js";
import type { MailboxProvider, OutgoingMessage, SendOutcome } from "../src/mailbox/types.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const APPROVER = "a0000000-0000-4000-8000-000000000001";
const MAILBOX = "b1000000-0000-4000-8000-00000000000a";
const logger = pino({ level: "silent" });

// Hono's Context, only as much as recordAudit reads from it.
const ctx = { req: { header: () => undefined } } as never;

function provider(outcome: SendOutcome): MailboxProvider {
  return {
    id: "gmail",
    list: async () => ({ messages: [], cursor: null }),
    send: async () => outcome,
    refresh: async () => "needs_reauthorisation",
  };
}

const message: OutgoingMessage = {
  to: ["underwriting@jubilee.test"],
  cc: [],
  subject: "Acme Motors renewal — terms request",
  bodyText: "Please quote the attached schedule.",
  replyToProviderThreadId: null,
  idempotencyKey: "work-item-1:request_terms:v1",
};

function makeDb(): FakeDb {
  return {
    users: {},
    inserts: [],
    rpc: {},
    defaults: { email_send_attempts: { outcome: "preparing", provider_message_id: null } },
    // The constraint the whole idempotency guarantee rests on (0035).
    uniques: { email_send_attempts: [["mailbox_id", "idempotency_key"]] },
    tables: { email_send_attempts: [], audit_log: [] },
  };
}

describe("sending through a mailbox", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = makeDb();
  });

  const send = (p: MailboxProvider, over: Partial<OutgoingMessage> = {}) =>
    sendThroughMailbox({
      db: fakeFactory(db).forUser("t"),
      logger,
      c: ctx,
      organizationId: ORG,
      approverId: APPROVER,
      mailbox: {
        id: MAILBOX,
        provider: p,
        credentials: { accessToken: "a", refreshToken: null, expiresAt: null },
      },
      message: { ...message, ...over },
      workItemId: null,
      draftId: null,
    });

  it("records the provider's id as the evidence that it went", async () => {
    const result = await send(
      provider({ outcome: "sent", providerMessageId: "gm-1", providerThreadId: "th-1", acceptedAt: "2026-09-11T09:00:00Z" }),
    );
    expect(result.state).toBe("sent");
    const row = (db.tables["email_send_attempts"] as Record<string, unknown>[])[0]!;
    expect(row["outcome"]).toBe("sent");
    expect(row["provider_message_id"]).toBe("gm-1");
    expect(row["provider_accepted_at"]).toBe("2026-09-11T09:00:00Z");
  });

  it("keeps an unknown outcome unknown, rather than rounding it to sent or failed", async () => {
    const result = await send(provider({ outcome: "outcome_unknown", reason: "Gmail did not answer in time." }));
    expect(result.state).toBe("outcome_unknown");
    const row = (db.tables["email_send_attempts"] as Record<string, unknown>[])[0]!;
    expect(row["outcome"]).toBe("outcome_unknown");
    // No evidence, so nothing may claim it was sent.
    expect(row["provider_message_id"]).toBeNull();
    expect(row["failure_reason"]).toMatch(/did not answer/);
  });

  it("does not send a second time for the same intent", async () => {
    const sent = provider({ outcome: "sent", providerMessageId: "gm-1", providerThreadId: null, acceptedAt: "2026-09-11T09:00:00Z" });
    const spy = vi.spyOn(sent, "send");
    await send(sent);
    const second = await send(sent);

    expect(second.state).toBe("already_attempted");
    // The provider was asked exactly once, however many times the intent arrived.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(db.tables["email_send_attempts"]).toHaveLength(1);
  });

  it("retrying a timed-out send reports the unknown attempt instead of sending again", async () => {
    const unknown = provider({ outcome: "outcome_unknown", reason: "Gmail did not answer in time." });
    const spy = vi.spyOn(unknown, "send");
    await send(unknown);
    // A person clicks send again. The same intent carries the same key.
    const retry = await send(unknown);
    expect(retry.state).toBe("already_attempted");
    expect(retry).toMatchObject({ outcome: "outcome_unknown" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a different message is a different intent, and does send", async () => {
    const sent = provider({ outcome: "sent", providerMessageId: "gm-2", providerThreadId: null, acceptedAt: "2026-09-11T09:00:00Z" });
    const spy = vi.spyOn(sent, "send");
    await send(sent);
    await send(sent, { idempotencyKey: "work-item-1:chase:v1" });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(db.tables["email_send_attempts"]).toHaveLength(2);
  });

  it("records who approved it, on the attempt itself", async () => {
    await send(provider({ outcome: "failed", reason: "Gmail refused the message (400)." }));
    const row = (db.tables["email_send_attempts"] as Record<string, unknown>[])[0]!;
    expect(row["approved_by"]).toBe(APPROVER);
    expect(row["approved_at"]).toBeTruthy();
  });

  it("audits the attempt without copying the subject or the body", async () => {
    await send(provider({ outcome: "sent", providerMessageId: "gm-3", providerThreadId: null, acceptedAt: "2026-09-11T09:00:00Z" }));
    const audit = db.inserts.filter((i) => i.table === "audit_log");
    expect(audit).toHaveLength(1);
    const serialised = JSON.stringify(audit[0]);
    expect(serialised).toContain("gm-3");
    expect(serialised).not.toContain("Please quote the attached schedule");
    expect(serialised).not.toContain("Acme Motors renewal — terms request");
  });
});
