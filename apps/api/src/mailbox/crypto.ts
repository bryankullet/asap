import { createCipheriv, createDecipheriv, randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";

/**
 * Encryption for stored OAuth tokens.
 *
 * A brokerage's refresh token is standing access to its entire mailbox. It is written to the
 * database as ciphertext, decrypted only in the server process that is about to call the
 * provider, and never returned in a response, written to a log or copied into an audit payload
 * (docs/SECRETS.md).
 *
 * AES-256-GCM: authenticated, so a tampered ciphertext fails to decrypt rather than producing
 * plausible rubbish. The cipher key is derived from `ENCRYPTION_KEY` with scrypt. The salt is a
 * fixed application constant rather than a random per-value salt on purpose — the key must be
 * derivable from the environment alone, and the per-value randomness that matters for GCM is the
 * IV, which is fresh for every encryption.
 *
 * The stored form is `v1.<iv>.<tag>.<ciphertext>`, all base64url. The version prefix is what makes
 * a future re-encryption migration possible without guessing at what an old value is.
 */

const SALT = "asap.mailbox.tokens.v1";
const VERSION = "v1";

/** Derived once per process: scrypt is deliberately slow, and this runs on every provider call. */
const keyCache = new Map<string, Buffer>();
function cipherKey(secret: string): Buffer {
  const cached = keyCache.get(secret);
  if (cached) return cached;
  const derived = scryptSync(secret, SALT, 32);
  keyCache.set(secret, derived);
  return derived;
}

export function encryptToken(plaintext: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cipherKey(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    body.toString("base64url"),
  ].join(".");
}

/**
 * Returns null rather than throwing when a value cannot be read.
 *
 * A token encrypted under a rotated key, or a truncated one, means the mailbox needs a person to
 * reconnect it — which is a state the product already has. Throwing here would turn that into a
 * 500 on a screen that should be saying "connect it again".
 */
export function decryptToken(stored: string, secret: string): string | null {
  const parts = stored.split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(parts[1]!, "base64url");
    const tag = Buffer.from(parts[2]!, "base64url");
    const body = Buffer.from(parts[3]!, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", cipherKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * The OAuth `state` parameter.
 *
 * Generated here, stored as a digest, and compared against what the provider hands back. Storing
 * the digest rather than the value means a database reader cannot mint a callback that passes
 * validation, which is the same reasoning as a password hash.
 */
export function newOAuthState(): { value: string; hash: string } {
  const value = randomBytes(32).toString("base64url");
  return { value, hash: hashOAuthState(value) };
}

export function hashOAuthState(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Constant-time comparison for two digests of the same length. */
export function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
