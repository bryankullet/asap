import { describe, expect, it } from "vitest";
import { mapDatabaseError } from "../src/errors.js";
import { generateInvitationToken, hashInvitationToken } from "../src/tokens.js";

describe("invitation tokens", () => {
  it("generates 43-char base64url tokens that hash to 64 hex chars", () => {
    const t = generateInvitationToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashInvitationToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(generateInvitationToken()).not.toBe(t);
  });
  it("hashes deterministically", () => {
    expect(hashInvitationToken("x")).toBe(hashInvitationToken("x"));
  });
});

describe("mapDatabaseError", () => {
  it("maps the 0014 error tokens to HTTP statuses", () => {
    expect(mapDatabaseError({ code: "28000", message: "not_authenticated" }).status).toBe(401);
    expect(mapDatabaseError({ code: "42501", message: "not_a_member" })).toMatchObject({
      status: 403,
      code: "not_a_member",
    });
    expect(mapDatabaseError({ code: "P0002", message: "not_found" }).status).toBe(404);
    expect(mapDatabaseError({ code: "23505", message: "already_a_member" })).toMatchObject({
      status: 409,
      code: "already_a_member",
    });
    expect(mapDatabaseError({ code: "22023", message: "invitation_expired" })).toMatchObject({
      status: 422,
      code: "invitation_expired",
    });
    expect(mapDatabaseError({ code: "XX000", message: "anything" })).toMatchObject({
      status: 500,
      code: "database_error",
    });
  });
});
