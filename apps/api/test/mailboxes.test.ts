/**
 * Mailboxes: the email the brokerage already works from (D-068).
 *
 * Two rules this surface exists to keep:
 *   - a response never carries a token, whatever else it carries;
 *   - a deployment without OAuth credentials says so, in words, rather than offering a connection
 *     that cannot work.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const MAILBOX = "80000000-0000-4000-8000-000000000001";
const iso = "2026-09-05T09:00:00.000Z";

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA },
    inserts: [],
    rpc: {},
    tables: {
      users: [
        { id: AMINA.id, email: AMINA.email, full_name: "Amina", display_name: null, active_organization_id: ORG },
      ],
      organization_memberships: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          user_id: AMINA.id,
          is_owner: true,
          status: "active",
          joined_at: "2026-01-01T00:00:00Z",
          organization: { id: ORG, name: "Acme", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
          role: { id: "30000000-0000-4000-8000-000000000001", key: "brokerage_admin", name: "Admin", description: null, is_system: true },
        },
      ],
      role_permissions: [],
      mailboxes: [
        {
          id: MAILBOX,
          organization_id: ORG,
          provider: "gmail",
          email_address: "broking@acme-brokers.test",
          display_name: "Acme broking",
          connected_by: AMINA.id,
          // Present in the row, and never in a response.
          access_token_encrypted: "encrypted-access-token",
          refresh_token_encrypted: "encrypted-refresh-token",
          token_expires_at: iso,
          sync_cursor: "12345",
          last_synced_at: iso,
          status: "connected",
          status_reason: null,
          created_at: iso,
          updated_at: iso,
        },
      ],
      audit_log: [],
    },
  };
}

let db: FakeDb;
const silentMailer: Mailer = { sendInvitation: async () => {} };
const build = (oauth?: Parameters<typeof createApp>[0]["mailboxOAuth"]) =>
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
    ...(oauth ? { mailboxOAuth: oauth } : {}),
  });

beforeEach(() => {
  db = makeDb();
});

const auth = { Authorization: "Bearer tok-amina" };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

describe("GET /mailboxes", () => {
  it("requires a session", async () => {
    expect((await build().request("/mailboxes")).status).toBe(401);
  });

  it("never returns a token, whatever else it returns", async () => {
    const res = await build().request("/mailboxes", { headers: auth });
    const body = await readJson(res);
    expect(body.mailboxes[0]).toMatchObject({
      emailAddress: "broking@acme-brokers.test",
      status: "connected",
    });
    // The row holds both tokens. The response must hold neither, in any shape or key.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("encrypted-access-token");
    expect(serialised).not.toContain("encrypted-refresh-token");
    expect(serialised).not.toMatch(/token/i);
  });

  it("says which providers this deployment could connect, and why not", async () => {
    const body = await readJson(await build().request("/mailboxes", { headers: auth }));
    expect(body.providers).toHaveLength(2);
    for (const p of body.providers) {
      expect(p.available).toBe(false);
      expect(p.unavailableReason).toMatch(/credentials/i);
      // Words, never variable names: a browser learns nothing about the configuration itself.
      expect(p.unavailableReason).not.toMatch(/CLIENT_ID|SECRET|OAUTH/);
    }
  });
});

describe("POST /mailboxes/connect", () => {
  it("refuses honestly when the deployment has no credentials", async () => {
    const body = await readJson(
      await build().request("/mailboxes/connect", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "gmail" }),
      }),
    );
    expect(body).toMatchObject({ outcome: "not_configured" });
    expect(body.reason).toMatch(/Google credentials/);
  });

  it("sends a person to the provider, asking for offline access, when it can", async () => {
    const app = build({
      gmail: {
        clientId: "client-id-here",
        clientSecret: "shh",
        redirectUri: "https://api.example.test/mailboxes/callback",
      },
      microsoft: {},
    });
    const body = await readJson(
      await app.request("/mailboxes/connect", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "gmail" }),
      }),
    );
    expect(body.outcome).toBe("authorise");
    const url = new URL(body.url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("client-id-here");
    // Without these Google returns no refresh token on a repeat authorisation, and the connection
    // dies silently an hour later.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBeTruthy();
    // The secret stays on the server. It has no business in a URL a browser follows.
    expect(body.url).not.toContain("shh");
  });
});

describe("DELETE /mailboxes/:id", () => {
  it("keeps the row as history and clears what could read or send", async () => {
    const res = await build().request(`/mailboxes/${MAILBOX}`, { method: "DELETE", headers: auth });
    expect(res.status).toBe(204);
    const row = db.tables["mailboxes"]![0] as Record<string, unknown>;
    expect(row["status"]).toBe("disconnected");
    expect(row["access_token_encrypted"]).toBeNull();
    expect(row["refresh_token_encrypted"]).toBeNull();
  });

  it("cannot disconnect a mailbox in another brokerage", async () => {
    (db.tables["mailboxes"]![0] as Record<string, unknown>)["organization_id"] =
      "10000000-0000-4000-8000-00000000000b";
    const res = await build().request(`/mailboxes/${MAILBOX}`, { method: "DELETE", headers: auth });
    expect(res.status).toBe(404);
  });
});
