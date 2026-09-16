/**
 * Interaction truth: nothing in the shell is inert, blank, or falsely successful.
 *
 * Every control must do one of a short list of honest things — navigate, mutate, open a real
 * panel, or say why it cannot and what to do instead.
 *
 * `+ New` is a utility below the destinations, and its behaviour is driven end to end against the
 * production bundle rather than asserted against a menu component that no longer exists.
 */
import { describe, expect, it } from "vitest";
import { NAV, NEVER_NAV } from "./nav.js";

describe("the shell's destinations", () => {
  it("is three, and neither Ask nor Jobs is one of them (D-074)", () => {
    expect(NAV.map((n) => n.label)).toEqual(["Today", "Work", "Automations"]);
    expect(NAV).toHaveLength(3);
    // Both returned to NEVER_NAV with D-074. Not because either is unimportant: Ask is persistent
    // and therefore never somewhere to go, and a run reaches a person through Activity, with
    // anything needing a decision already in Work. The insurance-module tree stays banned too.
    expect(NEVER_NAV).toContain("Jobs");
    expect(NEVER_NAV).toContain("Ask ASAP");
    expect(NEVER_NAV).toContain("Spaces");
  });
});
