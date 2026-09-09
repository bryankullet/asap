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
      create_organization: (args) => {
        if (args["p_accepted_terms"] !== true)
          return { error: { code: "22023", message: "terms_not_accepted" } };
        // Mirrors 0029: the same request key returns the same id; a new key is a new row.
        const key = String(args["p_request_key"]);
        const existing = createdOrganizations.get(key);
        if (existing) return { data: existing };
        const id = `40000000-0000-4000-8000-00000000000${createdOrganizations.size + 1}`;
        createdOrganizations.set(key, id);
        return { data: id };
      },
      set_active_organization: (args) => {
        // Mirrors app.set_active_organization: a member's brokerage is written to the profile.
        const member = (db.tables["organization_memberships"] ?? []).some(
          (m) => m["organization_id"] === args["p_organization_id"] && m["status"] === "active",
        );
        if (!member) return { error: { code: "42501", message: "not_a_member" } };
        for (const u of db.tables["users"] ?? [])
          u["active_organization_id"] = args["p_organization_id"];
        return {};
      },
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
    executor: () => async () => {},
    bootToken: "test-boot",
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

  it("one membership and no active brokerage: sets it on the server (D-055)", async () => {
    db.tables["users"]![0]!["active_organization_id"] = null;
    const res = await app.request("/me", { headers: auth("tok-admin") });
    const body = await readJson(res);
    expect(body.active_organization.id).toBe(ORG_A);
    expect(db.tables["users"]![0]!["active_organization_id"]).toBe(ORG_A);
    expect(body.permissions).toEqual(["user:create", "user:view"]);
  });

  it("two memberships and no active brokerage: stays unset so the browser shows the chooser", async () => {
    db.tables["users"]![0]!["active_organization_id"] = null;
    db.tables["organization_memberships"]!.push({
      ...db.tables["organization_memberships"]![0]!,
      id: "60000000-0000-4000-8000-000000000009",
      organization_id: ORG_B,
      organization: {
        id: ORG_B,
        name: "Beta",
        country: "KE",
        currency: "KES",
        timezone: "Africa/Nairobi",
      },
    });
    const res = await app.request("/me", { headers: auth("tok-admin") });
    const body = await readJson(res);
    expect(body.active_organization).toBeNull();
    expect(body.memberships).toHaveLength(2);
    expect(db.tables["users"]![0]!["active_organization_id"]).toBeNull();
  });

  it("zero memberships: no active brokerage and nothing is written", async () => {
    db.tables["users"]![0]!["active_organization_id"] = null;
    db.tables["organization_memberships"] = db.tables["organization_memberships"]!.filter(
      (m) => m["user_id"] !== ADMIN.id,
    );
    const res = await app.request("/me", { headers: auth("tok-admin") });
    const body = await readJson(res);
    expect(body.active_organization).toBeNull();
    expect(body.memberships).toHaveLength(0);
    expect(db.tables["users"]![0]!["active_organization_id"]).toBeNull();
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

const createdOrganizations = new Map<string, string>();

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
          request_key: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        },
        "tok-admin",
      ),
    );
    expect(res.status).toBe(201);
    expect((await readJson(res)).organization_id).toMatch(/^40000000/);
  });
  it("requires a request key", async () => {
    const res = await app.request(
      "/organizations",
      json(
        {
          name: "Gamma Cover",
          country: "KE",
          currency: "KES",
          timezone: "Africa/Nairobi",
          accepted_terms: true,
        },
        "tok-admin",
      ),
    );
    expect(res.status).toBe(422);
    expect((await readJson(res)).details.map((d: { path: string }) => d.path)).toContain(
      "request_key",
    );
  });
  it("a double submit with the same request key is one brokerage", async () => {
    const body = {
      name: "Delta Cover",
      country: "KE",
      currency: "KES",
      timezone: "Africa/Nairobi",
      accepted_terms: true,
      request_key: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    };
    const before = createdOrganizations.size;
    const [first, second] = await Promise.all([
      app.request("/organizations", json(body, "tok-admin")),
      app.request("/organizations", json(body, "tok-admin")),
    ]);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await readJson(first)).organization_id).toBe((await readJson(second)).organization_id);
    expect(createdOrganizations.size).toBe(before + 1);
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

