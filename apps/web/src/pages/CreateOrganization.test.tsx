import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderInRouter } from "../test-utils.js";

const createOrganization = vi.fn();
vi.mock("../lib/api.js", () => ({
  api: { createOrganization: (input: unknown) => createOrganization(input) },
  describeApiError: () => "error",
}));

const { CreateOrganization } = await import("./CreateOrganization.js");

/** The first live click-through created two brokerages from one form. This is the guard. */
describe("CreateOrganization double submit", () => {
  it("sends one request key, ignores a second submit while pending, and navigates on success", async () => {
    let resolve!: (v: { organization_id: string }) => void;
    createOrganization.mockReturnValue(new Promise((r) => (resolve = r)));
    const qc = new QueryClient();
    const { router } = await renderInRouter(
      <QueryClientProvider client={qc}>
        <CreateOrganization />
      </QueryClientProvider>,
      "/onboarding/create",
    );
    fireEvent.input(screen.getByLabelText("Brokerage name"), { target: { value: "Gamma Cover" } });
    fireEvent.click(screen.getByRole("checkbox"));
    const button = screen.getByRole("button", { name: "Create brokerage" });
    fireEvent.click(button);
    await waitFor(() => expect(createOrganization).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    fireEvent.submit(button.closest("form")!);
    fireEvent.submit(button.closest("form")!);
    await new Promise((r) => setTimeout(r, 20));
    expect(createOrganization).toHaveBeenCalledTimes(1);
    const sent = createOrganization.mock.calls[0]![0] as { request_key: string };
    expect(sent.request_key).toMatch(/^[0-9a-f-]{36}$/);

    resolve({ organization_id: "40000000-0000-4000-8000-000000000001" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/today"));
  });
});
