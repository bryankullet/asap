/**
 * The Automations surface.
 *
 * This is the screen a person decides whether to trust automation from, so what it must show is
 * what it will do, that it prepares rather than acts, and what it actually did — including the
 * firings that did nothing, which is the part people need and the part easiest to hide.
 */
import type { Automation, AutomationRun } from "@asap/schema";
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api.js";
import { renderInRouter } from "../test-utils.js";
import { Automations } from "./Automations.js";

afterEach(() => vi.restoreAllMocks());

const automation = (over: Partial<Automation> = {}): Automation =>
  ({
    id: "c1000000-0000-4000-8000-000000000001",
    organization_id: "10000000-0000-4000-8000-00000000000a",
    name: "Record terms when an insurer quotes",
    description: "",
    trigger_event: "quote.received",
    conditions: [{ fact: "kind", operator: "equals", value: "renewal" }],
    skill: "renewal.extract_terms",
    prepared_verb: "record_evidence",
    approval: "always",
    sends_externally: false,
    enabled: true,
    created_by: "a0000000-0000-4000-8000-000000000001",
    created_at: "2026-09-01T09:00:00Z",
    updated_at: "2026-09-01T09:00:00Z",
    ...over,
  }) as Automation;

void ({} as AutomationRun);

describe("Automations", () => {
  it("says what each one does, in words a broker would use", async () => {
    vi.spyOn(api, "automations").mockResolvedValue({ automations: [automation()] });
    await renderInRouter(<Automations />, "/automations");
    await screen.findByText(/When an insurer sends terms/);
    expect(screen.getByText(/record what the other party sent/)).toBeInTheDocument();
  });

  it("says on its face that it prepares rather than acts", async () => {
    vi.spyOn(api, "automations").mockResolvedValue({ automations: [automation()] });
    await renderInRouter(<Automations />, "/automations");
    expect(await screen.findByText(/You approve before anything happens/)).toBeInTheDocument();
  });

  it("offers a real switch, not a label", async () => {
    vi.spyOn(api, "automations").mockResolvedValue({ automations: [automation()] });
    const setEnabled = vi
      .spyOn(api, "setAutomationEnabled")
      .mockResolvedValue({ automation: automation({ enabled: false }) });
    await renderInRouter(<Automations />, "/automations");
    const button = await screen.findByRole("button", { name: "Switch off" });
    button.click();
    await waitFor(() =>
      expect(setEnabled).toHaveBeenCalledWith("c1000000-0000-4000-8000-000000000001", false),
    );
  });

  it("is honestly empty when nothing is switched on, and says why that is safe", async () => {
    vi.spyOn(api, "automations").mockResolvedValue({ automations: [] });
    await renderInRouter(<Automations />, "/automations");
    expect(await screen.findByText(/Nothing is switched on/)).toBeInTheDocument();
  });
});
