/**
 * Automations: the demo's own standing instructions, as fixtures.
 *
 * Each case is something a brokerage would actually switch on, and the assertions are the
 * guarantees that make switching it on reasonable: it fires once per happening, it says why when
 * it did nothing, it stops for a person, and it cannot reach past the record's own guards.
 */
import { AUTOMATION_COLUMNS } from "@asap/schema";
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { fireAutomationsFor, type SemanticEvent } from "../src/automations/runner.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "10000000-0000-4000-8000-00000000000b";
const AMINA = "a0000000-0000-4000-8000-000000000001";
const ITEM = "20000000-0000-4000-8000-00000000000a";
const logger = pino({ level: "silent" });
const NOW = Date.parse("2026-09-11T09:00:00Z");

void AUTOMATION_COLUMNS;

const step = (over: Record<string, unknown> = {}) => ({
  id: "terms_return",
  label: "Terms from Jubilee",
  actor: "insurer",
  state: "now",
  guards: [],
  evidence: [],
  actions: [{ verb: "record_evidence", label: "Record the terms", guards: [], disabledReason: null }],
  party: "Jubilee",
  reason: null,
  recorded: [],
  runId: null,
  ...over,
});

const item = (over: Record<string, unknown> = {}) => ({
  id: ITEM,
  organization_id: ORG,
  title: "Acme Motors renewal",
  kind: "renewal",
  client_id: null,
  policy_period_id: null,
  insurer_id: null,
  class_of_business: "Motor commercial",
  owner_id: null,
  task_status: "with_party",
  task_party: "Jubilee",
  task_since: "2026-09-01T09:00:00Z",
  task_next_check: "2026-09-10T09:00:00Z",
  cover_status: null,
  cover_inception_at: null,
  money_status: "unpaid",
  reason: null,
  steps: [step()],
  exception: null,
  version: 1,
  created_at: "2026-08-01T09:00:00Z",
  updated_at: "2026-09-05T09:00:00Z",
  completed_at: null,
  deleted_at: null,
  ...over,
});

/** The demo's instruction: when an insurer quotes, record the terms against the renewal. */
const recordTerms = (over: Record<string, unknown> = {}) => ({
  id: "c1000000-0000-4000-8000-000000000001",
  organization_id: ORG,
  name: "Record terms when an insurer quotes",
  description: "When terms come back on a motor renewal, prepare to record them against the period.",
  trigger_event: "quote.received",
  conditions: [{ fact: "kind", operator: "equals", value: "renewal" }],
  skill: "renewal.extract_terms",
  prepared_verb: "record_evidence",
  approval: "always",
  sends_externally: false,
  enabled: true,
  created_by: AMINA,
  created_at: "2026-09-01T09:00:00Z",
  updated_at: "2026-09-01T09:00:00Z",
  deleted_at: null,
  ...over,
});

function makeDb(automations: Record<string, unknown>[], items = [item()]): FakeDb {
  return {
    users: {},
    inserts: [],
    rpc: {},
    defaults: { automation_runs: { outcome: "working", condition_results: [], prepared_action: null, reason: null } },
    // The idempotency the whole design rests on (0036).
    uniques: { automation_runs: [["automation_id", "event_id"]] },
    tables: { automations, work_items: items, automation_runs: [] },
  };
}

const event: SemanticEvent = {
  id: "e1000000-0000-4000-8000-000000000001",
  name: "quote.received",
  organizationId: ORG,
  workItemId: ITEM,
};

const runs = (db: FakeDb) => db.tables["automation_runs"] as Record<string, unknown>[];

