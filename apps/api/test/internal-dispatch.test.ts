/**
 * The surface the worker tier calls (D-072).
 *
 * Two things it exists to hold:
 *   - **a browser cannot reach it.** It carries no session; it demands a shared secret that only
 *     the API and the worker hold, and it is mounted where no session guard would help.
 *   - **the caller does not choose the brokerage.** It names an event; the event says whose it is.
 *     A caller that could pass an organization id would be a way around every tenancy rule there
 *     is (§45 rules 1 and 5).
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "10000000-0000-4000-8000-00000000000b";
const EVENT = "e0000000-0000-4000-8000-000000000001";
const ITEM = "50000000-0000-4000-8000-000000000001";
const KEY = "worker-secret-0123456789abcdef";

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
          event_type: "document.received",
          entity_type: "document",
          entity_id: "d0000000-0000-4000-8000-000000000001",
          payload: { workItemId: ITEM },
        },
        {
          id: "e0000000-0000-4000-8000-000000000002",
          organization_id: OTHER_ORG,
          event_type: "document.received",
          entity_type: "document",
          entity_id: "d0000000-0000-4000-8000-000000000002",
          payload: {},
        },
      ],
      automations: [],
      work_items: [],
      audit_log: [],
    },
  };
}

let db: FakeDb;
const silentMailer: Mailer = { sendInvitation: async () => {} };
/*
 * `null` means "this deployment has no internal key", not `undefined`: passing `undefined` to a
 * parameter with a default gets the default, which is how the first version of this test managed
 * to assert the route was absent while building it with a key.
 */
const build = (internalKey: string | null = KEY) =>
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
    ...(internalKey === null ? {} : { apiInternalKey: internalKey }),
  });

beforeEach(() => {
  db = makeDb();
});

const internal = { "x-asap-internal-key": KEY };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

describe("who may call it", () => {
  it("refuses a request with no key", async () => {
    const res = await build().request(`/internal/events/${EVENT}/dispatch`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("refuses a wrong key", async () => {
    const res = await build().request(`/internal/events/${EVENT}/dispatch`, {
      method: "POST",
      headers: { "x-asap-internal-key": "worker-secret-0123456789abcdeX" },
    });
    expect(res.status).toBe(401);
  });

  it("refuses a session: this is not a surface a browser has", async () => {
    const res = await build().request(`/internal/events/${EVENT}/dispatch`, {
      method: "POST",
      headers: { Authorization: "Bearer tok-amina" },
    });
    expect(res.status).toBe(401);
  });

  it("does not exist at all when the deployment has no internal key", async () => {
    const res = await build(null).request(`/internal/events/${EVENT}/dispatch`, {
      method: "POST",
      headers: internal,
    });
    // Not mounted rather than mounted with an empty secret, which would accept an empty header.
    expect(res.status).toBe(404);
  });
});

describe("what it does with an event", () => {
  it("runs the consumers and says what each one did", async () => {
    const res = await build().request(`/internal/events/${EVENT}/dispatch`, {
      method: "POST",
      headers: internal,
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.eventType).toBe("document.received");
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ consumer: "automations", result: "success" });
  });

  it("skips rather than fails when the event belongs to no piece of work", async () => {
    // A document filed against no work item has nothing for an automation to run against. That is
    // a complete answer, not an error, and the history should not read as though something broke.
    const res = await build().request(
      "/internal/events/e0000000-0000-4000-8000-000000000002/dispatch",
      { method: "POST", headers: internal },
    );
    const body = await readJson(res);
    expect(body.results[0]).toMatchObject({ consumer: "automations", result: "skipped" });
    expect(body.results[0].detail).toMatch(/does not belong to a piece of work/i);
  });

  it("is a 404 for an event that does not exist", async () => {
    const res = await build().request(
      "/internal/events/e0000000-0000-4000-8000-0000000000ff/dispatch",
      { method: "POST", headers: internal },
    );
    expect(res.status).toBe(404);
  });

  it("never takes an organization from the caller", async () => {
    // The body is ignored entirely: whose event it is comes from the event row. A caller that
    // could name a brokerage would be a way round every tenancy rule there is.
    const res = await build().request(`/internal/events/${EVENT}/dispatch`, {
      method: "POST",
      headers: { ...internal, "Content-Type": "application/json" },
      body: JSON.stringify({ organizationId: OTHER_ORG }),
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.eventId).toBe(EVENT);
  });
});
