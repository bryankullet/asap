import { describe, expect, it } from "vitest";
import { classifyAuthError, networkMessage } from "./auth-errors.js";

describe("classifyAuthError — no answer is never a wrong password", () => {
  it("a fetch that never got an answer is a network failure, naming the host and a UTC time", () => {
    const f = classifyAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 });
    expect(f).toMatchObject({ kind: "network" });
    expect(f && "at" in f && f.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
  it("a thrown TypeError with no status is a network failure too", () => {
    expect(classifyAuthError({ name: "TypeError", message: "Failed to fetch" })?.kind).toBe("network");
  });
  it("Supabase's own refusal of a password is credentials — the only case that says 'do not match'", () => {
    expect(classifyAuthError({ name: "AuthApiError", message: "Invalid login credentials", status: 400, code: "invalid_credentials" })?.kind).toBe("credentials");
  });
  it("unconfirmed and already-registered are their own answers", () => {
    expect(classifyAuthError({ message: "Email not confirmed", status: 400, code: "email_not_confirmed" })?.kind).toBe("unconfirmed");
    expect(classifyAuthError({ message: "User already registered", status: 422, code: "user_already_exists" })?.kind).toBe("already_registered");
  });
  it("the network message says nothing about the account was checked, and what the probe found", () => {
    const f = { host: "x.supabase.co", at: "2026-10-02T16:00:00Z" };
    expect(networkMessage(f, "unreachable")).toMatch(/cannot reach .* at all — no answer at 2026-10-02T16:00:00Z UTC\. Nothing about your account was checked/);
    expect(networkMessage(f, "reachable")).toMatch(/although x\.supabase\.co is reachable/);
  });
});
