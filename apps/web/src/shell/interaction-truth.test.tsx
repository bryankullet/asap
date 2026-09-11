/**
 * Interaction truth: nothing in the shell is inert, blank, or falsely successful.
 *
 * Every control must do one of a short list of honest things — navigate, mutate, open a real
 * panel, or say why it cannot and what to do instead.
 *
 * `+ New` became its own destination with D-064, so its behaviour is driven end to end against the
 * production bundle rather than asserted against a menu component that no longer exists.
 */
import { describe, expect, it } from "vitest";
import { NAV, NEVER_NAV } from "./nav.js";

describe("the shell's destinations", () => {
  it("is the approved five, and Jobs is one of them (D-064)", () => {
    expect(NAV.map((n) => n.label)).toEqual([
      "Discover",
      "Ask ASAP",
      "Work",
      "Jobs",
      "Automations",
    ]);
    expect(NAV).toHaveLength(5);
    // Jobs left NEVER_NAV with D-064: the approved demo gives it a surface, and §45 rule 16 bans
    // insurance modules, which Jobs is not. The module tree is still banned.
    expect(NEVER_NAV).not.toContain("Jobs");
    expect(NEVER_NAV).toContain("Spaces");
  });
});
