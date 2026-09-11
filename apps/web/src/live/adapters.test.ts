import type { AttentionItem, Automation, RunListItem, WorkListResponse } from "@asap/schema";
import { describe, expect, it } from "vitest";
import {
  automationCardFromRow,
  elapsedLabel,
  focusCardFromAttention,
  jobCardFromRow,
  workTileFromRow,
} from "./adapters.js";

/**
 * Real records, as the approved demo's cards (D-066).
 *
 * These are the only place a real row becomes a sentence on screen, so they are where the rules
 * have to hold: a card names a client rather than an id, says what the engine said rather than
 * composing its own explanation, shows progress only where progress was derived, and never claims
 * a business outcome because a job finished.
 */

const NOW = new Date("2026-09-11T09:00:00.000Z");
const ORG = "10000000-0000-4000-8000-00000000000a";
const CLIENT = "20000000-0000-4000-8000-000000000001";

const item = (over: Partial<AttentionItem["item"]> = {}): AttentionItem["item"] => ({
  id: "30000000-0000-4000-8000-000000000001",
  organization_id: ORG,
  title: "Add KDN 482Q to Acme's cover",
  kind: "tor",
  client_id: CLIENT,
  policy_period_id: null,
  insurer_id: null,
  class_of_business: null,
  owner_id: null,
  task_status: "needs_you",
  task_party: null,
  task_since: "2026-09-11T08:48:00.000Z",
  task_next_check: null,
  cover_status: null,
  cover_inception_at: null,
  money_status: null,
  reason: "Meridian has not confirmed cover for the vehicle.",
  steps: [],
  exception: null,
  version: 1,
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-11T08:48:00.000Z",
  completed_at: null,
  deleted_at: null,
  ...over,
});

const attention = (over: Partial<AttentionItem> = {}): AttentionItem => ({
  section: "needs_you",
  rank: 1,
  score: 24,
  item: item(),
  reason: "Meridian has not confirmed cover for the vehicle.",
  signals: [{ id: "cover_uncertain", because: "No confirmation is recorded.", points: 24 }],
  nowStep: null,
  client: { id: CLIENT, name: "Acme Manufacturing Ltd" },
  period: null,
  facts: [],
  runFailure: null,
  links: { work: `/r/${item().id}`, client: `/files/${CLIENT}`, policy: null, ask: "What about KDN 482Q?" },
  ...over,
});

describe("elapsed, in words", () => {
  it("counts from the server's clock, in the demo's own wording", () => {
    expect(elapsedLabel("2026-09-11T08:48:00.000Z", NOW)).toBe("12 min ago");
    expect(elapsedLabel("2026-09-11T06:00:00.000Z", NOW)).toBe("3 hours ago");
    expect(elapsedLabel("2026-08-08T09:00:00.000Z", NOW)).toBe("34 days");
    expect(elapsedLabel("2026-09-11T08:59:30.000Z", NOW)).toBe("just now");
  });
});

describe("Discover's focus card, from a ranked item", () => {
  it("names the client rather than an id, and says what the engine said", () => {
    const card = focusCardFromAttention(attention(), NOW, 0);
    expect(card.clientLabel).toBe("Acme Manufacturing Ltd");
    expect(card.clientLabel).not.toContain("-");
    // The reason is the engine's. A card never writes its own explanation (§45 rule 9).
    expect(card.detail).toBe("Meridian has not confirmed cover for the vehicle.");
    expect(card.headline).toBe("Add KDN 482Q to Acme's cover");
    expect(card.workType).toBe("Servicing / TOR Work");
    expect(card.elapsed).toBe("12 min ago");
  });

  it("takes its tone from the strongest signal, never from the browser's opinion", () => {
    expect(focusCardFromAttention(attention(), NOW, 0).toneLabel).toBe("At risk");
    expect(
      focusCardFromAttention(
        attention({ signals: [{ id: "money_unpaid", because: "Unpaid.", points: 18 }] }),
        NOW,
        0,
      ).toneLabel,
    ).toBe("Overdue");
    expect(
      focusCardFromAttention(
        attention({
          runFailure: { id: "r", title: "Extraction", status: "could_not_finish", nextStep: null },
        }),
        NOW,
        0,
      ),
    ).toMatchObject({ tone: "high", toneLabel: "Could not finish" });
  });

  it("gives only the first card the urgent border, as the approved screen does", () => {
    expect(focusCardFromAttention(attention({ signals: [{ id: "exception_open", because: "x", points: 30 }] }), NOW, 0).urgent).toBe(true);
    expect(focusCardFromAttention(attention({ signals: [{ id: "exception_open", because: "x", points: 30 }] }), NOW, 3).urgent).toBe(false);
  });

  it("says 'This brokerage' when an item has no client, rather than an empty space", () => {
    const card = focusCardFromAttention(attention({ client: null }), NOW, 0);
    expect(card.clientLabel).toBe("This brokerage");
  });
});

const workRow = (over: Partial<WorkListResponse["items"][number]> = {}): WorkListResponse["items"][number] => ({
  rank: 1,
  item: item(),
  reason: "Meridian has not confirmed cover for the vehicle.",
  nowStep: null,
  runFailure: null,
  client: { id: CLIENT, name: "Acme Manufacturing Ltd" },
  period: {
    id: "40000000-0000-4000-8000-000000000001",
    classOfBusiness: "Commercial Motor",
    insurerName: "Meridian General",
    policyNumber: "ASAP-MTR-2026-00418",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    daysToEnd: 111,
  },
  ...over,
});

