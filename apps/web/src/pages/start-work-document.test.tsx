import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StartWork } from "./StartWork.js";
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
 */
describe("+ New offers filing a document", () => {
  it("lists it as a kind of thing you can start", async () => {
    await renderInRouter(<StartWork />, "/new");
    expect(screen.getByRole("button", { name: "A document" })).toBeInTheDocument();
  });

  it("leads to the page that owns filing, and says why it asks for no client", async () => {
    await renderInRouter(<StartWork />, "/new");
    await userEvent.click(screen.getByRole("button", { name: "A document" }));

    const go = screen.getByRole("link", { name: "Choose a file to file" });
    expect(go).toHaveAttribute("href", "/documents");
    expect(screen.getByText(/does not need a client first/)).toBeInTheDocument();
  });

  /*
   * Every other kind opens a work item and needs a client to open it against. A document does not,
   * because `documents.client_id` is nullable: a schedule often arrives before anyone has decided
   * which record it is about. So this kind must not render the client form — asking for a client
   * would be asking for something the upload does not use.
   */
  it("does not ask for a client, and offers no submit that could open a work item", async () => {
    await renderInRouter(<StartWork />, "/new");
    await userEvent.click(screen.getByRole("button", { name: "A document" }));

    expect(screen.queryByLabelText(/WHICH CLIENT\?/)).toBeNull();
    expect(screen.queryByLabelText(/WHAT IS THE CLIENT CALLED\?/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Open the work|Add the client|Record the cover/ })).toBeNull();
  });

  it("still offers the five kinds that open work", async () => {
    await renderInRouter(<StartWork />, "/new");
    for (const label of [
      "A client",
      "Cover you already place",
      "A renewal",
      "A claim",
      "A change to a policy",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });
});
