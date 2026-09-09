import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInRouter } from "../test-utils.js";

const meState = { data: undefined as unknown, isPending: false, isSuccess: true, isError: false };
vi.mock("./me.js", () => ({
  useMe: () => meState,
  useInvalidateMe: () => () => Promise.resolve(),
}));
const setActiveOrganization = vi.fn((_id: string) => Promise.resolve());
vi.mock("./auth.js", () => ({ useAuth: () => ({ session: null, loading: false }) }));
vi.mock("./api.js", () => ({
  api: { setActiveOrganization: (id: string) => setActiveOrganization(id) },
  describeApiError: () => "error",
}));
const { RequireMembership } = await import("./guards.js");

const org = (id: string, name: string) => ({
  organization: { id, name, country: "KE", currency: "KES", timezone: "Africa/Nairobi" },
  role: {
    id: "r",
    key: "brokerage_admin",
    name: "Brokerage administrator",
    description: null,
    is_system: true,
  },
  id: `m-${id}`,
  is_owner: true,
  status: "active",
  joined_at: "2026-01-01T00:00:00Z",
});
const user = { id: "u", email: "a@b.test", full_name: "A", display_name: null };
const A = "10000000-0000-4000-8000-00000000000a";
const B = "10000000-0000-4000-8000-00000000000b";

function mount() {
  return renderInRouter(
    <QueryClientProvider client={new QueryClient()}>
      <RequireMembership />
    </QueryClientProvider>,
    "/today",
  );
}

/** D-055: the three membership counts on sign-in. */
describe("RequireMembership", () => {
  it("zero memberships goes to create-or-join", async () => {
    meState.data = { user, memberships: [], active_organization: null, permissions: [] };
    const { router } = await mount();
    await waitFor(() => expect(router.state.location.pathname).toBe("/onboarding"));
  });

  it("exactly one membership, already active from the server, renders the app", async () => {
    const a = org(A, "Acme Insurance Brokers");
    meState.data = { user, memberships: [a], active_organization: a.organization, permissions: [] };
    const { router } = await mount();
    expect(router.state.location.pathname).toBe("/today");
    expect(screen.queryByText(/Which brokerage/)).toBeNull();
  });

  it("more than one membership and none chosen opens the chooser; choosing calls the API", async () => {
    meState.data = {
      user,
      memberships: [org(A, "Acme Insurance Brokers"), org(B, "Beta Risk Partners")],
      active_organization: null,
      permissions: [],
    };
    await mount();
    expect(screen.getByText("Which brokerage are you working in?")).toBeInTheDocument();
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Acme Insurance BrokersBrokerage administrator",
      "Beta Risk PartnersBrokerage administrator",
    ]);
    fireEvent.click(buttons[1]!);
    await waitFor(() => expect(setActiveOrganization).toHaveBeenCalledWith(B));
  });
});
