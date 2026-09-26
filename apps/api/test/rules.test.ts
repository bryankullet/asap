/**
 * A brokerage's own rules (4B-3A).
 *
 * The reason this route exists is a number I invented: 4B-3 named a recommended insurer whenever
 * two premiums were more than 5% apart, for every brokerage in Kenya. What these hold is that
 * such a judgement is now the brokerage's, recorded with where it came from, and that ASAP
 * abstains where nobody has set one.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const CLERK = { id: "a0000000-0000-4000-8000-000000000002", email: "clerk@acme-brokers.test" };
const ADMIN_ROLE = "30000000-0000-4000-8000-000000000001";
const READONLY_ROLE = "30000000-0000-4000-8000-000000000002";
const iso = "2026-09-05T09:00:00.000Z";

function membership(userId: string, roleId: string) {
  return {
    id: `60000000-0000-4000-8000-00000000000${userId.slice(-1)}`,
    organization_id: ORG,
    user_id: userId,
    is_owner: roleId === ADMIN_ROLE,
    status: "active",
    joined_at: iso,
    organization: { id: ORG, name: "Acme Brokers", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
    role: { id: roleId, key: "r", name: "R", description: null, is_system: true },
  };
}

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA, "tok-clerk": CLERK },
    inserts: [],
    rpc: {},
    tables: {
      users: [
        { id: AMINA.id, email: AMINA.email, full_name: "Amina", display_name: "Amina", active_organization_id: ORG },
        { id: CLERK.id, email: CLERK.email, full_name: "Bahati", display_name: "Bahati", active_organization_id: ORG },
      ],
      organization_memberships: [membership(AMINA.id, ADMIN_ROLE), membership(CLERK.id, READONLY_ROLE)],
      role_permissions: [{ role_id: ADMIN_ROLE, permission: { object_type: "organization", verb: "edit" } }],
      company_rules: [],
      audit_log: [],
    },
    defaults: { company_rules: { note: null, created_at: iso, updated_at: iso } },
    uniques: { company_rules: [["organization_id", "key"]] },
  };
}

let db: FakeDb;
const silentMailer: Mailer = { sendInvitation: async () => {} };
const build = () =>
  createApp({
    logger: pino({ level: process.env["DBG"] ? "error" : "silent" }),
    build: { version: "t", commit: "t" },
    supabase: fakeFactory(db),
    mailer: silentMailer,
    webBaseUrl: "http://localhost:5173",
    invitationTtlHours: 168,
    exposeAcceptUrl: true,
    executor: () => async () => {},
    bootToken: "t",
  });

beforeEach(() => {
  db = makeDb();
});

const asUser = (token = "tok-amina") => ({ authorization: `Bearer ${token}` });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

const read = async (token = "tok-amina") =>
  await readJson(await build().request("/rules", { headers: asUser(token) }));

const set = async (body: unknown, token = "tok-amina") =>
  await build().request("/rules", {
    method: "PUT",
    headers: { ...asUser(token), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const RECOMMENDATION = {
  key: "quote.recommendation",
  value: { mode: "cheapest_when_like_for_like", minimumGapPercent: 8 },
  source: "Partners meeting, 4 September 2026.",
  verifiedAt: "2026-09-04",
};

describe("what applies where nothing is set", () => {
  it("says what the defaults are rather than leaving them implied", async () => {
    const body = await read();
    expect(body.rules).toHaveLength(0);
    const recommendation = body.defaults.find((d: { key: string }) => d.key === "quote.recommendation");
    expect(recommendation.summary).toMatch(/does not name a recommended one/);
    expect(recommendation.basis).toMatch(/no ASAP default for this/);
  });

  it("states the validity default and its basis", async () => {
    const validity = (await read()).defaults.find((d: { key: string }) => d.key === "quote.validity");
    expect(validity.summary).toMatch(/within 14 days/);
    expect(validity.basis).toMatch(/no rule has been set/);
  });
});

describe("setting one", () => {
  it("records the rule with its source and the date it was checked", async () => {
    expect((await readJson(await set(RECOMMENDATION))).outcome).toBe("done");
    const body = await read();
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0].source).toBe("Partners meeting, 4 September 2026.");
    expect(body.rules[0].verifiedAt).toBe("2026-09-04");
    expect(body.rules[0].setByName).toBe("Amina");
    /* And the default for that key stops being offered, because it no longer applies. */
    expect(body.defaults.map((d: { key: string }) => d.key)).toEqual(["quote.validity"]);
  });

  it("updates rather than duplicating", async () => {
    await set(RECOMMENDATION);
    await set({ ...RECOMMENDATION, value: { mode: "abstain" }, source: "Reversed, 20 September." });
    const body = await read();
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0].source).toBe("Reversed, 20 September.");
  });

  it("refuses a rule that says to name the cheaper quote but not when", async () => {
    const res = await set({ ...RECOMMENDATION, value: { mode: "cheapest_when_like_for_like" } });
    expect(res.status).toBe(422);
    expect((await readJson(res)).reason).toMatch(/how wide the premium gap must be/);
  });

  it("refuses a rule that does not parse, rather than ignoring it later", async () => {
    const res = await set({ ...RECOMMENDATION, value: { mode: "whatever feels right" } });
    expect(res.status).toBe(422);
    expect((await readJson(res)).reason).toMatch(/either \{"mode":"abstain"\}/);
  });

  it("refuses somebody who may not change the brokerage's rules", async () => {
    const res = await set(RECOMMENDATION, "tok-clerk");
    expect(res.status).toBe(403);
    expect((await readJson(res)).reason).toMatch(/may not change this brokerage's rules/);
    expect((await read("tok-clerk")).permissions.canEdit).toBe(false);
  });

  it("records who set it, and what it was before", async () => {
    await set(RECOMMENDATION);
    await set({ ...RECOMMENDATION, value: { mode: "abstain" } });
    const rows = db.tables["audit_log"]!.filter((r) => r["action"] === "organization.rule_set");
    expect(rows).toHaveLength(2);
    expect(rows[1]!["actor_user_id"]).toBe(AMINA.id);
    expect(JSON.stringify(rows[1]!["previous_state"])).toMatch(/cheapest_when_like_for_like/);
  });
});
