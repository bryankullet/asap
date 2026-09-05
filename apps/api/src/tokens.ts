import { createHash, randomBytes } from "node:crypto";

/**
 * Invitation tokens: 32 random bytes as base64url (43 chars). The raw token goes into the email
 * link only; the database stores sha256(token) as hex, so a database leak does not hand out
 * memberships (docs/PHASE-1-SCHEMA.md 0008).
 */
export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
