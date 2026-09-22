/**
 * Encryption for stored mailbox tokens.
 *
 * A refresh token is standing access to a brokerage's entire mailbox. These lock the properties
 * that make storing one acceptable at all: it is unreadable at rest, it is unreadable with the
 * wrong key, and a tampered value fails rather than decrypting into something plausible.
 */
import { describe, expect, it } from "vitest";
import {
  decryptToken,
  encryptToken,
  hashOAuthState,
  newOAuthState,
  sameDigest,
} from "../src/mailbox/crypto.js";

const KEY = "a-test-encryption-key-of-at-least-32-chars";
const OTHER = "a-different-key-also-at-least-32-characters";

describe("token encryption", () => {
  it("round-trips", () => {
    expect(decryptToken(encryptToken("1//refresh-token-value", KEY), KEY)).toBe(
      "1//refresh-token-value",
    );
  });

  it("stores nothing a reader could use", () => {
    const stored = encryptToken("1//refresh-token-value", KEY);
    expect(stored).not.toContain("refresh-token-value");
    expect(stored.startsWith("v1.")).toBe(true);
  });

  it("gives a different ciphertext every time, so two identical tokens do not look identical", () => {
    expect(encryptToken("same", KEY)).not.toBe(encryptToken("same", KEY));
  });

  it("cannot be read with the wrong key", () => {
    expect(decryptToken(encryptToken("secret", KEY), OTHER)).toBeNull();
  });

  it("refuses a tampered value rather than returning rubbish", () => {
    const stored = encryptToken("secret", KEY);
    const parts = stored.split(".");
    // One flipped character in the ciphertext. GCM's tag is what catches it.
    const body = parts[3]!;
    parts[3] = (body[0] === "A" ? "B" : "A") + body.slice(1);
    expect(decryptToken(parts.join("."), KEY)).toBeNull();
  });

  it("refuses a value that is not one of ours", () => {
    expect(decryptToken("not-encrypted-at-all", KEY)).toBeNull();
    expect(decryptToken("v2.a.b.c", KEY)).toBeNull();
  });
});

describe("the OAuth state", () => {
  it("is long, random, and stored only as a digest", () => {
    const a = newOAuthState();
    const b = newOAuthState();
    expect(a.value).not.toBe(b.value);
    expect(a.value.length).toBeGreaterThanOrEqual(32);
    expect(a.hash).toBe(hashOAuthState(a.value));
    expect(a.hash).not.toContain(a.value);
  });

  it("compares digests without leaking where they diverged", () => {
    const a = newOAuthState();
    expect(sameDigest(a.hash, hashOAuthState(a.value))).toBe(true);
    expect(sameDigest(a.hash, hashOAuthState("something else"))).toBe(false);
    // A different length is simply not equal, rather than an exception.
    expect(sameDigest(a.hash, "short")).toBe(false);
  });
});
