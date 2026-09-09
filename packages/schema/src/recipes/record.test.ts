import { describe, expect, it } from "vitest";
import { RECORD_SECTIONS, currentStep, focusCard } from "./record.js";
import type { Step, WorkItemRow } from "../work.js";

const step = (over: Partial<Step> & Pick<Step, "id" | "label">): Step => ({
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

const item = (over: Partial<WorkItemRow>): Parameters<typeof focusCard>[0] => ({
  kind: "placement",
  steps: [],
  reason: null,
  task_status: "needs_you",
  exception: null,
  ...over,
});

describe("focusCard", () => {
  it("names the decision in business words, not the step's label", () => {
    const card = focusCard(
      item({
        kind: "placement",
        steps: [step({ id: "approve", label: "Placement approved", state: "now" })],
        reason: "Approval is blocked until Acme Motors' client file is cleared.",
      }),
    );
    expect(card.eyebrow).toBe("Next step");
    expect(card.headline).toBe("Approve this placement");
    expect(card.why).toBe("Approval is blocked until Acme Motors' client file is cleared.");
  });

  it("falls back to the step's label where there is no business phrasing", () => {
    const card = focusCard(
      item({
        kind: "certificate",
        steps: [step({ id: "s2", label: "Allocate a number", state: "now" })],
      }),
    );
    expect(card.headline).toBe("Allocate a number");
  });

  it("states the blocker when the step is blocked, and marks the headline as not yet", () => {
    const card = focusCard(
      item({
        kind: "placement",
        steps: [
          step({
            id: "approve",
            label: "Placement approved",
            state: "blocked",
            reason: "We cannot instruct cover for a client whose file is not complete.",
          }),
        ],
      }),
    );
    expect(card.headline).toBe("Approve this placement — not yet");
    expect(card.blockedBy).toBe(
      "We cannot instruct cover for a client whose file is not complete.",
    );
  });

  it("names the guard when a blocked step carries no reason of its own", () => {
    const card = focusCard(
      item({
        kind: "placement",
        steps: [
          step({ id: "approve", label: "x", state: "blocked", guards: ["client_file_cleared"] }),
        ],
      }),
    );
    expect(card.blockedBy).toBe("This waits until the client's file is cleared.");
  });

  it("says so when nothing is waiting on a person", () => {
    const done = focusCard(
      item({ steps: [step({ id: "a", label: "a", state: "done" })], task_status: "done" }),
    );
    expect(done.headline).toBe("Everything here is finished");
    expect(currentStep({ steps: [step({ id: "a", label: "a", state: "done" })] })).toBeNull();
  });

  it("leads with the exception when the item was closed without completing", () => {
    const card = focusCard(
      item({
        steps: [step({ id: "a", label: "a", state: "done" })],
        exception: {
          kind: "lapse",
          reason: "No instruction by expiry",
          clientToldEvidence: null,
          recordedBy: "Amina Otieno",
          recordedAt: "2026-09-01T09:00:00Z",
        },
      }),
    );
    expect(card.headline).toBe("This was closed without completing");
    expect(card.why).toBe("No instruction by expiry");
  });
});

describe("RECORD_SECTIONS", () => {
  it("leads every kind with the focus card", () => {
    for (const [kind, sections] of Object.entries(RECORD_SECTIONS)) {
      expect(sections[0], kind).toBe("focus");
    }
  });

  it("gives the servicing panel only to the kinds that have one", () => {
    const withServicing = Object.entries(RECORD_SECTIONS)
      .filter(([, s]) => s.includes("servicing"))
      .map(([k]) => k)
      .sort();
    expect(withServicing).toEqual(["claim", "endorsement"]);
  });
});
