/**
 * `GET /attention` and `GET /work`, the two capability endpoints behind Today and Work.
 *
 * The fixtures are Amina Otieno's five cards from `docs/click-through.md` — the acceptance
 * document — so this suite fails if the endpoint stops producing what the seeded Today produces.
 * A Beta Risk row sits in the same tables throughout: it must never appear in an Acme answer.
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";

const ORG_A = "10000000-0000-4000-8000-00000000000a";
const ORG_B = "10000000-0000-4000-8000-00000000000b";
const AMINA = { id: "a0000000-0000-4000-8000-000000000001", email: "admin@acme-brokers.test" };
const CLIENT = "70000000-0000-4000-8000-00000000000a";
const POLICY = "50000000-0000-4000-8000-0000000000a1";
const PERIOD = "60000000-0000-4000-8000-0000000000a1";
const INSURER = "80000000-0000-4000-8000-0000000000a1";

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

const step = (id: string, label: string, actor: string, state: string) => ({
  id,
  label,
  actor,
  state,
  guards: [],
  evidence: [],
  actions: [],
  party: null,
  reason: null,
  recorded: [],
  runId: null,
});

const item = (over: Record<string, unknown>) => ({
  organization_id: ORG_A,
  kind: "renewal",
  client_id: null,
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
  reason: null,
  steps: [],
  exception: null,
  version: 1,
  created_at: ago(6 * DAY),
  updated_at: ago(DAY),
  completed_at: null,
  deleted_at: null,
  ...over,
});

const CLAIM_REASON =
  "The incident came in by email and is still a draft. Choose the policy period that covers 2 September before anything is sent to Jubilee.";
const ENDORSEMENT_REASON =
  "Jubilee has answered every item: one vehicle accepted, one rejected. Applying the answer writes a new policy version.";
const PLACEMENT_REASON = "Approval is blocked until Acme Motors' client file is cleared.";
const CERTIFICATE_REASON =
  "Cover is confirmed but no certificate number has been allocated for this vehicle.";
const RENEWAL_REASON =
  "Terms were requested from Jubilee five days ago and the check was due yesterday.";

const CERT_ID = "30000000-0000-4000-8000-000000000002";

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
        { id: CLIENT, organization_id: ORG_A, name: "Acme Motors", kind: "corporate", file_status: "incomplete" },
      ],
      insurers: [{ id: INSURER, organization_id: ORG_A, name: "Jubilee" }],
      policies: [
        {
          id: POLICY,
          organization_id: ORG_A,
          client_id: CLIENT,
          insurer_id: INSURER,
          class_of_business: "Motor commercial",
          policy_number: "MC-4471",
          created_at: ago(0),
          updated_at: ago(0),
          deleted_at: null,
        },
      ],
      policy_periods: [
        {
          id: PERIOD,
          organization_id: ORG_A,
          policy_id: POLICY,
          period_start: "2025-10-14",
          period_end: "2026-10-14",
          created_at: ago(0),
          updated_at: ago(0),
        },
      ],
      work_items: [
        item({
          id: "30000000-0000-4000-8000-000000000003",
          title: "Jane Wanjiku — claim, incident 2 September",
          kind: "claim",
          cover_status: "active",
          reason: CLAIM_REASON,
          steps: [step("match", "Matched to a policy period", "you", "now")],
          updated_at: ago(5 * 60_000),
        }),
        item({
          id: "30000000-0000-4000-8000-000000000006",
          title: "Acme Motors — add KDC 900T to the Motor commercial policy",
          kind: "endorsement",
          cover_status: "active",
          reason: ENDORSEMENT_REASON,
          steps: [step("update_policy", "Policy updated", "you", "now")],
          updated_at: ago(2 * 3_600_000),
        }),
        item({
          id: "30000000-0000-4000-8000-000000000005",
          title: "Acme Motors — Motor commercial placement with Jubilee",
          kind: "placement",
          client_id: CLIENT,
          cover_status: "requested",
          reason: PLACEMENT_REASON,
          steps: [
            {
              ...step("approve", "Placement approved", "you", "blocked"),
              guards: ["client_file_cleared"],
            },
          ],
        }),
        item({
          id: CERT_ID,
          title: "KDA 482A — motor certificate",
          kind: "certificate",
          cover_status: "confirmed",
          reason: CERTIFICATE_REASON,
          steps: [step("allocate", "Allocate a number", "you", "now")],
          updated_at: ago(20 * 60_000),
        }),
        item({
          id: "30000000-0000-4000-8000-000000000001",
          title: "Acme Motors — renewal terms from Jubilee",
          client_id: CLIENT,
          policy_period_id: PERIOD,
          task_status: "with_party",
          task_party: "Jubilee",
          task_since: ago(5 * DAY),
          task_next_check: ago(DAY),
          cover_status: "active",
          money_status: "unpaid",
          reason: RENEWAL_REASON,
          steps: [step("terms", "Terms received", "insurer", "now")],
        }),
        // Done: in Work → Done, never on Today.
        item({
          id: "30000000-0000-4000-8000-000000000004",
          title: "Acme Motors — Q2 statement reconciled",
          kind: "reconciliation",
          task_status: "done",
          reason: "Reconciled and closed.",
        }),
        // With another party, next check a month out: Work → With others, not Today.
        item({
          id: "30000000-0000-4000-8000-000000000007",
          title: "Acme — insurer endorsement acknowledgement",
          task_status: "with_party",
          task_party: "Jubilee",
          task_since: ago(2 * DAY),
          task_next_check: ahead(30 * DAY),
          reason: "Acknowledgement is not due yet.",
        }),
        // Soft-deleted: never returned.
        item({
          id: "30000000-0000-4000-8000-000000000008",
          title: "Acme — cancelled request",
          deleted_at: ago(DAY),
          reason: "Deleted.",
        }),
        // Beta Risk, a different brokerage. Must not appear in any Acme answer.
        item({
          id: "30000000-0000-4000-8000-0000000000b1",
          organization_id: ORG_B,
          title: "Otieno household — new business quote",
          reason: "Three quotes are back; a recommendation is waiting for you.",
        }),
      ],
      runs: [
        {
          id: "40000000-0000-4000-8000-000000000003",
          organization_id: ORG_A,
          work_item_id: CERT_ID,
          title: "Certificate extraction",
          status: "could_not_finish",
          next_step: "Check this file",
          started_by: null,
          boot_token: null,
          started_at: ago(3_600_000),
          ended_at: ago(3_300_000),
          created_at: ago(3_600_000),
          updated_at: ago(3_300_000),
        },
        {
          id: "40000000-0000-4000-8000-000000000009",
          organization_id: ORG_A,
          work_item_id: null,
          title: "Mailbox sweep",
          status: "could_not_finish",
          next_step: "Nothing to sweep",
          started_by: null,
          boot_token: null,
          started_at: ago(7_200_000),
          ended_at: ago(7_000_000),
          created_at: ago(7_200_000),
          updated_at: ago(7_000_000),
        },
        {
          id: "40000000-0000-4000-8000-00000000000b",
          organization_id: ORG_B,
          work_item_id: null,
          title: "Beta run",
          status: "could_not_finish",
          next_step: "Beta only",
          started_by: null,
          boot_token: null,
          started_at: ago(600_000),
          ended_at: ago(500_000),
          created_at: ago(600_000),
          updated_at: ago(500_000),
        },
      ],
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

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
// Test-only: bodies are asserted field by field, so a loose type is the honest one here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<any> => res.json();

describe("GET /attention", () => {
  it("requires a session", async () => {
    const res = await app.request("/attention");
    expect(res.status).toBe(401);
  });

  it("returns Amina's five cards: four that need her and one check that is due", async () => {
    const res = await app.request("/attention", { headers: auth("tok-amina") });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.organization).toEqual({ id: ORG_A, name: "Acme Insurance Brokers" });
    expect(body.items).toHaveLength(5);
    const needs = body.items.filter((i: { section: string }) => i.section === "needs_you");
    const due = body.items.filter((i: { section: string }) => i.section === "checks_due");
    expect(needs).toHaveLength(4);
    expect(due).toHaveLength(1);
    expect(due[0].item.title).toBe("Acme Motors — renewal terms from Jubilee");
    expect(new Set(needs.map((i: { item: { title: string } }) => i.item.title))).toEqual(
      new Set([
        "Jane Wanjiku — claim, incident 2 September",
        "Acme Motors — add KDC 900T to the Motor commercial policy",
        "Acme Motors — Motor commercial placement with Jubilee",
        "KDA 482A — motor certificate",
      ]),
    );
  });

  it("puts Needs you before Checks due and ranks each section from 1", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    const sections = body.items.map((i: { section: string }) => i.section);
    // The click-through document: "Today shows Needs you and Checks due, in that order."
    expect(sections).toEqual([
      "needs_you",
      "needs_you",
      "needs_you",
      "needs_you",
      "checks_due",
    ]);
    expect(body.items.map((i: { rank: number }) => i.rank)).toEqual([1, 2, 3, 4, 1]);
    // Inside a section, the deterministic signal score orders it — not recency. The blocked
    // placement and the item a run could not finish outrank the two that are merely recent.
    expect(body.items.slice(0, 4).map((i: { item: { title: string } }) => i.item.title)).toEqual([
      "Acme Motors — Motor commercial placement with Jubilee",
      "KDA 482A — motor certificate",
      "Jane Wanjiku — claim, incident 2 September",
      "Acme Motors — add KDC 900T to the Motor commercial policy",
    ]);
    // The score falls monotonically down the section, so the ranking is auditable.
    const scores = body.items.slice(0, 4).map((i: { score: number }) => i.score);
    expect(scores).toEqual([...scores].sort((a: number, b: number) => b - a));
  });

  it("carries the plain-English reason and the step that is waiting", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    const byTitle = (t: string) =>
      body.items.find((i: { item: { title: string } }) => i.item.title === t);
    expect(byTitle("Jane Wanjiku — claim, incident 2 September").reason).toBe(CLAIM_REASON);
    expect(byTitle("Acme Motors — Motor commercial placement with Jubilee").reason).toBe(
      PLACEMENT_REASON,
    );
    expect(byTitle("Acme Motors — renewal terms from Jubilee").reason).toBe(RENEWAL_REASON);
    expect(byTitle("KDA 482A — motor certificate").nowStep).toEqual({
      id: "allocate",
      label: "Allocate a number",
      actor: "you",
    });
  });

  it("attaches the run that could not finish to the item it left needing a person", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    const cert = body.items.find((i: { item: { id: string } }) => i.item.id === CERT_ID);
    expect(cert.runFailure).toEqual({
      id: "40000000-0000-4000-8000-000000000003",
      title: "Certificate extraction",
      status: "could_not_finish",
      nextStep: "Check this file",
    });
    // Items with no failed run say so with null, never with an empty object.
    expect(
      body.items.find(
        (i: { item: { title: string } }) =>
          i.item.title === "Jane Wanjiku — claim, incident 2 September",
      ).runFailure,
    ).toBeNull();
  });

  it("surfaces a failed run that has no work item of its own", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    expect(body.orphanRuns).toHaveLength(1);
    expect(body.orphanRuns[0].title).toBe("Mailbox sweep");
    // The certificate run is not an orphan: its item is already on the list.
    expect(body.orphanRuns.map((r: { id: string }) => r.id)).not.toContain(
      "40000000-0000-4000-8000-000000000003",
    );
  });

  it("uses the server's clock to decide a check is due", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    expect(Date.parse(body.generatedAt)).toBeLessThanOrEqual(Date.now());
    // A check a month out is not due, however the browser's clock is set.
    expect(
      body.items.some(
        (i: { item: { title: string } }) =>
          i.item.title === "Acme — insurer endorsement acknowledgement",
      ),
    ).toBe(false);
  });

  it("excludes done, soft-deleted and other brokerages' rows, and counts none of them", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    const titles = body.items.map((i: { item: { title: string } }) => i.item.title);
    expect(titles).not.toContain("Acme Motors — Q2 statement reconciled");
    expect(titles).not.toContain("Acme — cancelled request");
    expect(titles).not.toContain("Otieno household — new business quote");
    // A hidden row is never a number: the counts describe what the caller can see.
    expect(body.sections).toEqual([
      { key: "needs_you", label: "Needs you", visible: 4, returned: 4 },
      { key: "checks_due", label: "Checks due", visible: 1, returned: 1 },
    ]);
    expect(body.orphanRuns.map((r: { title: string }) => r.title)).not.toContain("Beta run");
  });

  it("caps the default result and says what the cap is", async () => {
    const extra = Array.from({ length: 40 }, (_, i) =>
      item({
        id: `30000000-0000-4000-8000-0000000${String(i).padStart(5, "0")}`,
        title: `Filler ${i}`,
        reason: "Filler.",
        updated_at: ago(10 * DAY + i * 1000),
      }),
    );
    db.tables["work_items"]!.push(...extra);
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    // Discover is a short ranked list, not a dashboard: twelve, and it says how many it left out.
    expect(body.cap).toBe(12);
    const needs = body.items.filter((i: { section: string }) => i.section === "needs_you");
    expect(needs).toHaveLength(12);
    expect(body.sections[0]).toEqual({
      key: "needs_you",
      label: "Needs you",
      visible: 44,
      returned: 12,
    });
  });
});

describe("GET /work", () => {
  it("requires a session", async () => {
    expect((await app.request("/work?view=needs")).status).toBe(401);
  });

  it("serves the four views with the same membership rules the browser applied", async () => {
    const view = async (v: string) =>
      readJson(await app.request(`/work?view=${v}`, { headers: auth("tok-amina") }));

    const needs = await view("needs");
    expect(needs.label).toBe("Needs you");
    expect(needs.items).toHaveLength(4);

    const withOthers = await view("with");
    expect(withOthers.label).toBe("With others");
    expect(withOthers.items.map((i: { item: { title: string } }) => i.item.title).sort()).toEqual([
      "Acme Motors — renewal terms from Jubilee",
      "Acme — insurer endorsement acknowledgement",
    ]);

    const done = await view("done");
    expect(done.items).toHaveLength(1);
    expect(done.items[0].item.title).toBe("Acme Motors — Q2 statement reconciled");

    // Recent is everything not done.
    const recent = await view("recent");
    expect(recent.items).toHaveLength(6);
    expect(
      recent.items.some(
        (i: { item: { title: string } }) => i.item.title === "Acme Motors — Q2 statement reconciled",
      ),
    ).toBe(false);
  });

  it("scopes every view to the caller's brokerage", async () => {
    for (const v of ["needs", "with", "done", "recent"]) {
      const body = await readJson(await app.request(`/work?view=${v}`, { headers: auth("tok-amina") }));
      expect(body.organization.id).toBe(ORG_A);
      for (const row of body.items) expect(row.item.organization_id).toBe(ORG_A);
    }
  });

  it("ranks, caps and reports the count instead of handing over 100 rows", async () => {
    const extra = Array.from({ length: 60 }, (_, i) =>
      item({
        id: `30000000-0000-4000-8000-0000001${String(i).padStart(5, "0")}`,
        title: `Filler ${i}`,
        reason: "Filler.",
        updated_at: ago(10 * DAY + i * 1000),
      }),
    );
    db.tables["work_items"]!.push(...extra);
    const body = await readJson(
      await app.request("/work?view=needs&limit=10", { headers: auth("tok-amina") }),
    );
    expect(body.items).toHaveLength(10);
    expect(body.items.map((i: { rank: number }) => i.rank)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(body.visible).toBe(64);
    expect(body.returned).toBe(10);
    expect(body.cap).toBe(10);
  });

  it("falls back to the needs view when the view is unknown", async () => {
    const body = await readJson(await app.request("/work?view=nonsense", { headers: auth("tok-amina") }));
    expect(body.view).toBe("needs");
  });
});

describe("Discover ranks deterministically, from rows", () => {
  it("gives every item at least one signal that names the row it came from", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    for (const row of body.items) {
      expect(row.signals.length, row.item.title).toBeGreaterThan(0);
      for (const sig of row.signals) {
        expect(sig.because.length).toBeGreaterThan(0);
        expect(typeof sig.points).toBe("number");
      }
      // The score is the sum of its signals: nothing else contributes, so it is auditable.
      const sum = row.signals.reduce((n: number, x: { points: number }) => n + x.points, 0);
      expect(row.score, row.item.title).toBe(sum);
    }
  });

  it("names the blocked step, the overdue check and the failed run as the reasons they are", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    const by = (t: string) => body.items.find((i: { item: { title: string } }) => i.item.title === t);

    const placement = by("Acme Motors — Motor commercial placement with Jubilee");
    const ids = placement.signals.map((x: { id: string }) => x.id);
    expect(ids).toContain("step_blocked");
    expect(placement.signals.find((x: { id: string }) => x.id === "step_blocked").because).toMatch(
      /Placement approved/,
    );

    const cert = by("KDA 482A — motor certificate");
    expect(cert.signals.map((x: { id: string }) => x.id)).toContain("run_failed");
    expect(cert.signals.find((x: { id: string }) => x.id === "run_failed").because).toMatch(
      /Certificate extraction could not finish/,
    );

    const renewal = by("Acme Motors — renewal terms from Jubilee");
    const overdue = renewal.signals.find((x: { id: string }) => x.id === "check_overdue");
    expect(overdue).toBeTruthy();
    // The party is named and the lateness counted from the server's clock, not the browser's.
    expect(overdue.because).toMatch(/^Jubilee was asked and the check was due/);
  });

  it("is stable: the same rows rank the same way twice", async () => {
    const a = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    const b = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    expect(a.items.map((i: { item: { id: string } }) => i.item.id)).toEqual(
      b.items.map((i: { item: { id: string } }) => i.item.id),
    );
  });
});

describe("Discover states how well each fact is known", () => {
  it("says cover is waiting for verification when it was only requested", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    const placement = body.items.find(
      (i: { item: { title: string } }) =>
        i.item.title === "Acme Motors — Motor commercial placement with Jubilee",
    );
    const cover = placement.facts.find((f: { label: string }) => f.label === "Cover for this period");
    expect(cover.condition).toBe("waiting");
    // The demo's central rule, as a fact condition rather than a sentence someone wrote.
    expect(cover.derivedFrom).toMatch(/A request is not proof of cover/);
    expect(placement.signals.map((x: { id: string }) => x.id)).toContain("cover_uncertain");
  });

  it("marks a required-but-unrecorded piece of evidence as missing, and one owed by a party as waiting", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    const conditions = new Set(
      body.items.flatMap((i: { facts: { condition: string }[] }) => i.facts.map((f) => f.condition)),
    );
    expect(conditions.has("missing") || conditions.has("waiting")).toBe(true);
    for (const row of body.items) {
      for (const f of row.facts) {
        // Missing and waiting never carry a reference: that is what makes them missing.
        if (f.condition === "missing" || f.condition === "waiting") expect(f.reference).toBeNull();
        // Inferred always says what it was derived from; it is never presented as recorded.
        if (f.condition === "inferred") expect(f.derivedFrom).not.toBeNull();
      }
    }
  });

  it("never carries a confidence, a percentage or a progress value", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    const flat = JSON.stringify(body);
    expect(flat).not.toMatch(/confidence/i);
    expect(flat).not.toMatch(/"progress"/i);
    expect(flat).not.toMatch(/\d+%/);
  });
});

describe("Discover carries the context a card needs", () => {
  it("names the client and the period of cover where it has one", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    const withClient = body.items.filter((i: { client: unknown }) => i.client !== null);
    expect(withClient.length).toBeGreaterThan(0);
    for (const row of withClient) expect(row.client.name).toBe("Acme Motors");

    // The renewal names its client-policy-year, so the card can show which period it is about.
    const renewal = body.items.find(
      (i: { item: { title: string } }) => i.item.title === "Acme Motors — renewal terms from Jubilee",
    );
    expect(renewal.period).toMatchObject({
      classOfBusiness: "Motor commercial",
      insurerName: "Jubilee",
      policyNumber: "MC-4471",
      periodStart: "2025-10-14",
      periodEnd: "2026-10-14",
    });
    expect(typeof renewal.period.daysToEnd).toBe("number");
    expect(renewal.links.policy).toBe(`/r/${PERIOD}?kind=policy`);

    // An incomplete client file blocking a placement is its own named signal.
    const placement = body.items.find(
      (i: { item: { title: string } }) =>
        i.item.title === "Acme Motors — Motor commercial placement with Jubilee",
    );
    expect(placement.signals.map((x: { id: string }) => x.id)).toContain("file_blocks_placement");
  });

  it("gives every card routes out: the work, the client and Ask in the item's own words", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    for (const row of body.items) {
      expect(row.links.work).toBe(`/r/${row.item.id}`);
      if (row.item.client_id) expect(row.links.client).toBe(`/files/${row.item.client_id}`);
      expect(row.links.ask).toBe(row.item.title);
    }
  });

  it("reports nothing degraded when every read succeeded", async () => {
    const body = await readJson(await app.request("/attention", { headers: auth("tok-amina") }));
    expect(body.degraded).toEqual([]);
  });
});
