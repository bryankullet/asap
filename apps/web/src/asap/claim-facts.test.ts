/**
 * The incident, apart from the directions (staging finding, D-135). The three prompt forms seen in
 * the hosted acceptance test, plus the shapes the claim flow already handled.
 */
import { describe, expect, it } from "vitest";
import { incidentFacts } from "./claim-facts.js";

describe("incidentFacts", () => {
  it("form 1 — request, facts, then a direction: keeps the facts, drops the direction", () => {
    const r = incidentFacts(
      "Report a claim for UX TEST Karibu Logistics Ltd: on 2 October 2026 KDM 811A was in a low-speed collision causing front-left body damage. No injury was reported. Do not contact anyone or notify the insurer.",
    );
    expect(r.facts).toBe(
      "On 2 October 2026 KDM 811A was in a low-speed collision causing front-left body damage. No injury was reported.",
    );
    expect(r.facts).not.toMatch(/contact|notify/i);
    expect(r.directions).toEqual(["Do not contact anyone or notify the insurer."]);
  });

  it("form 2 — facts before the word 'claim': the facts are kept, not the trailing condition", () => {
    const r = incidentFacts(
      "UX TEST KDM 811A had a low-speed collision on 2 October 2026 with front-left body damage, no injury reported. Prepare a draft claim for UX TEST Karibu Logistics Ltd but do not register it or contact anyone.",
    );
    expect(r.facts).toBe(
      "UX TEST KDM 811A had a low-speed collision on 2 October 2026 with front-left body damage, no injury reported.",
    );
    expect(r.facts).not.toMatch(/register|contact|draft/i);
  });

  it("form 3 — facts and directions in one sentence, split by a semicolon", () => {
    const r = incidentFacts(
      "Open a claim draft for UX TEST Karibu Logistics Ltd — KDM 811A, low-speed collision on 2 October 2026, front-left body damage, no injury reported; keep it as a draft, do not contact anyone until I approve.",
    );
    expect(r.facts).toBe(
      "KDM 811A, low-speed collision on 2 October 2026, front-left body damage, no injury reported",
    );
    expect(r.facts).not.toMatch(/draft|contact|approve/i);
  });

  it("a direction inside the facts' own sentence is cut off, the facts kept", () => {
    expect(
      incidentFacts(
        "Report a claim: KDM 811A hit a gate on 2 October 2026, and do not notify the insurer yet",
      ).facts,
    ).toBe("KDM 811A hit a gate on 2 October 2026");
  });

  it("no facts it can stand behind: nothing to save, so the caller asks", () => {
    expect(
      incidentFacts("Report a claim for UX TEST Karibu Logistics. Do not contact anyone.").facts,
    ).toBeNull();
    expect(incidentFacts("Prepare a claim draft but do not register it").facts).toBeNull();
  });

  it("the shapes already in use keep their words", () => {
    expect(incidentFacts("Report a claim for the accident yesterday").facts).toBe(
      "The accident yesterday",
    );
    expect(incidentFacts("Report a claim: fire in the store on 12 Sep").facts).toBe(
      "Fire in the store on 12 Sep",
    );
    expect(incidentFacts("Report a claim for the van hit yesterday — policy not known").facts).toBe(
      "The van hit yesterday",
    );
  });
});

describe("instruction-first claim requests keep every incident fact (D-137)", () => {
  const INSTRUCTION_FIRST =
    "For UX TEST Karibu Logistics Ltd, prepare (but do not register) a claim draft for the fictional low-speed collision on 2 October 2026 at 08:20 involving KDM 811A; front-left body damage; no injury reported. Use only these incident facts. First check for the policy that covered that date. Do not contact anyone or imply coverage or acceptance.";
  const FACTS_FIRST =
    "Low-speed collision on 2 October 2026 at 08:20 involving KDM 811A; front-left body damage; no injury reported. Prepare a claim draft for UX TEST Karibu Logistics Ltd but do not register it. Do not contact anyone.";
  for (const [name, prompt] of [
    ["instruction-first", INSTRUCTION_FIRST],
    ["facts-first", FACTS_FIRST],
  ] as const) {
    it(
      name +
        ": the collision, the time, the vehicle, the damage and no injury all survive; no instruction does",
      () => {
        const { facts } = incidentFacts(prompt);
        expect(facts).toMatch(/collision/i);
        expect(facts).toMatch(/08:20/);
        expect(facts).toMatch(/KDM 811A/);
        expect(facts).toMatch(/front-left body damage/i);
        expect(facts).toMatch(/no injury reported/i);
        expect(facts).not.toMatch(
          /register|contact|coverage|acceptance|Use only|First check|Karibu|claim draft/i,
        );
      },
    );
  }
});
