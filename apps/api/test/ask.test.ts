/**
 * `POST /ask` — Ask ASAP end to end, against the deterministic provider.
 *
 * What these tests are for: the *harness*, not the model. Every rule that makes an answer safe
 * lives in our code — the tool loop, the grounding check, the authority check, the abstention
 * state, the configuration state, tenant isolation — so every one of them is provable without a
 * network call or a credential. A scripted provider that returns a fabricated record id must be
 * refused here exactly as a real one would be.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { fakeProvider, type FakeScript } from "../src/ai/providers/fake.js";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG_A = "10000000-0000-4000-8000-00000000000a";
const ORG_B = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const CLIENT = "70000000-0000-4000-8000-00000000000a";
const ITEM = "20000000-0000-4000-8000-00000000000a";
const BETA_ITEM = "20000000-0000-4000-8000-00000000000b";

const silentMailer: Mailer = { send: async () => ({ ok: true as const }) } as unknown as Mailer;

const step = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  label: "Terms from Jubilee",
  actor: "insurer",
  state: "now",
  guards: [],
  evidence: [{ kind: "document", label: "Quote slip" }],
  actions: [],
  party: "Jubilee",
  reason: null,
  recorded: [
    { kind: "document", reference: "QS-1182", recordedBy: AMINA.id, recordedAt: "2026-09-01T09:00:00Z" },
  ],
  runId: null,
  ...over,
});

const workItem = (over: Record<string, unknown>) => ({
  organization_id: ORG_A,
  kind: "renewal",
  client_id: CLIENT,
  policy_period_id: null,
  insurer_id: null,
  class_of_business: null,
  owner_id: null,
  task_status: "with_party",
  task_party: "Jubilee",
  task_since: "2026-09-01T09:00:00Z",
  task_next_check: "2026-09-10T09:00:00Z",
  cover_status: null,
  cover_inception_at: null,
  money_status: null,
  reason: "Terms were requested from Jubilee.",
  steps: [step()],
  exception: null,
  version: 1,
  created_at: "2026-09-01T09:00:00Z",
  updated_at: "2026-09-05T09:00:00Z",
  completed_at: null,
  deleted_at: null,
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
          active_organization_id: ORG_A,
        },
      ],
      organization_memberships: [
        {
          id: "60000000-0000-4000-8000-000000000001",
          organization_id: ORG_A,
          user_id: AMINA.id,
          is_owner: true,
          status: "active",
          joined_at: "2026-01-01T00:00:00Z",
          organization: {
            id: ORG_A,
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
      clients: [
        { id: CLIENT, organization_id: ORG_A, name: "Acme Motors", kind: "corporate", file_status: "complete", deleted_at: null },
      ],
      work_items: [
        workItem({ id: ITEM, title: "Acme Motors renewal" }),
        // A second brokerage's row sits in the same table throughout. It must never be reachable.
        workItem({ id: BETA_ITEM, title: "Beta Risk renewal", organization_id: ORG_B, client_id: null }),
      ],
      conversations: [],
      conversation_messages: [],
      runs: [],
      policies: [],
      policy_periods: [],
      insurers: [],
      component_definitions: [],
    },
  };
}

const auth = { Authorization: "Bearer tok-amina" };

// Test-only: bodies are asserted field by field, so a loose type is the honest one here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

function build(db: FakeDb, script: FakeScript | null) {
  return createApp({
    logger: pino({ level: process.env["ASK_DEBUG"] ? "warn" : "silent" }),
    build: { version: "t", commit: "t" },
    supabase: fakeFactory(db),
    mailer: silentMailer,
    webBaseUrl: "http://localhost:5173",
    invitationTtlHours: 168,
    exposeAcceptUrl: true,
    executor: () => async () => {},
    bootToken: "test-boot",
    aiProvider: script ? fakeProvider(script) : null,
  });
}

const ask = (app: ReturnType<typeof build>, body: unknown) =>
  app.request("/ask", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

/** The happy path: one tool round, then a grounded answer naming a record the tool returned. */
const GROUNDED: FakeScript = [
  {
    match: /jubilee/i,
    reply: {
      text: "",
      toolCalls: [{ id: "c1", name: "find_work", arguments: { query: "renewal" } }],
      stop: "tool_use",
    },
    then: {
      text: JSON.stringify({
        type: "open_record",
        target: ITEM,
        panel: "WaitingCard",
        view: "blocker",
        answer: "Terms were requested from Jubilee and the reply is still outstanding.",
        suggestions: ["Chase Jubilee"],
      }),
      toolCalls: [],
      stop: "end",
    },
  },
];

