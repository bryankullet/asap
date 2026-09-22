/**
 * Connecting a mailbox, and reading it under control.
 *
 * The callback has no session — the person arrives by a redirect from Google — so the state row is
 * the whole of its authentication, and most of what follows is about that row being impossible to
 * forge, reuse or outlast. The rest is about the pass that follows being bounded, repeatable and
 * honest about what it managed.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { decryptToken, hashOAuthState } from "../src/mailbox/crypto.js";
import { syncMailbox, AlreadySyncing } from "../src/mailbox/sync.js";
import type { FetchedMessage, MailboxProvider, SyncLimits } from "../src/mailbox/types.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const MAILBOX = "80000000-0000-4000-8000-000000000001";
const KEY = "a-test-encryption-key-of-at-least-32-chars";
const iso = "2026-09-05T09:00:00.000Z";

const LIMITS: SyncLimits = {
  windowDays: 30,
  maxThreads: 2,
  maxAttachments: 1,
  maxAttachmentBytes: 1024,
  attachmentMimeTypes: ["application/pdf"],
};

function message(over: Partial<FetchedMessage> = {}): FetchedMessage {
  return {
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
    ...over,
  };
}

/** A provider that answers from a script, so nothing in these tests touches a network. */
function provider(
  script: {
    page?: Partial<{ messages: FetchedMessage[]; cursor: string | null; checkpointExpired: boolean; reachedLimit: boolean }>;
    listThrows?: unknown;
    refresh?: "needs_reauthorisation" | { accessToken: string; refreshToken: string | null; expiresAt: string | null };
    exchange?:
      | { outcome: "connected"; emailAddress: string; accessToken: string; refreshToken: string | null }
      | { outcome: "failed"; reason: string };
    attachment?: Uint8Array | null;
  } = {},
): MailboxProvider & { calls: { list: number; attachments: number; revoked: number } } {
  const calls = { list: 0, attachments: 0, revoked: 0 };
  return {
    id: "gmail",
    calls,
    async list() {
      calls.list += 1;
      if (script.listThrows) throw script.listThrows;
      return {
        messages: script.page?.messages ?? [],
        cursor: script.page?.cursor ?? "history-2",
        checkpointExpired: script.page?.checkpointExpired ?? false,
        reachedLimit: script.page?.reachedLimit ?? false,
      };
    },
    async fetchAttachment() {
      calls.attachments += 1;
      return script.attachment ?? null;
    },
    async send() {
      return { outcome: "failed", reason: "not in this test" };
    },
    async refresh() {
      return script.refresh ?? "needs_reauthorisation";
    },
    async exchangeCode() {
      const e = script.exchange;
      if (!e || e.outcome === "failed") {
        return { outcome: "failed", reason: e?.reason ?? "no script" };
      }
      return {
        outcome: "connected",
        emailAddress: e.emailAddress,
        displayName: null,
        credentials: { accessToken: e.accessToken, refreshToken: e.refreshToken, expiresAt: null },
      };
    },
    async revoke() {
      calls.revoked += 1;
    },
  };
}

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
      role_permissions: [],
      mailboxes: [],
      mailbox_oauth_states: [],
      mailbox_sync_runs: [],
      email_threads: [],
      email_messages: [],
      email_attachments: [],
      documents: [],
      events: [],
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
    mailboxOAuth: {
      gmail: {
        clientId: "google-client",
        clientSecret: "google-secret",
        redirectUri: "https://api.test/mailboxes/oauth/gmail/callback",
      },
      microsoft: {},
    },
    ...(adapter
      ? { mailbox: { providers: { gmail: adapter }, limits: LIMITS, encryptionKey: KEY } }
      : {}),
  });

beforeEach(() => {
  db = makeDb();
});

const auth = { Authorization: "Bearer tok-amina" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

/** Start an authorisation and hand back the state Google would be given. */
async function startConnect(adapter?: MailboxProvider): Promise<string> {
  const res = await build(adapter).request("/mailboxes/connect", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "gmail" }),
  });
  const body = await readJson(res);
  return new URL(body.url).searchParams.get("state")!;
}