describe("ask (Phase 1: search only) — endpoint gates ported from the prototype's checks.mjs", () => {
  const ITEM_A = "30000000-0000-4000-8000-000000000001";
  const ITEM_B = "30000000-0000-4000-8000-000000000002";
  beforeEach(() => {
    db.tables["work_items"] = [
      {
        id: ITEM_A,
        organization_id: ORG_A,
        title: "Acme Motors — renewal terms from Jubilee",
        deleted_at: null,
        updated_at: "2026-09-08T00:00:00Z",
      },
      {
        id: ITEM_B,
        organization_id: ORG_A,
        title: "KDA 482A — motor certificate",
        deleted_at: null,
        updated_at: "2026-09-08T00:00:00Z",
      },
      {
        id: "30000000-0000-4000-8000-00000000000b",
        organization_id: ORG_B,
        title: "Otieno household — renewal",
        deleted_at: null,
        updated_at: "2026-09-08T00:00:00Z",
      },
    ];
  });

  it("is refused without a session (401), like the prototype's /api/ask/status gate", async () => {
    expect((await app.request("/ask?q=renewal")).status).toBe(401);
  });

  it("rejects an empty query", async () => {
    expect((await app.request("/ask?q=", { headers: auth("tok-admin") })).status).toBe(400);
  });

  it("returns an open_record intent for a single match and never markup", async () => {
    const res = await app.request("/ask?q=KDA", { headers: auth("tok-admin") });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.intent.type).toBe("open_record");
    expect(body.intent.target).toBe(ITEM_B);
    expect(body.results).toEqual([
      {
        id: ITEM_B,
        kind: "work_item",
        title: "KDA 482A — motor certificate",
        href: `/r/${ITEM_B}`,
      },
    ]);
    expect(JSON.stringify(body)).not.toMatch(/<[a-z]/i);
  });

  it("scopes to the active brokerage and returns a work_list for several matches", async () => {
    db.tables["work_items"]!.push({
      id: "30000000-0000-4000-8000-000000000009",
      organization_id: ORG_A,
      title: "Another renewal",
      deleted_at: null,
      updated_at: "2026-09-08T00:00:00Z",
    });
    const body = await readJson(
      await app.request("/ask?q=renewal", { headers: auth("tok-admin") }),
    );
    expect(body.intent.type).toBe("work_list");
    expect(body.results.map((r: { id: string }) => r.id)).not.toContain(
      "30000000-0000-4000-8000-00000000000b",
    );
    expect(body.results).toHaveLength(2);
  });

  it("answers, without acting, when nothing matches", async () => {
    const body = await readJson(await app.request("/ask?q=zzz", { headers: auth("tok-admin") }));
    expect(body.intent.type).toBe("answer");
    expect(body.results).toEqual([]);
  });
});

describe("Ask never creates a client (D-050)", () => {
  const ACME = "70000000-0000-4000-8000-00000000000a";
  const rpcCalls: string[] = [];
  beforeEach(() => {
    rpcCalls.length = 0;
    db.tables["clients"] = [
      {
        id: ACME,
        organization_id: ORG_A,
        name: "Acme Motors",
        kind: "corporate",
        deleted_at: null,
      },
      {
        id: "70000000-0000-4000-8000-00000000000d",
        organization_id: ORG_A,
        name: "Acme Logistics Ltd",
        kind: "corporate",
        deleted_at: null,
      },
    ];
    db.tables["work_items"] = [];
    db.rpc["work_item_create"] = (args) => {
      rpcCalls.push("work_item_create");
      db.tables["work_items"]!.push({
        id: "30000000-0000-4000-8000-0000000000aa",
        organization_id: ORG_A,
        title: args["p_title"],
        kind: "renewal",
        client_id: args["p_client_id"],
        policy_period_id: null,
        insurer_id: null,
        class_of_business: null,
        owner_id: ADMIN.id,
        task_status: args["p_task_status"],
        task_party: null,
        task_since: null,
        task_next_check: null,
        cover_status: null,
        cover_inception_at: null,
        money_status: null,
        reason: null,
        steps: args["p_steps"],
        exception: null,
        version: 1,
        created_at: "2026-09-09T00:00:00Z",
        updated_at: "2026-09-09T00:00:00Z",
        completed_at: null,
        deleted_at: null,
      });
      return { data: { id: "30000000-0000-4000-8000-0000000000aa", reopened: false } };
    };
    db.rpc["client_create"] = () => {
      rpcCalls.push("client_create");
      return { data: { id: "should-never-happen", created: true } };
    };
  });

  it("three spellings of one seeded client open a renewal on that client and create zero rows", async () => {
    for (const clientName of ["acme motors", "ACME MOTORS LTD", "Acme  Motors."]) {
      const res = await app.request(
        "/work-items",
        json({ kind: "renewal", clientName }, "tok-admin"),
      );
      expect(res.status, clientName).toBe(201);
      const body = await readJson(res);
      expect(body.outcome).toBe("opened");
      expect(body.item.client_id).toBe(ACME);
      db.tables["work_items"] = [];
    }
    expect(rpcCalls.filter((c) => c === "client_create")).toEqual([]);
    expect(db.tables["clients"]).toHaveLength(2);
  });

  it("asks which when more than one client is plausible", async () => {
    const res = await app.request(
      "/work-items",
      json({ kind: "renewal", clientName: "Acme" }, "tok-admin"),
    );
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.outcome).toBe("ambiguous");
    expect(body.candidates.map((c: { name: string }) => c.name)).toEqual([
      "Acme Motors",
      "Acme Logistics Ltd",
    ]);
    expect(rpcCalls).toEqual([]);
  });

  it("offers creation as the only action when no client matches, and creates nothing", async () => {
    const res = await app.request(
      "/work-items",
      json({ kind: "renewal", clientName: "Otieno Household" }, "tok-admin"),
    );
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.outcome).toBe("no_client");
    expect(body.intent.suggestions).toEqual(["Create Otieno Household as a new client"]);
    expect(rpcCalls).toEqual([]);
  });

  it("the create path reviews duplicates before creating", async () => {
    const dup = await app.request(
      "/clients",
      json({ name: "acme motors ltd", kind: "corporate" }, "tok-admin"),
    );
    expect(dup.status).toBe(409);
    expect((await readJson(dup)).outcome).toBe("possible_duplicates");
    expect(rpcCalls).toEqual([]);
  });
});