describe("POST /ask", () => {
  let db: FakeDb;
  beforeEach(() => {
    db = makeDb();
  });

  it("answers from a tool result and cites the record it read", async () => {
    const res = await ask(build(db, GROUNDED), { question: "What is Jubilee waiting on?" });
    expect(res.status).toBe(200);
    const body = await readJson(res);

    expect(body.state).toBe("answered");
    expect(body.message.intent.target).toBe(ITEM);
    expect(body.planRecordId).toBe(ITEM);
    expect(body.message.tools_used).toEqual([{ name: "find_work", arguments: { query: "renewal" } }]);
    // The citation comes from the row, not from the sentence the model wrote.
    expect(body.message.citations[0]).toMatchObject({ recordId: ITEM, reference: "QS-1182", page: null });
    expect(body.message.served_by).toBe("fake:fake-deterministic");
  });

  it("persists both turns of the conversation and continues it", async () => {
    const app = build(db, GROUNDED);
    const first = await readJson(await ask(app, { question: "What is Jubilee waiting on?" }));
    expect(first.conversationId).toBeTruthy();

    const second = await ask(app, {
      question: "What is Jubilee waiting on now?",
      conversationId: first.conversationId,
    });
    expect(second.status).toBe(200);

    const messages = db.tables["conversation_messages"] as Record<string, unknown>[];
    expect(messages.map((m) => m["role"])).toEqual(["person", "asap", "person", "asap"]);
    // Sequence continues rather than restarting, and starts at 1 as the 0032 constraint requires.
    expect(messages.map((m) => m["seq"])).toEqual([1, 2, 3, 4]);
  });

  it("abstains when the model names a record no tool returned", async () => {
    const fabricated: FakeScript = [
      {
        match: /./,
        reply: {
          text: JSON.stringify({
            type: "open_record",
            target: BETA_ITEM,
            panel: null,
            view: "summary",
            answer: "Beta Risk is renewing next month.",
            suggestions: [],
          }),
          toolCalls: [],
          stop: "end",
        },
      },
    ];
    const res = await ask(build(db, fabricated), { question: "Tell me about Beta Risk." });
    const body = await readJson(res);

    expect(body.state).toBe("abstained");
    expect(body.planRecordId).toBeNull();
    // The other brokerage's title never appears in the reply.
    expect(JSON.stringify(body)).not.toContain("Beta Risk");
  });

  it("abstains rather than repeating a status the model decided", async () => {
    const authoritative: FakeScript = [
      {
        match: /./,
        reply: {
          text: JSON.stringify({
            type: "answer",
            target: null,
            panel: null,
            view: "summary",
            answer: "That renewal is approved and cover is now confirmed.",
            suggestions: [],
          }),
          toolCalls: [],
          stop: "end",
        },
      },
    ];
    const res = await ask(build(db, authoritative), { question: "Is it done?" });
    const body = await readJson(res);
    expect(body.state).toBe("abstained");
    expect(body.message.abstained.reason).toMatch(/cannot decide a status/i);
  });

  it("abstains when the reply is not a usable intent", async () => {
    const garbage: FakeScript = [
      { match: /./, reply: { text: "<div>Here is your answer</div>", toolCalls: [], stop: "end" } },
    ];
    const body = await readJson(await ask(build(db, garbage), { question: "anything" }));
    expect(body.state).toBe("abstained");
    expect(body.message.body).not.toContain("<div>");
  });

  it("reports a missing model as a configuration state, not an empty answer", async () => {
    const res = await ask(build(db, null), { question: "What is Jubilee waiting on?" });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.state).toBe("not_configured");
    expect(body.message).toBeNull();
    // Nothing was persisted for a question that was never asked of a model.
    expect(db.tables["conversation_messages"]).toHaveLength(0);
  });

  it("refuses a scope the caller cannot read", async () => {
    const res = await ask(build(db, GROUNDED), {
      question: "What is happening here?",
      scope: { kind: "record", id: BETA_ITEM },
    });
    expect(res.status).toBe(404);
  });

  it("resolves the scope label from the record, not from the request", async () => {
    const res = await ask(build(db, GROUNDED), {
      question: "What is Jubilee waiting on?",
      scope: { kind: "client", id: CLIENT },
    });
    const body = await readJson(res);
    expect(body.scope).toEqual({ kind: "client", id: CLIENT, label: "Acme Motors" });
  });

  it("returns a tool's rows only for the caller's own brokerage", async () => {
    const findAll: FakeScript = [
      {
        match: /./,
        reply: { text: "", toolCalls: [{ id: "c1", name: "find_work", arguments: {} }], stop: "tool_use" },
        then: {
          text: JSON.stringify({
            type: "work_list",
            target: null,
            panel: null,
            view: "summary",
            answer: "There is one renewal open.",
            suggestions: [],
          }),
          toolCalls: [],
          stop: "end",
        },
      },
    ];
    const body = await readJson(await ask(build(db, findAll), { question: "list everything" }));
    expect(body.state).toBe("answered");
    expect(JSON.stringify(body)).not.toContain(BETA_ITEM);
  });
});
