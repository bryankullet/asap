#!/usr/bin/env node
/**
 * Gives the seeded fixture users a known password through the Supabase Auth admin API, so a
 * person can sign in to staging (or a local stack) with email + password. Part of seeding:
 * run it after supabase/seed.sql has been applied. See docs/staging-users.md and D-052.
 *
 * Staging and local only. Refuses to run unless APP_ENV is exactly "staging" or "local":
 * production is refused by name, and an unset APP_ENV is refused so the script can never be
 * pointed at a project by accident. Staging holds synthetic data only (D-003), which is the
 * reason a documented password is acceptable there and nowhere else.
 *
 * Usage:
 *   APP_ENV=staging SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/seed-set-passwords.mjs
 *   SEED_PASSWORD overrides the documented default (minimum 12 characters, D-005).
 *
 * No SDK: the admin endpoint is one PUT per user, and this script must run from the repo root
 * without a workspace install.
 */
import { readFileSync, existsSync } from "node:fs";

// .env.local is the local convention (scripts/test-rls.sh does the same). Never overrides a
// variable that is already set.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

/** The documented staging password (docs/staging-users.md). Not a secret: staging is synthetic. */
export const DEFAULT_SEED_PASSWORD = "asap-staging-2026";

/** The seven fixture users from supabase/seed.sql, by id. Emails are for the log only. */
export const SEED_USERS = [
  ["a0000000-0000-4000-8000-000000000001", "admin@acme-brokers.test"],
  ["a0000000-0000-4000-8000-000000000002", "ae@acme-brokers.test"],
  ["a0000000-0000-4000-8000-000000000003", "finance@acme-brokers.test"],
  ["b0000000-0000-4000-8000-000000000001", "admin@beta-risk.test"],
  ["b0000000-0000-4000-8000-000000000002", "ae@beta-risk.test"],
  ["b0000000-0000-4000-8000-000000000003", "finance@beta-risk.test"],
  ["c0000000-0000-4000-8000-000000000001", "shared@consultant.test"],
];

const ALLOWED_ENVS = new Set(["staging", "local"]);

function fail(message) {
  console.error(`seed-set-passwords: ${message}`);
  process.exit(1);
}

const appEnv = process.env.APP_ENV;
if (appEnv === "production") fail("refusing to run: APP_ENV is production (D-052)");
if (!ALLOWED_ENVS.has(appEnv ?? "")) {
  fail(`refusing to run: APP_ENV must be "staging" or "local" (got ${JSON.stringify(appEnv)})`);
}

const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) fail("SUPABASE_URL is required");
if (!serviceKey) fail("SUPABASE_SERVICE_ROLE_KEY is required (server-side only, docs/SECRETS.md)");

const password = process.env.SEED_PASSWORD ?? DEFAULT_SEED_PASSWORD;
if (password.length < 12) fail("SEED_PASSWORD must be at least 12 characters (D-005)");

let failures = 0;
for (const [id, email] of SEED_USERS) {
  const res = await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: "PUT",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (res.ok) {
    console.log(`seed-set-passwords: ${email} updated`);
  } else {
    failures += 1;
    // The body names the reason (unknown user, weak password, wrong key); it never contains the password.
    console.error(`seed-set-passwords: ${email} failed: HTTP ${res.status} ${await res.text()}`);
  }
}
if (failures > 0) fail(`${failures} of ${SEED_USERS.length} users not updated`);
console.log(`seed-set-passwords: ${SEED_USERS.length} fixture users updated on ${appEnv}.`);
