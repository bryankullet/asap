/**
 * Ported from the prototype: the nav-order assertion (UI Build Spec v1, Part 0, Part 1.1).
 * The shell has three destinations plus Ask and the Activity chip, in this order:
 *   Today · Work · Automations · Ask · Activity chip
 * No insurance module ever appears in navigation (Architecture v3.1 §45).
 *
 * SKIPPED: the shell is UI Build Spec Phase 1; today `apps/web` carries only the Phase 1 work
 * order screens (sign-in, onboarding, members). Un-skip when `apps/web/src/shell` renders.
 */
import { describe, expect, it } from "vitest";

describe.skip("shell — navigation order (Phase 1: shell not built)", () => {
  it("renders Today, Work, Automations, then Ask, then the Activity chip, in that order", () => {
    // render(<Shell />); const items = screen.getAllByRole("link").map((l) => l.textContent);
    // expect(items.slice(0, 3)).toEqual(["Today", "Work", "Automations"]);
    expect.fail("shell not built");
  });

  it("never renders an insurance module as a destination", () => {
    // for (const banned of ["Clients", "Policies", "Renewals", "Claims", "Money"]) expect(screen.queryByRole("link", { name: banned })).toBeNull();
    expect.fail("shell not built");
  });
});