describe("starting an authorisation", () => {
  it("asks only for permission to read, because nothing can send", async () => {
    const state = await startConnect();
    expect(state).toBeTruthy();
    const url = new URL((await readJson(await build().request("/mailboxes/connect", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "gmail" }),
    }))).url);
    const scopes = (url.searchParams.get("scope") ?? "").split(" ");
    expect(scopes).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(scopes.some((s) => s.includes("gmail.send"))).toBe(false);
  });

  it("stores the state as a digest, never the value", async () => {
    const state = await startConnect();
    const rows = db.tables["mailbox_oauth_states"] ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]!["state_hash"]).toBe(hashOAuthState(state));
    expect(JSON.stringify(rows[0])).not.toContain(state);
  });

  it("gives it an expiry", async () => {
    await startConnect();
    const row = (db.tables["mailbox_oauth_states"] ?? [])[0]!;
    expect(new Date(String(row["expires_at"])).getTime()).toBeGreaterThan(Date.now());
  });
});

describe("the callback", () => {
  const callback = (adapter: MailboxProvider, query: string) =>
    build(adapter).request(`/mailboxes/oauth/gmail/callback?${query}`);

  it("exchanges the code on the server, stores the tokens encrypted, and returns none of it", async () => {
    const adapter = provider({
      exchange: {
        outcome: "connected",
        emailAddress: "broking@acme-brokers.test",
        accessToken: "the-access-token",
        refreshToken: "the-refresh-token",
      },
    });
    const state = await startConnect(adapter);

    const res = await callback(adapter, `code=the-code&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(302);
    const location = res.headers.get("location")!;
    expect(location).toContain("/connections?mailbox=connected");
    // Not the code, not a token, not the state: nothing sensitive survives into the URL.
    expect(location).not.toContain("the-code");
    expect(location).not.toContain("the-access-token");
    expect(location).not.toContain(state);

    const box = (db.tables["mailboxes"] ?? [])[0]!;
    // At rest it is ciphertext, and it is the real token when read back with the key.
    expect(box["access_token_encrypted"]).not.toBe("the-access-token");
    expect(decryptToken(String(box["access_token_encrypted"]), KEY)).toBe("the-access-token");
    expect(decryptToken(String(box["refresh_token_encrypted"]), KEY)).toBe("the-refresh-token");
  });

  it("asks for the first read rather than doing it in the callback", async () => {
    const adapter = provider({
      exchange: { outcome: "connected", emailAddress: "broking@acme-brokers.test", accessToken: "a", refreshToken: "r" },
    });
    const state = await startConnect(adapter);
    await callback(adapter, `code=c&state=${encodeURIComponent(state)}`);

    const events = (db.tables["events"] ?? []).filter((e) => e["event_type"] === "mailbox.sync_requested");
    expect(events).toHaveLength(1);
    // The callback did not read anything itself.
    expect(adapter.calls.list).toBe(0);
    expect(db.tables["mailbox_sync_runs"] ?? []).toHaveLength(0);
  });

  it("refuses a state that was never issued", async () => {
    const adapter = provider({ exchange: { outcome: "connected", emailAddress: "x@y.test", accessToken: "a", refreshToken: "r" } });
    const res = await callback(adapter, "code=c&state=not-a-state-we-issued");
    expect(res.headers.get("location")).toContain("mailbox=expired");
    expect(db.tables["mailboxes"] ?? []).toHaveLength(0);
  });

  it("refuses an expired state", async () => {
    const adapter = provider({ exchange: { outcome: "connected", emailAddress: "x@y.test", accessToken: "a", refreshToken: "r" } });
    const state = await startConnect(adapter);
    const row = (db.tables["mailbox_oauth_states"] ?? [])[0]!;
    row["expires_at"] = new Date(Date.now() - 1000).toISOString();

    const res = await callback(adapter, `code=c&state=${encodeURIComponent(state)}`);
    expect(res.headers.get("location")).toContain("mailbox=expired");
    expect(db.tables["mailboxes"] ?? []).toHaveLength(0);
  });

  it("is safe to deliver twice: the second finds the state spent", async () => {
    const adapter = provider({
      exchange: { outcome: "connected", emailAddress: "broking@acme-brokers.test", accessToken: "a", refreshToken: "r" },
    });
    const state = await startConnect(adapter);
    await callback(adapter, `code=c&state=${encodeURIComponent(state)}`);
    const second = await callback(adapter, `code=c&state=${encodeURIComponent(state)}`);

    expect(second.headers.get("location")).toContain("mailbox=expired");
    // One mailbox, and one request to read it.
    expect(db.tables["mailboxes"] ?? []).toHaveLength(1);
    expect((db.tables["events"] ?? []).filter((e) => e["event_type"] === "mailbox.sync_requested")).toHaveLength(1);
  });

  it("re-authorises the mailbox that exists rather than making a second one", async () => {
    const adapter = provider({
      exchange: { outcome: "connected", emailAddress: "broking@acme-brokers.test", accessToken: "a2", refreshToken: "r2" },
    });
    db.tables["mailboxes"] = [
      {
        id: MAILBOX,
        organization_id: ORG,
        provider: "gmail",
        email_address: "broking@acme-brokers.test",
        connected_by: AMINA.id,
        status: "needs_reauthorisation",
        status_reason: "expired",
        created_at: iso,
        updated_at: iso,
      },
    ];
    const state = await startConnect(adapter);
    await callback(adapter, `code=c&state=${encodeURIComponent(state)}`);

    expect(db.tables["mailboxes"]).toHaveLength(1);
    expect(db.tables["mailboxes"]![0]!["status"]).toBe("connected");
    expect(decryptToken(String(db.tables["mailboxes"]![0]!["access_token_encrypted"]), KEY)).toBe("a2");
  });

  it("says a refusal is a refusal, and connects nothing", async () => {
    const adapter = provider({ exchange: { outcome: "failed", reason: "Google refused the authorisation (400)." } });
    const state = await startConnect(adapter);
    const res = await callback(adapter, `code=c&state=${encodeURIComponent(state)}`);
    expect(res.headers.get("location")).toContain("mailbox=failed");
    expect(db.tables["mailboxes"] ?? []).toHaveLength(0);
    const audit = (db.tables["audit_log"] ?? []).find((r) => r["action"] === "mailbox.connect_failed");
    expect(audit).toBeDefined();
    expect(JSON.stringify(audit)).not.toContain("the-code");
  });
});

/* ---- Reading it ------------------------------------------------------------------------------ */

function connectedMailbox(over: Record<string, unknown> = {}) {
  db.tables["mailboxes"] = [
    {
      id: MAILBOX,
      organization_id: ORG,
      provider: "gmail",
      email_address: "broking@acme-brokers.test",
      display_name: null,
      connected_by: AMINA.id,
      status: "connected",
      status_reason: null,
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      token_expires_at: null,
      sync_cursor: null,
      sync_cursor_updated_at: null,
      last_synced_at: null,
      created_at: iso,
      updated_at: iso,
      ...over,
    },
  ];
}

const syncDeps = (adapter: MailboxProvider) => ({
  db: fakeFactory(db).service(),
  logger: pino({ level: "silent" }),
  provider: adapter,
  encryptionKey: KEY,
  bucket: "insurance-documents",
  limits: LIMITS,
});

describe("one pass over a mailbox", () => {
  it("saves a thread and its message, keyed on the provider's own ids", async () => {
    const { encryptToken } = await import("../src/mailbox/crypto.js");
    connectedMailbox({ access_token_encrypted: encryptToken("access", KEY) });
    const adapter = provider({ page: { messages: [message()] } });

    const out = await syncMailbox(syncDeps(adapter), { mailboxId: MAILBOX, trigger: "first_connection" });

    expect(out.state).toBe("succeeded");
    expect(out.messagesSaved).toBe(1);
    expect(db.tables["email_threads"]).toHaveLength(1);
    expect(db.tables["email_threads"]![0]!["provider_thread_id"]).toBe("gmail-thread-1");
    expect(db.tables["email_messages"]![0]!["provider_message_id"]).toBe("gmail-msg-1");
  });

  it("reads the same mail twice without duplicating anything", async () => {
    const { encryptToken } = await import("../src/mailbox/crypto.js");
    connectedMailbox({ access_token_encrypted: encryptToken("access", KEY) });
    const adapter = provider({ page: { messages: [message()] } });

    await syncMailbox(syncDeps(adapter), { mailboxId: MAILBOX, trigger: "first_connection" });
    const second = await syncMailbox(syncDeps(adapter), { mailboxId: MAILBOX, trigger: "person" });

    expect(db.tables["email_threads"]).toHaveLength(1);
    expect(db.tables["email_messages"]).toHaveLength(1);
    // The second pass saw it and saved nothing, which is the honest count.
    expect(second.messagesSaved).toBe(0);
  });

  it("files an attachment once, through the ordinary document pipeline", async () => {
    const { encryptToken } = await import("../src/mailbox/crypto.js");
    connectedMailbox({ access_token_encrypted: encryptToken("access", KEY) });
    const adapter = provider({
      page: {
        messages: [
          message({
            attachments: [
              { providerAttachmentId: "att-1", filename: "terms.pdf", mimeType: "application/pdf", byteSize: 64 },
            ],
          }),
        ],
      },
      attachment: new Uint8Array([1, 2, 3, 4]),
    });

    const first = await syncMailbox(syncDeps(adapter), { mailboxId: MAILBOX, trigger: "first_connection" });
    expect(first.attachmentsSaved).toBe(1);
    expect(db.tables["documents"]).toHaveLength(1);
    expect(db.tables["documents"]![0]!["extraction_state"]).toBe("queued");
    // The ordinary pipeline is what reads it: the same event an uploaded file emits.
    expect((db.tables["events"] ?? []).filter((e) => e["event_type"] === "document.received")).toHaveLength(1);
    expect(db.tables["email_attachments"]![0]!["document_id"]).toBe(db.tables["documents"]![0]!["id"]);

    await syncMailbox(syncDeps(adapter), { mailboxId: MAILBOX, trigger: "person" });
    expect(db.tables["documents"]).toHaveLength(1);
    expect(db.tables["email_attachments"]).toHaveLength(1);
  });

  it("records an attachment it will not file, and does not fetch its bytes", async () => {
    const { encryptToken } = await import("../src/mailbox/crypto.js");
    connectedMailbox({ access_token_encrypted: encryptToken("access", KEY) });
    const adapter = provider({
      page: {
        messages: [
          message({
            attachments: [
              { providerAttachmentId: "att-1", filename: "big.pdf", mimeType: "application/pdf", byteSize: 999_999 },
            ],
          }),
        ],
      },
      attachment: new Uint8Array([1]),
    });

    const out = await syncMailbox(syncDeps(adapter), { mailboxId: MAILBOX, trigger: "person" });
    expect(out.attachmentsSaved).toBe(0);
    expect(adapter.calls.attachments).toBe(0);
    // It is still on the record, so a person can see the message carried a file.
    expect(db.tables["email_attachments"]).toHaveLength(1);
    expect(db.tables["documents"] ?? []).toHaveLength(0);
  });

  it("moves the checkpoint forward, and a stale pass cannot move it back", async () => {
    const { encryptToken } = await import("../src/mailbox/crypto.js");
    connectedMailbox({ access_token_encrypted: encryptToken("access", KEY) });
    const adapter = provider({ page: { messages: [message()], cursor: "history-9" } });

    await syncMailbox(syncDeps(adapter), { mailboxId: MAILBOX, trigger: "first_connection" });
    expect(db.tables["mailboxes"]![0]!["sync_cursor"]).toBe("history-9");

    /*
     * A pass that read the checkpoint, then had a faster one overtake it while it was working.
     * Its own write is conditional on the checkpoint not having moved, so it finds the newer one
     * and leaves it alone — rather than rewinding the mailbox to where it started.
     */
    const overtaken: MailboxProvider = {
      ...provider({ page: { messages: [], cursor: "history-3" } }),
      async list() {
        // While this pass was reading, another finished and wrote a newer checkpoint.
        db.tables["mailboxes"]![0]!["sync_cursor"] = "history-12";
        db.tables["mailboxes"]![0]!["sync_cursor_updated_at"] = "2099-01-01T00:00:00.000Z";
        return { messages: [], cursor: "history-3", checkpointExpired: false, reachedLimit: false };
      },
    };
    await syncMailbox({ ...syncDeps(adapter), provider: overtaken }, { mailboxId: MAILBOX, trigger: "schedule" });

    expect(db.tables["mailboxes"]![0]!["sync_cursor"]).toBe("history-12");
  });

  it("keeps what it saved when the provider stops half way", async () => {
    const { encryptToken } = await import("../src/mailbox/crypto.js");
    connectedMailbox({ access_token_encrypted: encryptToken("access", KEY), sync_cursor: "history-1" });
    const rateLimited = Object.assign(new Error("429"), { status: 429 });
    const adapter = provider({ listThrows: rateLimited });

    const out = await syncMailbox(syncDeps(adapter), { mailboxId: MAILBOX, trigger: "person" });

    expect(out.state).toBe("failed");
    expect(out.error).toMatch(/slow down/i);
    // The checkpoint is where it was: a retry resumes rather than skipping mail.
    expect(db.tables["mailboxes"]![0]!["sync_cursor"]).toBe("history-1");
    const run = db.tables["mailbox_sync_runs"]!.at(-1)!;
    expect(run["state"]).toBe("failed");
    expect(run["cursor_after"]).toBeNull();
  });

  it("says a mailbox needs reconnecting rather than reading nothing quietly", async () => {
    const { encryptToken } = await import("../src/mailbox/crypto.js");
    connectedMailbox({
      access_token_encrypted: encryptToken("stale", KEY),
      refresh_token_encrypted: encryptToken("refresh", KEY),
      token_expires_at: "2020-01-01T00:00:00.000Z",
    });
    const adapter = provider({ refresh: "needs_reauthorisation" });

    const out = await syncMailbox(syncDeps(adapter), { mailboxId: MAILBOX, trigger: "schedule" });

    expect(out.state).toBe("failed");
    expect(db.tables["mailboxes"]![0]!["status"]).toBe("needs_reauthorisation");
    expect(adapter.calls.list).toBe(0);
  });

  it("refuses to read a disconnected mailbox", async () => {
    connectedMailbox({ status: "disconnected" });
    await expect(
      syncMailbox(syncDeps(provider()), { mailboxId: MAILBOX, trigger: "person" }),
    ).rejects.toThrow(/disconnected/i);
  });

  it("reports a checkpoint the provider had expired", async () => {
    const { encryptToken } = await import("../src/mailbox/crypto.js");
    connectedMailbox({ access_token_encrypted: encryptToken("access", KEY), sync_cursor: "very-old" });
    const adapter = provider({ page: { messages: [message()], checkpointExpired: true } });

    const out = await syncMailbox(syncDeps(adapter), { mailboxId: MAILBOX, trigger: "schedule" });
    expect(out.checkpointExpired).toBe(true);
    expect(db.tables["mailbox_sync_runs"]!.at(-1)!["checkpoint_expired"]).toBe(true);
  });

  it("says when it stopped at a limit rather than at the end", async () => {
    const { encryptToken } = await import("../src/mailbox/crypto.js");
    connectedMailbox({ access_token_encrypted: encryptToken("access", KEY) });
    const adapter = provider({ page: { messages: [message()], reachedLimit: true } });
    const out = await syncMailbox(syncDeps(adapter), { mailboxId: MAILBOX, trigger: "first_connection" });
    expect(out.moreWaiting).toBe(true);
  });
});

describe("asking for a pass", () => {
  it("emits one event and writes an audit row", async () => {
    connectedMailbox();
    const res = await build().request(`/mailboxes/${MAILBOX}/sync`, { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect((await readJson(res)).requested).toBe(true);
    expect((db.tables["events"] ?? []).filter((e) => e["event_type"] === "mailbox.sync_requested")).toHaveLength(1);
    expect((db.tables["audit_log"] ?? []).some((r) => r["action"] === "mailbox.sync_requested")).toBe(true);
  });

  it("joins the pass that is already going rather than starting a second", async () => {
    connectedMailbox();
    db.tables["mailbox_sync_runs"] = [
      { id: "99000000-0000-4000-8000-00000000000a", organization_id: ORG, mailbox_id: MAILBOX, state: "running", started_at: iso },
    ];
    const body = await readJson(await build().request(`/mailboxes/${MAILBOX}/sync`, { method: "POST", headers: auth }));
    expect(body.requested).toBe(false);
    expect(body.runId).toBe("99000000-0000-4000-8000-00000000000a");
    expect(db.tables["events"] ?? []).toHaveLength(0);
  });

  it("refuses a mailbox that is not this brokerage's", async () => {
    connectedMailbox({ organization_id: OTHER_ORG });
    const res = await build().request(`/mailboxes/${MAILBOX}/sync`, { method: "POST", headers: auth });
    expect(res.status).toBe(404);
    expect(db.tables["events"] ?? []).toHaveLength(0);
  });

  it("refuses a mailbox that needs authorising again, and says so", async () => {
    connectedMailbox({ status: "needs_reauthorisation", status_reason: "Google would not renew it." });
    const res = await build().request(`/mailboxes/${MAILBOX}/sync`, { method: "POST", headers: auth });
    expect(res.status).toBe(409);
  });
});

describe("disconnecting", () => {
  it("tells the provider, clears the tokens, and is safe to repeat", async () => {
    const { encryptToken } = await import("../src/mailbox/crypto.js");
    connectedMailbox({
      access_token_encrypted: encryptToken("access", KEY),
      refresh_token_encrypted: encryptToken("refresh", KEY),
      sync_cursor: "history-4",
    });
    const adapter = provider();

    expect((await build(adapter).request(`/mailboxes/${MAILBOX}`, { method: "DELETE", headers: auth })).status).toBe(204);
    expect(adapter.calls.revoked).toBe(1);
    const box = db.tables["mailboxes"]![0]!;
    expect(box["status"]).toBe("disconnected");
    expect(box["access_token_encrypted"]).toBeNull();
    expect(box["refresh_token_encrypted"]).toBeNull();

    // Again: nothing left to revoke, same result.
    expect((await build(adapter).request(`/mailboxes/${MAILBOX}`, { method: "DELETE", headers: auth })).status).toBe(204);
    expect(adapter.calls.revoked).toBe(1);
    expect(db.tables["mailboxes"]![0]!["status"]).toBe("disconnected");
  });
});

describe("what a mailbox says about itself", () => {
  it("never carries a token, and says Syncing only while a run is running", async () => {
    const { encryptToken } = await import("../src/mailbox/crypto.js");
    connectedMailbox({ access_token_encrypted: encryptToken("access-token-value", KEY) });
    db.tables["mailbox_sync_runs"] = [
      {
        id: "99000000-0000-4000-8000-00000000000a",
        organization_id: ORG,
        mailbox_id: MAILBOX,
        state: "running",
        started_at: iso,
        messages_saved: 0,
        attachments_saved: 0,
        checkpoint_expired: false,
      },
    ];
    const r = await build().request("/mailboxes", { headers: auth });
    if (r.status !== 200) throw new Error(`${r.status} ${await r.text()}`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await r.json()) as any;
    expect(body.mailboxes[0].sync.state).toBe("syncing");
    expect(JSON.stringify(body)).not.toContain("access-token-value");
  });

  it("reports a failure with what was already saved", async () => {
    connectedMailbox({ sync_cursor: "history-2" });
    db.tables["mailbox_sync_runs"] = [
      {
        id: "99000000-0000-4000-8000-00000000000b",
        organization_id: ORG,
        mailbox_id: MAILBOX,
        state: "failed",
        error: "Google asked us to slow down. Nothing more was read this time.",
        started_at: iso,
        finished_at: iso,
        messages_saved: 40,
        attachments_saved: 2,
        checkpoint_expired: false,
      },
    ];
    const body = await readJson(await build().request("/mailboxes", { headers: auth }));
    expect(body.mailboxes[0].sync).toMatchObject({
      state: "failed",
      messagesSaved: 40,
      hasCheckpoint: true,
      canStart: true,
    });
  });
});

describe("AlreadySyncing", () => {
  it("is what a caller sees when a pass is going", () => {
    expect(new AlreadySyncing("x")).toBeInstanceOf(Error);
  });
});
