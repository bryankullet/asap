/**
 * The pin, and the two things it must not become.
 *
 * A personal marker earns a control on the record. It does not earn a destination, and it does not
 * earn a place in the vocabulary of statuses — a person reading the record must not mistake "kept"
 * for something the brokerage has decided.
 */
import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../lib/api.js";
import { NAV } from "../shell/nav.js";
import { renderInRouter } from "../test-utils.js";
import { PinButton, PinList } from "./PinButton.js";

afterEach(() => vi.restoreAllMocks());

const RECORD = "20000000-0000-4000-8000-00000000000a";

describe("pins", () => {
  it("offers to keep a record, and says so once kept", async () => {
    const pins = vi.spyOn(api, "pins").mockResolvedValue({ pins: [] });
    const setPin = vi.spyOn(api, "setPin").mockResolvedValue({ pinned: true });
    await renderInRouter(<PinButton recordId={RECORD} />);

    const button = await screen.findByRole("button", { name: /Keep this/ });
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute("aria-pressed", "false");

    pins.mockResolvedValue({
      pins: [{ workItemId: RECORD, title: "Acme Motors renewal", note: null, createdAt: "2026-09-11T00:00:00Z" }],
    });
    button.click();
    await waitFor(() => expect(setPin).toHaveBeenCalledWith(RECORD, { pinned: true, note: null }));
    await screen.findByRole("button", { name: /Kept/ });
  });

  it("lists what a person kept, linking to the record", async () => {
    vi.spyOn(api, "pins").mockResolvedValue({
      pins: [{ workItemId: RECORD, title: "Acme Motors renewal", note: null, createdAt: "2026-09-11T00:00:00Z" }],
    });
    await renderInRouter(<PinList />);
    const link = await screen.findByRole("link", { name: "Acme Motors renewal" });
    expect(link).toHaveAttribute("href", `/r/${RECORD}`);
  });

  it("shows nothing at all when a person has kept nothing", async () => {
    vi.spyOn(api, "pins").mockResolvedValue({ pins: [] });
    const { container } = await renderInRouter(<PinList />);
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });

  it("is a Work filter, never a destination of its own (D-064)", () => {
    // Pinned became an approved *filter* inside Work. It is still not a destination: what proves
    // that is its absence from NAV, not a word list.
    expect(NAV.map((n) => n.label)).not.toContain("Pinned");
    expect(NAV.map((n) => n.to)).not.toContain("/pinned");
  });
});
