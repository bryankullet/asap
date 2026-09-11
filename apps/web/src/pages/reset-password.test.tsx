import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInRouter } from "../test-utils.js";

/**
 * Forgetting a password (D-068).
 *
 * The rule under test is the one that is easy to break by being helpful: the answer must not
 * depend on whether the address has an account, or the form becomes a way to ask who banks with
 * this brokerage.
 */
const resetPasswordForEmail = vi.fn(async () => ({ error: null }));
const updateUser = vi.fn(async () => ({ error: null }));
const session = { current: null as unknown };

vi.mock("../lib/supabase.js", () => ({
  supabase: { auth: { resetPasswordForEmail: (...a: unknown[]) => resetPasswordForEmail(...(a as [])), updateUser: (...a: unknown[]) => updateUser(...(a as [])) } },
}));
vi.mock("../lib/auth.js", () => ({ useAuth: () => ({ session: session.current, loading: false }) }));

const { ForgotPassword, ResetPassword } = await import("./ResetPassword.js");

afterEach(() => {
  resetPasswordForEmail.mockClear();
  updateUser.mockClear();
  session.current = null;
});

const mount = (ui: React.ReactNode) =>
  renderInRouter(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

describe("asking for a reset link", () => {
  it("says the same thing whether or not the address has an account", async () => {
    await mount(<ForgotPassword />);
    await userEvent.type(screen.getByLabelText("Email"), "someone@example.test");
    await userEvent.click(screen.getByRole("button", { name: /Email me a reset link/ }));
    await waitFor(() => expect(resetPasswordForEmail).toHaveBeenCalled());
    // "If that address has an account" — never "we have sent" or "no such user".
    expect(screen.getByText(/has an account/)).toBeTruthy();
    expect(screen.queryByText(/no account|not found|does not exist/i)).toBeNull();
  });

  it("sends people back to a link they can use, not to an error", async () => {
    resetPasswordForEmail.mockResolvedValueOnce({ error: { message: "User not found" } } as never);
    await mount(<ForgotPassword />);
    await userEvent.type(screen.getByLabelText("Email"), "nobody@example.test");
    await userEvent.click(screen.getByRole("button", { name: /Email me a reset link/ }));
    await waitFor(() => expect(screen.getByText(/has an account/)).toBeTruthy());
  });
});

describe("choosing a new password", () => {
  it("refuses to show the form without the recovery session the link creates", async () => {
    await mount(<ResetPassword />);
    expect(screen.getByText("This link is no longer valid")).toBeTruthy();
    expect(screen.queryByLabelText("New password")).toBeNull();
  });

  it("will not accept two passwords that differ", async () => {
    session.current = { access_token: "recovery" };
    await mount(<ResetPassword />);
    await userEvent.type(screen.getByLabelText("New password"), "correct-horse-battery");
    await userEvent.type(screen.getByLabelText("Again, to be sure"), "correct-horse-stapler");
    await userEvent.click(screen.getByRole("button", { name: /Change my password/ }));
    await waitFor(() => expect(screen.getByText("These two do not match")).toBeTruthy());
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("changes the password when they match", async () => {
    session.current = { access_token: "recovery" };
    await mount(<ResetPassword />);
    await userEvent.type(screen.getByLabelText("New password"), "correct-horse-battery");
    await userEvent.type(screen.getByLabelText("Again, to be sure"), "correct-horse-battery");
    await userEvent.click(screen.getByRole("button", { name: /Change my password/ }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith({ password: "correct-horse-battery" }));
  });
});
