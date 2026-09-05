import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { hashInvitationToken } from "../src/tokens.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG_A = "10000000-0000-4000-8000-00000000000a";
const ORG_B = "10000000-0000-4000-8000-00000000000b";
const ROLE_ADMIN = "30000000-0000-4000-8000-000000000001";
const ROLE_RO = "30000000-0000-4000-8000-000000000002";
const ADMIN = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const READER = { id: "c0000000-0000-4000-8000-000000000001", email: "shared@consultant.test" };

function makeDb(): FakeDb {
  return {
    users: { "tok-admin": ADMIN, "tok-reader": READER },
    inserts: [],
    tables: {
      users: [
        {
          id: ADMIN.id,
          email: ADMIN.email,
          full_name: "Amina",
          display_name: null,
          active_organization_id: ORG_A,
        },
        {
          id: READER.id,
          email: READER.email,
          full_name: "Grace",
          display_name: null,
          active_organization_id: ORG_A,
        },
      ],
      organization_memberships: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          organization_id: ORG_A,
          user_id: ADMIN.id,
          is_owner: true,
          status: "active",
          joined_at: "2026-01-01T00:00:00Z",
          organization: {
            id: ORG_A,
            name: "Acme",
            country: "KE",
            currency: "KES",
            timezone: "Africa/Nairobi",
          },
          role: {
            id: ROLE_ADMIN,
            key: "brokerage_admin",
            name: "Brokerage administrator",
            description: null,
            is_system: true,
          },
          user: {
            id: ADMIN.id,
            email: ADMIN.email,
            full_name: "Amina",
            display_name: null,
            last_seen_at: null,
          },
        },
        {
          id: "60000000-0000-4000-8000-000000000002",
          organization_id: ORG_A,
          user_id: READER.id,
          is_owner: false,
          status: "active",
          joined_at: "2026-01-02T00:00:00Z",
          organization: {
            id: ORG_A,
            name: "Acme",
            country: "KE",
            currency: "KES",
            timezone: "Africa/Nairobi",
          },
          role: {
            id: ROLE_RO,
            key: "read_only",
            name: "Read-only user",
            description: null,
            is_system: true,
          },
          user: {
            id: READER.id,
            email: READER.email,
            full_name: "Grace",
            display_name: null,
            last_seen_at: null,
          },
        },
      ],
      role_permissions: [
        { role_id: ROLE_ADMIN, permission: { object_type: "user", verb: "view" } },
        { role_id: ROLE_ADMIN, permission: { object_type: "user", verb: "create" } },
        { role_id: ROLE_RO, permission: { object_type: "client", verb: "view" } },
      ],
      roles: [
        {
          id: ROLE_RO,
          key: "read_only",
          name: "Read-only user",
          description: null,
          is_system: true,
        },
      ],
      invitations: [],
    },
    rpc: {
      create_organization: (args) =>
        args["p_accepted_terms"] === true
          ? { data: "40000000-0000-4000-8000-000000000001" }
          : { error: { code: "22023", message: "terms_not_accepted" } },
      set_active_organization: (args) =>
        args["p_organization_id"] === ORG_A
          ? {}
          : { error: { code: "42501", message: "not_a_member" } },
      create_invitation: (args) =>
        typeof args["p_token_hash"] === "string" && (args["p_token_hash"] as string).length === 64
          ? { data: "50000000-0000-4000-8000-000000000001" }
          : { error: { code: "22023", message: "invalid_hash" } },
      accept_invitation: (args) =>
        args["p_token_hash"] === hashInvitationToken("a".repeat(43))
          ? { data: ORG_A }
          : { error: { code: "22023", message: "invitation_expired" } },
      invitation_preview: () => ({
        data: [
          {
            organization_name: "Acme",
            role_name: "Claims officer",
            email: "x@y.test",
            status: "pending",
            expires_at: "2030-01-01T00:00:00Z",
          },
        ],
      }),
    },
  };
}

class CapturingMailer implements Mailer {
  sent: { to: string; acceptUrl: string }[] = [];
  async sendInvitation(m: { to: string; acceptUrl: string }) {
    this.sent.push({ to: m.to, acceptUrl: m.acceptUrl });
  }
}

let db: FakeDb;
let mailer: CapturingMailer;
let app: ReturnType<typeof createApp>;

