import { describe, expect, it } from "vitest";
import { matchClientName, normaliseClientName } from "./clientMatch.js";

const clients = [
  { id: "a", name: "Acme Motors", kind: "corporate" as const },
  { id: "b", name: "Acme Logistics Ltd", kind: "corporate" as const },
  { id: "j", name: "Jane Wanjiku", kind: "individual" as const },
];

describe("client name matching", () => {
  it("normalises case, punctuation, whitespace and legal suffixes", () => {
    expect(normaliseClientName("ACME  MOTORS LTD.")).toBe("acme motors");
    expect(normaliseClientName("Acme Motors Limited")).toBe("acme motors");
    expect(normaliseClientName("Co")).toBe("co"); // a lone suffix is a name, not nothing
  });

  it("three spellings of one client resolve to the same row", () => {
    for (const typed of ["acme motors", "ACME MOTORS LTD", "Acme  Motors."]) {
      expect(matchClientName(typed, clients)).toEqual({ outcome: "one", client: clients[0] });
    }
  });

  it("asks which when a name is ambiguous", () => {
    const r = matchClientName("Acme", clients);
    expect(r.outcome).toBe("many");
    if (r.outcome === "many") expect(r.candidates.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("returns none for an unknown name, never a creation", () => {
    expect(matchClientName("Otieno", clients)).toEqual({ outcome: "none" });
    expect(matchClientName("   ", clients)).toEqual({ outcome: "none" });
  });
});
