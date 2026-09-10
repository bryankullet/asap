/**
 * `GET /spaces/:recordId` end to end through the real app: the recipe composes a plan, the
 * validator checks it against the seeded registry, and only then does it become a response.
 *
 * The record is Amina's renewal from `docs/click-through.md`.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { propsJsonSchema, RENEWAL_SPACE_BLOCK_PROPS } from "@asap/schema";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const RENEWAL = "30000000-0000-4000-8000-000000000001";
const CLAIM = "30000000-0000-4000-8000-000000000003";
const CLIENT = "70000000-0000-4000-8000-00000000000b";
const PERIOD = "60000000-0000-4000-8000-0000000000a1";
const POLICY = "50000000-0000-4000-8000-0000000000a1";
const INSURER = "80000000-0000-4000-8000-0000000000a1";
const iso = "2026-09-05T09:00:00.000Z";

const step = (over: Record<string, unknown>) => ({
  actor: "you",
  state: "todo",
  guards: [],
  evidence: [],
  actions: [],
  party: null,
  reason: null,
  recorded: [],
  runId: null,
  ...over,
});

function makeDb(): FakeDb {
  return {
    users: { "tok-amina": AMINA },
    inserts: [],
    rpc: {},
    tables: {
      users: [
        {
          id: AMINA.id,
          email: AMINA.email,
          full_name: "Amina",
          display_name: null,
          active_organization_id: ORG,
        },
      ],
      organization_memberships: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          user_id: AMINA.id,
          is_owner: true,
          status: "active",
          joined_at: "2026-01-01T00:00:00Z",
          organization: {
            id: ORG,
            name: "Acme Insurance Brokers",
            country: "KE",
            currency: "KES",
            timezone: "Africa/Nairobi",
          },
          role: {
            id: "30000000-0000-4000-8000-000000000001",
            key: "brokerage_admin",
            name: "Brokerage administrator",
            description: null,
            is_system: true,
          },
        },
      ],
      role_permissions: [],
      clients: [{ id: CLIENT, name: "Acme Motors", kind: "corporate", file_status: "cleared" }],
      policies: [
        {
          id: POLICY,
          organization_id: ORG,
          client_id: CLIENT,
          insurer_id: INSURER,
          class_of_business: "Motor commercial",
          policy_number: "MC-4471",
          created_at: iso,
          updated_at: iso,
          deleted_at: null,
        },
      ],
      policy_periods: [
        {
          id: PERIOD,
          organization_id: ORG,
          policy_id: POLICY,
          period_start: "2025-10-14",
          period_end: "2026-10-14",
          created_at: iso,
          updated_at: iso,
        },
      ],
      insurers: [{ id: INSURER, organization_id: ORG, name: "Jubilee" }],
      work_items: [
        {
          id: RENEWAL,
          organization_id: ORG,
          title: "Acme Motors — renewal terms from Jubilee",
          kind: "renewal",
          client_id: CLIENT,
          policy_period_id: PERIOD,
          insurer_id: INSURER,
          class_of_business: "Motor commercial",
          owner_id: null,
          task_status: "with_party",
          task_party: "Jubilee",
          task_since: iso,
          task_next_check: "2026-09-09T09:00:00.000Z",
          cover_status: "active",
          cover_inception_at: null,
          money_status: "unpaid",
          reason: "Terms were requested from Jubilee five days ago and the check was due yesterday.",
          steps: [
            step({ id: "file_check", label: "Client file checked", actor: "asap", state: "done" }),
            step({
              id: "review",
              label: "Expiring policy reviewed",
              actor: "asap",
              state: "done",
              recorded: [
                {
                  kind: "document",
                  reference: "Renewal pack 2026",
                  recordedBy: "ASAP",
                  recordedAt: iso,
                },
              ],
            }),
            step({
              id: "request_terms",
              label: "Terms requested",
              state: "done",
              actions: [
                { verb: "draft", label: "Draft the request", guards: [], disabledReason: null },
                {
                  verb: "record_send",
                  label: "I sent this",
                  guards: ["evidence_present"],
                  disabledReason: null,
                },
              ],
            }),
            step({
              id: "terms_return",
              label: "Terms received",
              actor: "insurer",
              state: "now",
              party: "Jubilee, APA",
              recorded: [
                {
                  kind: "document",
                  reference: "APA terms, email 2 September",
                  recordedBy: "Amina",
                  recordedAt: iso,
                },
              ],
              actions: [
                {
                  verb: "record_evidence",
                  label: "Record terms received",
                  guards: ["evidence_present"],
                  disabledReason: null,
                },
              ],
            }),
            step({ id: "compare", label: "Terms compared", actor: "asap" }),
          ],
          exception: null,
          version: 4,
          created_at: iso,
          updated_at: iso,
          completed_at: null,
          deleted_at: null,
        },
        {
          id: CLAIM,
          organization_id: ORG,
          title: "Jane Wanjiku — claim, incident 2 September",
          kind: "claim",
          client_id: CLIENT,
          policy_period_id: null,
          insurer_id: null,
          class_of_business: null,
          owner_id: null,
          task_status: "needs_you",
          task_party: null,
          task_since: null,
          task_next_check: null,
          cover_status: null,
          cover_inception_at: null,
          money_status: null,
          reason: "Still a draft.",
          steps: [],
          exception: null,
          version: 1,
          created_at: iso,
          updated_at: iso,
          completed_at: null,
          deleted_at: null,
        },
      ],
      runs: [
        {
          id: "40000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          work_item_id: RENEWAL,
          title: "Renewal pack prepared",
          status: "finished",
          next_step: null,
          started_by: null,
          boot_token: null,
          started_at: iso,
          ended_at: iso,
          created_at: iso,
          updated_at: iso,
        },
      ],
      drafts: [
        {
          id: "90000000-0000-4000-8000-000000000001",
          organization_id: ORG,
          work_item_id: RENEWAL,
          step_id: "terms_return",
          to_address: "renewals@jubilee.example",
          subject: "Acme motor renewal — outstanding terms",
          body: "Please share the outstanding terms for Acme's motor renewal.",
          copied_at: null,
          sent_at: null,
          sent_evidence: null,
          outcome_unknown: false,
          created_by: null,
          created_at: iso,
          updated_at: iso,
        },
      ],
      // The registry, as migration 0031 seeds it.
      component_definitions: (
        Object.keys(RENEWAL_SPACE_BLOCK_PROPS) as (keyof typeof RENEWAL_SPACE_BLOCK_PROPS)[]
      ).map((id) => ({
        component_id: id,
        version: 1,
        allowed_spaces: ["renewal"],
        required_permissions: [],
        can_contain_action: id === "RenewalReadiness" || id === "DraftEmail",
        requires_evidence:
          id === "PolicyCard" ||
          id === "InsurerResponseTracker" ||
          id === "TermComparison" ||
          id === "SourceEvidence",
        props_schema: propsJsonSchema(id),
        deprecated_at: null,
      })),
    },
  };
}

let db: FakeDb;
let app: ReturnType<typeof createApp>;
const silentMailer: Mailer = { sendInvitation: async () => {} };

beforeEach(() => {
  db = makeDb();
  app = createApp({
    logger: pino({ level: "silent" }),
    build: { version: "t", commit: "t" },
    supabase: fakeFactory(db),
    mailer: silentMailer,
    webBaseUrl: "http://localhost:5173",
    invitationTtlHours: 168,
    exposeAcceptUrl: true,
    executor: () => async () => {},
    bootToken: "test-boot",
  });
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();
const get = async (path: string) =>
  readJson(await app.request(path, { headers: auth("tok-amina") }));

describe("GET /spaces/:recordId", () => {
  it("requires a session", async () => {
    expect((await app.request(`/spaces/${RENEWAL}`)).status).toBe(401);
  });

  it("returns a validated plan titled as the record, never as its recipe", async () => {
    const res = await app.request(`/spaces/${RENEWAL}`, { headers: auth("tok-amina") });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.plan.title).toBe("Acme Motors — renewal terms from Jubilee");
    expect(body.plan.title).not.toMatch(/Space|recipe/i);
    expect(body.plan.spaceType).toBe("renewal");
    expect(body.plan.source).toBe("recipe");
  });

  it("leads with the focus block and its action", async () => {
    const body = await get(`/spaces/${RENEWAL}`);
    expect(body.plan.blocks[0].component).toBe("RenewalReadiness");
    expect(body.plan.blocks[0].props.eyebrow).toBe("Next step");
    expect(body.plan.blocks[0].props.headline.length).toBeGreaterThan(0);
    expect(body.plan.blocks[0].actions[0]).toEqual({
      verb: "record_evidence",
      label: "Record terms received",
      stepId: "terms_return",
      disabledReason: null,
    });
  });

  it("shows only what the intent needs: the blocker view is narrower than the summary", async () => {
    const summary = await get(`/spaces/${RENEWAL}?view=summary`);
    const blocker = await get(`/spaces/${RENEWAL}?view=blocker`);
    const names = (b: { plan: { blocks: { component: string }[] } }) =>
      b.plan.blocks.map((x) => x.component);
    expect(names(summary)).toEqual([
      "RenewalReadiness",
      "ClientHeader",
      "PolicyCard",
      "InsurerResponseTracker",
      "DraftEmail",
      "ActivityFeed",
    ]);
    expect(names(blocker)).toEqual([
      "RenewalReadiness",
      "ClientHeader",
      "InsurerResponseTracker",
      "Checklist",
    ]);
    // Not every panel for every question (v1 Part 1).
    expect(names(blocker).length).toBeLessThan(names(summary).length);
  });

  it("changes the blocks when the question changes, without leaving the record", async () => {
    const comparison = await get(`/spaces/${RENEWAL}?view=comparison`);
    const policy = await get(`/spaces/${RENEWAL}?view=policy`);
    const timeline = await get(`/spaces/${RENEWAL}?view=timeline`);
    expect(comparison.plan.blocks.map((b: { component: string }) => b.component)).toContain(
      "TermComparison",
    );
    expect(policy.plan.blocks.map((b: { component: string }) => b.component)).toEqual([
      "ClientHeader",
      "PolicyCard",
      "SourceEvidence",
      "Checklist",
    ]);
    expect(timeline.plan.blocks.map((b: { component: string }) => b.component)).toContain(
      "ActivityFeed",
    );
    // Same record throughout: the client's context is never lost.
    for (const b of [comparison, policy, timeline]) expect(b.plan.recordId).toBe(RENEWAL);
  });

  it("carries the insurers actually on file, and cites what each one came from", async () => {
    const body = await get(`/spaces/${RENEWAL}?view=blocker`);
    const tracker = body.plan.blocks.find(
      (b: { component: string }) => b.component === "InsurerResponseTracker",
    );
    expect(tracker.props.insurers).toEqual([
      { name: "Jubilee", state: "not_on_file", reference: null, recordedAt: null },
      {
        name: "APA",
        state: "on_file",
        reference: "APA terms, email 2 September",
        recordedAt: iso,
      },
    ]);
    // Evidence sits beside the fact, because the registry requires it on this component.
    expect(tracker.evidence[0].reference).toBe("APA terms, email 2 September");
  });

  it("shows the prepared draft as a draft, with no sent event on it", async () => {
    const body = await get(`/spaces/${RENEWAL}`);
    const draft = body.plan.blocks.find((b: { component: string }) => b.component === "DraftEmail");
    expect(draft.props.subject).toBe("Acme motor renewal — outstanding terms");
    expect(draft.props.sentAt).toBeNull();
    expect(draft.props.sentEvidence).toBeNull();
  });

  it("carries no cover or money status as a plan fact, except the policy card's own column", async () => {
    const body = await get(`/spaces/${RENEWAL}`);
    const flat = JSON.stringify(body.plan.blocks.map((b: { props: unknown }) => b.props));
    expect(flat).not.toMatch(/moneyStatus/);
    expect(flat).not.toMatch(/progress|confidence|percent/i);
    const card = body.plan.blocks.find((b: { component: string }) => b.component === "PolicyCard");
    expect(card.props.coverStatus).toBe("active");
  });

  it("reports the registry versions it validated against", async () => {
    const body = await get(`/spaces/${RENEWAL}`);
    for (const entry of body.registry) expect(entry.version).toBe(1);
    expect(body.registry.length).toBeGreaterThan(0);
  });

  it("composes no Space for a kind that has not been migrated yet", async () => {
    // The claim keeps the existing record page: capabilities move one at a time (D-058).
    expect((await app.request(`/spaces/${CLAIM}`, { headers: auth("tok-amina") })).status).toBe(404);
  });

  it("answers 404 for a record in another brokerage", async () => {
    db.tables["work_items"]!.push({
      ...(db.tables["work_items"]![0] as Record<string, unknown>),
      id: "30000000-0000-4000-8000-0000000000b9",
      organization_id: "10000000-0000-4000-8000-00000000000b",
    });
    const res = await app.request(`/spaces/30000000-0000-4000-8000-0000000000b9`, {
      headers: auth("tok-amina"),
    });
    expect(res.status).toBe(404);
  });
});
