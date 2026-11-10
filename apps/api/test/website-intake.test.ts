/**
 * Website intake (D-173): the brokerage's website forwards an enquiry it already saved.
 *
 * What this must hold:
 *   - only the website's server can call it (a secret), and without configuration it is absent;
 *   - the brokerage is configuration — a body naming an organization is refused;
 *   - one reference is one Work item, however many times it is delivered;
 *   - a returning client's enquiry lands on their file, matched by email then phone;
 *   - what the person reads says who, what and where from, and the arrival is audited.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { enquirySourceId, normalizePhone } from "../src/routes/website-intake.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG = "10000000-0000-4000-8000-00000000000a";
const OTHER_ORG = "10000000-0000-4000-8000-00000000000b";
const KEY = "website-intake-secret-0123456789abcdef";
const EXISTING = "c0000000-0000-4000-8000-000000000001";

let db: FakeDb;
const silentMailer: Mailer = { sendInvitation: async () => {} };
const build = (configured = true) =>
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
    ...(configured ? { websiteIntake: { key: KEY, organizationId: ORG } } : {}),
  });

beforeEach(() => {
  db = {
    users: {},
    inserts: [],
    rpc: {},
    uniques: { clients: [["organization_id", "name"]] },
    defaults: { client_contacts: { deleted_at: null } },
    tables: {
      work_items: [],
      clients: [{ id: EXISTING, organization_id: ORG, name: "Wanjiku Kamau", kind: "individual", source: "manual" }],
      client_contacts: [
        { id: "cc1", organization_id: ORG, client_id: EXISTING, full_name: "Wanjiku Kamau", email: "Wanjiku@Example.co.ke", phone: "0712 345 678", deleted_at: null },
        // Another brokerage's contact with the same address must never match.
        { id: "cc2", organization_id: OTHER_ORG, client_id: "c0000000-0000-4000-8000-000000000009", full_name: "X", email: "jane@example.com", phone: "+254700000001", deleted_at: null },
      ],
      audit_log: [],
    },
  };
});

const enquiry = (over: Record<string, unknown> = {}) => ({
  reference: "ASAP-MTR-20261110-AB12CD",
  kind: "quote",
  classOfBusiness: "motor",
  contact: { name: "Jane Achieng", email: "Jane@Example.com", phone: "0700 000 001" },
  details: { vehicle: "Toyota Axio (2016)", estimated_value: 1_200_000, cover: "comprehensive", usage: "private" },
  notes: "Need cover from next week",
  consentAt: "2026-11-10T09:00:00.000Z",
  source: { page: "/get-quote/motor", utmSource: "tiktok", utmCampaign: "motor-reel-01" },
  ...over,
});

const post = (body: unknown, key: string | null = KEY, configured = true) =>
  build(configured).request("/intake/website", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { "x-asap-intake-key": key } : {}) },
    body: JSON.stringify(body),
  });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: Response): Promise<any> => r.json();

describe("who may call it", () => {
  it("refuses a request without the key", async () => {
    expect((await post(enquiry(), null)).status).toBe(401);
    expect(db.tables["work_items"]).toHaveLength(0);
  });
  it("refuses a wrong key", async () => {
    expect((await post(enquiry(), `${KEY}x`)).status).toBe(401);
  });
  it("does not exist when the deployment is not configured", async () => {
    expect((await post(enquiry(), KEY, false)).status).toBe(404);
  });
  it("refuses a body that names a brokerage: that is configuration, not input", async () => {
    const res = await post({ ...enquiry(), organizationId: OTHER_ORG });
    expect(res.status).toBe(422);
    expect(db.tables["work_items"]).toHaveLength(0);
  });
  it("refuses an enquiry without consent", async () => {
    const { consentAt: _drop, ...rest } = enquiry();
    expect((await post(rest)).status).toBe(422);
  });
});

describe("a new visitor's quote request", () => {
  it("files the client and opens one Work item for a person", async () => {
    const res = await post(enquiry());
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body).toMatchObject({ existingClient: false, duplicate: false });

    const client = db.tables["clients"]!.find((c) => c["id"] === body.clientId)!;
    expect(client).toMatchObject({ organization_id: ORG, name: "Jane Achieng", kind: "individual" });
    const contact = db.tables["client_contacts"]!.find((c) => c["client_id"] === body.clientId)!;
    expect(contact).toMatchObject({ email: "jane@example.com", phone: "+254700000001", is_primary: true });

    const item = db.tables["work_items"]![0]!;
    expect(item).toMatchObject({
      organization_id: ORG,
      kind: "inbound",
      task_status: "needs_you",
      client_id: body.clientId,
      class_of_business: "motor",
      source_type: "website_enquiry",
      source_id: enquirySourceId(ORG, "ASAP-MTR-20261110-AB12CD"),
      reason_code: "website_quote",
      title: "Website quote request — Jane Achieng, motor",
      required_action: "Start the motor quotation for Jane Achieng",
    });
    const reason = item["reason"] as string;
    expect(reason).toContain("ASAP-MTR-20261110-AB12CD");
    expect(reason).toContain("Estimated value: 1,200,000");
    expect(reason).toContain("Came from: tiktok / motor-reel-01");

    const actions = db.tables["audit_log"]!.map((a) => a["action"]);
    expect(actions).toEqual(["client.created", "website.enquiry_received"]);
    expect(db.tables["audit_log"]!.every((a) => a["actor_type"] === "automation")).toBe(true);
  });

  it("is one Work item however many times the same reference arrives", async () => {
    const first = await json(await post(enquiry()));
    const second = await post(enquiry());
    expect(second.status).toBe(200);
    expect(await json(second)).toMatchObject({ workItemId: first.workItemId, duplicate: true });
    expect(db.tables["work_items"]).toHaveLength(1);
    expect(db.tables["clients"]).toHaveLength(2);
  });

  it("keeps two different people with the same name apart", async () => {
    const res = await post(enquiry({ contact: { name: "Wanjiku Kamau", email: "other@example.com", phone: "0722 111 222" } }));
    const body = await json(res);
    expect(body.existingClient).toBe(false);
    expect(db.tables["clients"]!.find((c) => c["id"] === body.clientId)!["name"]).toBe("Wanjiku Kamau (+254722111222)");
  });
});

describe("a fast-lane visitor with a phone number only", () => {
  it("files the client without an email and matches them by phone next time", async () => {
    const first = await json(await post(enquiry({ reference: "ASAP-MTR-FAST-000001", contact: { name: "Otieno", email: null, phone: "0733 444 555" } })));
    expect(first).toMatchObject({ existingClient: false });
    const contact = db.tables["client_contacts"]!.find((c) => c["client_id"] === first.clientId)!;
    expect(contact).toMatchObject({ email: null, phone: "+254733444555" });
    const again = await json(await post(enquiry({ reference: "ASAP-HLT-FAST-000002", kind: "quote", contact: { name: "Otieno", phone: "+254733444555" } })));
    expect(again).toMatchObject({ clientId: first.clientId, existingClient: true });
  });
});

describe("a returning client", () => {
  it("is matched by email, whatever its case", async () => {
    const body = await json(await post(enquiry({ contact: { name: "W. Kamau", email: "wanjiku@example.co.ke", phone: "0799 999 999" } })));
    expect(body).toMatchObject({ clientId: EXISTING, existingClient: true });
    expect(db.tables["clients"]).toHaveLength(1);
  });
  it("is matched by phone, whatever its format", async () => {
    const body = await json(await post(enquiry({ kind: "claim", contact: { name: "Wanjiku", email: "new@example.com", phone: "+254 712 345678" } })));
    expect(body).toMatchObject({ clientId: EXISTING, existingClient: true });
    expect(db.tables["work_items"]![0]).toMatchObject({ reason_code: "website_claim", title: "Website claim — Wanjiku, motor" });
  });
});

describe("helpers", () => {
  it("normalises Kenyan numbers to one form", () => {
    for (const n of ["0712345678", "712345678", "254712345678", "+254 712 345 678"]) expect(normalizePhone(n)).toBe("+254712345678");
  });
  it("derives a stable, brokerage-specific UUID from a reference", () => {
    const a = enquirySourceId(ORG, "ref-1");
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(enquirySourceId(ORG, "REF-1")).toBe(a);
    expect(enquirySourceId(OTHER_ORG, "ref-1")).not.toBe(a);
  });
});