describe("automations", () => {
  let db: FakeDb;

  const fire = (d: FakeDb, e: SemanticEvent = event) =>
    fireAutomationsFor(fakeFactory(d).forUser("t"), logger, e, NOW);

  it("prepares an action and stops for a person", async () => {
    db = makeDb([recordTerms()]);
    const summary = await fire(db);
    expect(summary[0]).toMatchObject({ outcome: "needs_approval" });
    const run = runs(db)[0]!;
    expect(run["prepared_action"]).toEqual({ verb: "record_evidence", stepId: "terms_return" });
    // It prepared; it did not act. Nothing on the record moved.
    expect((db.tables["work_items"] as Record<string, unknown>[])[0]!["version"]).toBe(1);
  });

  it("fires once for one happening, however many times the event arrives", async () => {
    db = makeDb([recordTerms()]);
    await fire(db);
    const second = await fire(db);
    expect(second[0]).toMatchObject({ duplicate: true });
    expect(runs(db)).toHaveLength(1);
  });

  it("says why it did nothing, rather than doing nothing silently", async () => {
    db = makeDb([recordTerms({ conditions: [{ fact: "kind", operator: "equals", value: "claim" }] })]);
    const summary = await fire(db);
    expect(summary[0]).toMatchObject({ outcome: "conditions_not_met" });
    const run = runs(db)[0]!;
    expect(run["condition_results"]).toEqual([
      { fact: "kind", operator: "equals", expected: "claim", actual: "renewal", held: false },
    ]);
  });

  it("raises an exception rather than reaching past the record's own guards", async () => {
    db = makeDb([recordTerms({ prepared_verb: "complete" })]);
    const summary = await fire(db);
    expect(summary[0]).toMatchObject({ outcome: "exception" });
    expect(runs(db)[0]!["reason"]).toMatch(/does not allow complete/);
  });

  it("stops for a person on anything reaching outside, whatever it is configured to do", async () => {
    // Configured to need no approval, and drafting to an insurer. The verb decides, not the config.
    db = makeDb([
      recordTerms({
        prepared_verb: "draft",
        approval: "never",
        conditions: [],
      }),
    ]);
    const withDraftStep = makeDb(
      [recordTerms({ prepared_verb: "draft", approval: "never", conditions: [] })],
      [item({ steps: [step({ actions: [{ verb: "draft", label: "Draft the chase", guards: [], disabledReason: null }] })] })],
    );
    const summary = await fire(withDraftStep);
    expect(summary[0]).toMatchObject({ outcome: "needs_approval" });
  });

  it("does not fire another brokerage's automation", async () => {
    db = makeDb([recordTerms({ id: "c1000000-0000-4000-8000-000000000009", organization_id: OTHER_ORG })]);
    expect(await fire(db)).toEqual([]);
    expect(runs(db)).toHaveLength(0);
  });

  it("does not take an action the record has disabled, and says why", async () => {
    db = makeDb(
      [recordTerms()],
      [
        item({
          steps: [
            step({
              actions: [
                {
                  verb: "record_evidence",
                  label: "Record the terms",
                  guards: [],
                  disabledReason: "Acme Motors' client file is not cleared.",
                },
              ],
            }),
          ],
        }),
      ],
    );
    const summary = await fire(db);
    expect(summary[0]).toMatchObject({ outcome: "exception" });
    // The record's own reason, passed through rather than restated.
    expect(runs(db)[0]!["reason"]).toMatch(/client file is not cleared/);
  });

  it("does not fire one that is switched off", async () => {
    db = makeDb([recordTerms({ enabled: false })]);
    expect(await fire(db)).toEqual([]);
  });

  it("records that there was nothing to prepare, rather than failing quietly", async () => {
    db = makeDb([recordTerms()], [item({ steps: [step({ state: "done" })] })]);
    const summary = await fire(db);
    expect(summary[0]).toMatchObject({ outcome: "could_not_finish" });
    expect(runs(db)[0]!["reason"]).toMatch(/no step waiting/);
  });
});

/**
 * The API surface, and the one thing it must never let through: an automation configured to do
 * something outward-facing without a person.
 */
describe("the automations API", () => {
  const routeDb = (): FakeDb => ({
    users: { "tok-amina": { id: AMINA, email: "admin@acme-brokers.test" } },
    inserts: [],
    rpc: {},
    defaults: { automations: { deleted_at: null, description: "", conditions: [] } },
    tables: {
      users: [{ id: AMINA, email: "admin@acme-brokers.test", full_name: "Amina", display_name: null, active_organization_id: ORG }],
      organization_memberships: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          user_id: AMINA,
          is_owner: true,
          status: "active",
          joined_at: "2026-01-01T00:00:00Z",
          organization: { id: ORG, name: "Acme Insurance Brokers", country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
          role: { id: "30000000-0000-4000-8000-000000000001", key: "brokerage_admin", name: "Admin", description: null, is_system: true },
        },
      ],
      role_permissions: [
        { role_id: "30000000-0000-4000-8000-000000000001", permission: { object_type: "automation", verb: "create" } },
      ],
      automations: [],
      automation_runs: [],
      audit_log: [],
    },
  });

  it("forces approval on anything outward-facing, whatever the request asked for", async () => {
    const db = routeDb();
    const app = createApp({
      logger,
      build: { version: "t", commit: "t" },
      supabase: fakeFactory(db),
      mailer: { send: async () => ({ ok: true as const }) } as unknown as Mailer,
      webBaseUrl: "http://localhost:5173",
      invitationTtlHours: 168,
      exposeAcceptUrl: true,
      executor: () => async () => {},
      bootToken: "test-boot",
    });
    const res = await app.request("/automations", {
      method: "POST",
      headers: { Authorization: "Bearer tok-amina", "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Chase insurers automatically",
        triggerEvent: "check.overdue",
        skill: "quote.track_responses",
        preparedVerb: "draft",
        // Asking for no approval on something that drafts to an insurer.
        approval: "never",
        enabled: true,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { automation: { approval: string; sends_externally: boolean } };
    // The verb decided, not the request.
    expect(body.automation.approval).toBe("always");
    expect(body.automation.sends_externally).toBe(true);
  });
});
