import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { NewSheet, NEW_OPTIONS } from "../shell/NewSheet.js";
import { CREATE_KINDS } from "../live/create-space.js";
import { renderInRouter } from "../test-utils.js";

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

/**
 * Filing a document has to be reachable by clicking.
 *
 * The failure this locks out is the one that actually happened: `/documents` existed as a route,
 * the upload on it worked, and nothing anywhere in the product linked to it. The page was live and
 * unreachable — you had to type the URL. A route that renders is not a feature a person can use,
 * and Documents is deliberately not a sidebar destination (§45 rule 16), so `+ New` is where it
 * belongs.
 *
 * `+ New` is a sheet now rather than a page of six forms, so these assert the same things against
 * the sheet: the option exists, it leads to the place that owns filing, and choosing it neither
 * asks for a client nor creates anything.
 */
describe("+ New offers filing a document", () => {
  it("lists it as a kind of thing you can start", async () => {
    await renderInRouter(<NewSheet onClose={() => {}} />, "/today");
    expect(screen.getByRole("link", { name: /Upload a document/ })).toBeInTheDocument();
  });

  it("leads to the page that owns filing, and says why it asks for no client", async () => {
    await renderInRouter(<NewSheet onClose={() => {}} />, "/today");
    const option = screen.getByRole("link", { name: /Upload a document/ });
    expect(option).toHaveAttribute("href", "/documents");
    // The note says what happens next, and does not promise the document has been read.
    expect(within(option).getByText(/proposes what it says/)).toBeInTheDocument();
    expect(option.textContent).not.toMatch(/\bread it\b|has been read/i);
  });

  it("does not ask for a client, and offers no submit that could open a work item", async () => {
    const { container } = await renderInRouter(<NewSheet onClose={() => {}} />, "/today");
    /*
     * A sheet of choices has no form and no fields: there is nothing here that can create
     * anything, which is what makes it safe to browse.
     */
    expect(screen.queryByLabelText(/WHICH CLIENT/)).toBeNull();
    expect(container.querySelectorAll("form")).toHaveLength(0);
    expect(container.querySelectorAll('button[type="submit"]')).toHaveLength(0);
    expect(container.querySelectorAll("input, textarea, select")).toHaveLength(0);
  });

  it("closes the sheet when a choice is taken, so the Space behind it is not lost", async () => {
    let closed = false;
    await renderInRouter(<NewSheet onClose={() => (closed = true)} />, "/today");
    await userEvent.click(screen.getByRole("link", { name: /Upload a document/ }));
    expect(closed).toBe(true);
  });

  it("still offers the five kinds that open work", async () => {
    await renderInRouter(<NewSheet onClose={() => {}} />, "/today");
    for (const name of [
      /Add a client/,
      /Record existing cover/,
      /Start a renewal/,
      /Register a claim/,
      /Start a policy change/,
    ]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
    // And each of those five has a creation Space behind it.
    expect([...CREATE_KINDS].sort()).toEqual(["claim", "client", "endorsement", "policy", "renewal"]);
  });

  /*
   * The tenth option has no endpoint yet. It is shown disabled with the reason rather than
   * removed: a missing option teaches a person the product cannot do it at all.
   */
  it("shows quotation work disabled, with the reason, rather than hiding it", async () => {
    await renderInRouter(<NewSheet onClose={() => {}} />, "/today");
    const quote = screen.getByRole("button", { name: /Start quotation work/ });
    expect(quote).toBeDisabled();
    expect(quote.textContent).toMatch(/not stored as its own record yet/);
  });

  it("offers all ten paths from the prototype's sheet", () => {
    expect(NEW_OPTIONS.map((o) => o.id)).toEqual([
      "ask",
      "import",
      "document",
      "client",
      "policy",
      "renewal",
      "quote",
      "claim",
      "endorsement",
      "automation",
    ]);
  });
});