describe("Work's tile, from a ranked row", () => {
  it("reads as the demo's tile: kind, badge, headline, reason, context", () => {
    expect(workTileFromRow(workRow())).toMatchObject({
      workType: "Servicing / TOR",
      pill: "Active",
      pillTone: "high",
      headline: "Add KDN 482Q to Acme's cover",
      summary: "Meridian has not confirmed cover for the vehicle.",
      contextLabel: "Acme Manufacturing Ltd · Commercial Motor",
      href: `/r/${item().id}`,
    });
  });

  it("names who it is waiting on, because the row knows", () => {
    const row = workRow({
      item: item({ task_status: "with_party", task_party: "Meridian", task_since: "2026-09-01T00:00:00.000Z" }),
    });
    expect(workTileFromRow(row).pill).toBe("Waiting on Meridian");
  });

  it("puts a run that could not finish above the task's own status", () => {
    const row = workRow({
      runFailure: { id: "r", title: "Extraction", status: "could_not_finish", nextStep: null },
    });
    expect(workTileFromRow(row)).toMatchObject({ pill: "Could not finish", pillTone: "high" });
  });
});

const runRow = (over: Partial<RunListItem> = {}): RunListItem => ({
  run: {
    id: "50000000-0000-4000-8000-000000000001",
    organization_id: ORG,
    work_item_id: item().id,
    title: "Comparing policy schedules",
    status: "working",
    next_step: null,
    started_by: null,
    boot_token: null,
    started_at: "2026-09-11T08:00:00.000Z",
    ended_at: null,
    created_at: "2026-09-11T08:00:00.000Z",
    updated_at: "2026-09-11T08:00:00.000Z",
  },
  group: "running",
  progress: 68,
  lastEvent: "Reading Endorsed Schedule v4",
  waitingFor: null,
  needsPerson: false,
  work: { id: item().id, title: "Add KDN 482Q to Acme's cover" },
  client: { id: CLIENT, name: "Acme Manufacturing Ltd" },
  period: null,
  ...over,
});

describe("the Jobs board's card, from a run", () => {
  it("shows what the run last did, in the run's own words", () => {
    expect(jobCardFromRow(runRow(), "Running")).toMatchObject({
      headline: "Comparing policy schedules",
      pillLabel: "Running",
      pillTone: "running",
      progress: 68,
      note: "Reading Endorsed Schedule v4",
      contextLine: "Acme Manufacturing Ltd",
    });
  });

  it("prefers what it is waiting for once it has stopped", () => {
    const card = jobCardFromRow(
      runRow({
        run: { ...runRow().run, status: "could_not_finish" },
        waitingFor: "The schedule had no premium line.",
        needsPerson: true,
        progress: null,
      }),
      "Work",
    );
    expect(card.note).toBe("The schedule had no premium line.");
    expect(card.pillLabel).toBe("Could not finish");
    expect(card.progress).toBeNull();
    expect(card.actionLabel).toBe("Open Work");
  });

  it("never turns a finished job into a business outcome", () => {
    const card = jobCardFromRow(
      runRow({ run: { ...runRow().run, status: "finished" }, progress: 100 }),
      "Completed",
    );
    expect(card.pillLabel).toBe("Completed");
    expect(JSON.stringify(card)).not.toMatch(/renewed|confirmed|accepted|paid/i);
  });

  it("says nothing rather than zero when a run has recorded nothing", () => {
    expect(jobCardFromRow(runRow({ lastEvent: null, waitingFor: null }), "Running").note).toBe(
      "Nothing recorded yet",
    );
  });
});

const automation = (over: Partial<Automation> = {}): Automation => ({
  id: "60000000-0000-4000-8000-000000000001",
  organization_id: ORG,
  name: "Claim follow-up monitor",
  description: "When a claim stops moving, reconstruct the timeline and prepare a follow-up.",
  trigger_event: "check.overdue",
  conditions: [],
  skill: "claim.follow_up",
  prepared_verb: "draft",
  approval: "always",
  sends_externally: true,
  enabled: true,
  created_by: "a0000000-0000-4000-8000-000000000001",
  created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("an automation's card", () => {
  it("reads the flow line from the trigger and the verb, not from prose", () => {
    expect(automationCardFromRow(automation(), [])).toMatchObject({
      headline: "Claim follow-up monitor",
      flowFrom: "A check falls overdue",
      flowTo: "Prepare a draft",
      enabled: true,
    });
  });

  it("counts what it has done, and says so when it has done nothing", () => {
    expect(automationCardFromRow(automation(), []).activity).toBe("No runs yet");
    const runs = [
      { outcome: "prepared" },
      { outcome: "conditions_not_met" },
    ] as Parameters<typeof automationCardFromRow>[1];
    expect(automationCardFromRow(automation(), runs).activity).toBe(
      "Ran 2 times · 1 prepared something",
    );
  });

  it("does not show a count it has not read yet", () => {
    // Undefined is "not loaded", which is not the same fact as zero — and zero would read as
    // "this has never fired".
    expect(automationCardFromRow(automation(), undefined).activity).toBe(
      "Checking what it has done",
    );
  });

  it("says a paused automation is paused, rather than showing last month's count", () => {
    expect(automationCardFromRow(automation({ enabled: false }), []).activity).toBe(
      "Paused · No new runs",
    );
  });
});