beforeEach(() => {
  db = makeDb();
  mailer = new CapturingMailer();
  app = createApp({
    logger: pino({ level: "silent" }),
    build: { version: "t", commit: "t" },
    supabase: fakeFactory(db),
    mailer,
    webBaseUrl: "http://localhost:5173",
    invitationTtlHours: 168,
    exposeAcceptUrl: true,
  });
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
// Test-only: response bodies are asserted field by field, so a loose type is the honest one here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();
const json = (body: unknown, token: string) => ({
  method: "POST",
  headers: { ...auth(token), "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

describe("authentication", () => {
  it("rejects requests without a bearer token", async () => {
    const res = await app.request("/me");
    expect(res.status).toBe(401);
    expect(await readJson(res)).toEqual({ error: "missing_bearer_token" });
  });
  it("rejects an unknown token", async () => {
    const res = await app.request("/me", { headers: auth("nope") });
    expect(res.status).toBe(401);
  });
});

describe("GET /me", () => {
  it("resolves memberships, active organization and permissions server-side", async () => {
    const res = await app.request("/me", { headers: auth("tok-admin") });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.active_organization.id).toBe(ORG_A);
    expect(body.memberships).toHaveLength(1);
    expect(body.permissions).toEqual(["user:create", "user:view"]);
  });

  it("drops the active organization when the membership is no longer active", async () => {
    db.tables["organization_memberships"]![0]!["status"] = "removed";
    const res = await app.request("/me", { headers: auth("tok-admin") });
    const body = await readJson(res);
    expect(body.active_organization).toBeNull();
    expect(body.permissions).toEqual([]);
  });
});

describe("POST /me/active-organization", () => {
  it("refuses an organization the user does not belong to", async () => {
    const res = await app.request(
      "/me/active-organization",
      json({ organization_id: ORG_B }, "tok-admin"),
    );
    expect(res.status).toBe(403);
    expect((await readJson(res)).error).toBe("not_a_member");
  });
  it("switches to a member organization", async () => {
    const res = await app.request(
      "/me/active-organization",
      json({ organization_id: ORG_A }, "tok-admin"),
    );
    expect(res.status).toBe(204);
  });
});

describe("POST /organizations", () => {
  it("validates the body and requires accepted terms", async () => {
    const res = await app.request(
      "/organizations",
      json(
        {
          name: "X",
          country: "Kenya",
          currency: "KES",
          timezone: "Africa/Nairobi",
          accepted_terms: false,
        },
        "tok-admin",
      ),
    );
    expect(res.status).toBe(422);
    const body = await readJson(res);
    expect(body.error).toBe("validation_failed");
    expect(body.details.map((d: { path: string }) => d.path)).toEqual(
      expect.arrayContaining(["name", "country", "accepted_terms"]),
    );
  });
  it("creates the brokerage and returns its id", async () => {
    const res = await app.request(
      "/organizations",
      json(
        {
          name: "Gamma Cover",
          country: "ke",
          currency: "kes",
          timezone: "Africa/Nairobi",
          accepted_terms: true,
        },
        "tok-admin",
      ),
    );
    expect(res.status).toBe(201);
    expect((await readJson(res)).organization_id).toMatch(/^40000000/);
  });
});

describe("members", () => {
  it("lists members for a role with user:view", async () => {
    const res = await app.request("/organizations/current/members", { headers: auth("tok-admin") });
    expect(res.status).toBe(200);
    expect((await readJson(res)).members).toHaveLength(2);
  });
  it("denies a role without user:view and writes a denied audit row", async () => {
    const res = await app.request("/organizations/current/members", {
      headers: auth("tok-reader"),
    });
    expect(res.status).toBe(403);
    const audit = db.inserts.find((i) => i.table === "audit_log");
    expect(audit?.row).toMatchObject({
      result: "denied",
      action: "members.listed",
      organization_id: ORG_A,
    });
  });
});

describe("invitations", () => {
  it("creates an invitation, stores only a hash, and emails the raw token", async () => {
    const res = await app.request(
      "/organizations/current/invitations",
      json({ email: "New@Person.test", role_id: ROLE_RO }, "tok-admin"),
    );
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.email).toBe("new@person.test");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]!.to).toBe("new@person.test");
    expect(mailer.sent[0]!.acceptUrl).toMatch(
      /^http:\/\/localhost:5173\/invite\/[A-Za-z0-9_-]{43}$/,
    );
    expect(body.accept_url).toBe(mailer.sent[0]!.acceptUrl);
  });

  it("previews an invitation without a session", async () => {
    const res = await app.request(`/invitations/${"b".repeat(43)}`);
    expect(res.status).toBe(200);
    expect((await readJson(res)).organization_name).toBe("Acme");
  });

  it("rejects a malformed token as not found", async () => {
    const res = await app.request("/invitations/short");
    expect(res.status).toBe(404);
  });

  it("accepts with the raw token and maps database refusals to 422", async () => {
    const ok = await app.request(`/invitations/${"a".repeat(43)}/accept`, json({}, "tok-reader"));
    expect(ok.status).toBe(200);
    expect((await readJson(ok)).organization_id).toBe(ORG_A);

    const bad = await app.request(`/invitations/${"c".repeat(43)}/accept`, json({}, "tok-reader"));
    expect(bad.status).toBe(422);
    expect((await readJson(bad)).error).toBe("invitation_expired");
  });
});
