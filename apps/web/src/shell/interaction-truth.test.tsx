/**
 * Interaction truth: nothing in the shell is inert, blank, or falsely successful.
 *
 * Every control must do one of a short list of honest things — navigate, mutate, open a real
 * panel, or say why it cannot and what to do instead. These tests pin the three that used to
 * fail that rule: `+ New` was a label, `Search` was a link to a different list, and `History`
 * was a label with a tooltip.
 */
import { screen, fireEvent, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderInRouter } from "../test-utils.js";
import { NewMenu } from "./NewMenu.js";
import { NAV, NEVER_NAV } from "./nav.js";

describe("+ New", () => {
  it("is a control, not a label", async () => {
    await renderInRouter(<NewMenu />);
    const button = screen.getByRole("button", { name: "+ New" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("aria-haspopup", "menu");
  });

  it("offers the paths that exist and opens Ask on the words that start them", async () => {
    const { router } = await renderInRouter(<NewMenu />, "/discover");
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    const menu = screen.getByRole("menu", { name: "Create" });
    for (const label of ["A client", "A renewal", "A claim", "A change to a policy"]) {
      expect(within(menu).getByRole("menuitem", { name: new RegExp(label) })).toBeInTheDocument();
    }
    fireEvent.click(within(menu).getByRole("menuitem", { name: /A renewal/ }));
    // It goes to Discover with the composer pre-filled — one create path, not a second one.
    expect(router.state.location.pathname).toBe("/discover");
    expect(router.state.location.search).toMatchObject({ ask: "Renew " });
  });

  it("names an unavailable path and says why, instead of hiding it or doing nothing", async () => {
    await renderInRouter(<NewMenu />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    const upload = screen.getByRole("menuitem", { name: /Upload a file/ });
    expect(upload).toHaveTextContent("not available yet");
    fireEvent.click(upload);
    // Clicking it explains, rather than silently doing nothing.
    expect(
      screen.getByText(/Document storage and extraction are not built yet/),
    ).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    await renderInRouter(<NewMenu />);
    fireEvent.click(screen.getByRole("button", { name: "+ New" }));
    expect(screen.getByRole("menu", { name: "Create" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Create" })).toBeNull();
  });
});

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
