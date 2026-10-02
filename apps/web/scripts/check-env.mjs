#!/usr/bin/env node
/**
 * Build-time environment gate.
 *
 * `apps/web/src/env.ts` validates the public environment at *module load*, which means a missing
 * variable throws in the browser before React mounts — a white page with an error only the console
 * shows. Vite does not fail a build for an absent `VITE_PUBLIC_*`; it bakes `undefined` and exits
 * zero. That combination shipped a blank production site from a green build.
 *
 * So the same schema runs here, before Vite does. A deploy missing a variable now fails loudly at
 * build time, where somebody is watching, instead of silently at load time, where nobody is.
 */
import { loadPublicEnv } from "@asap/schema";

// Vite reads .env files from envDir (the repo root). Mirror that here so a local build with a
// .env.local behaves the same as `pnpm build` does, rather than failing only in this script.
const { loadEnv } = await import("vite");
const fileEnv = loadEnv(process.env.NODE_ENV ?? "production", new URL("../../..", import.meta.url).pathname, "VITE_PUBLIC_");

let parsed;
try {
  parsed = loadPublicEnv({ ...fileEnv, ...process.env });
} catch (err) {
  console.error("\ncheck-env: the web build has no usable public environment.\n");
  console.error(err instanceof Error ? err.message : String(err));
  console.error(
    "\nSet these on the asap-web service (Render dashboard → Environment), then redeploy.\n" +
      "Building without them produces a blank page: env.ts throws before React mounts.\n",
  );
  process.exit(1);
}
console.log("check-env: ok — every required VITE_PUBLIC_* is present");
console.log(`check-env: ${describeSupabase(parsed.VITE_PUBLIC_SUPABASE_URL, parsed.VITE_PUBLIC_SUPABASE_ANON_KEY)}`);

/**
 * Which Supabase project this bundle talks to: the URL's host and project ref, and the project ref
 * the anon key itself claims. The key is a public JWT, but only its `ref` and `role` claims are
 * printed — never the key. A mismatch, localhost or a placeholder host fails the build here.
 */
function describeSupabase(url, key) {
  const host = new URL(url).hostname;
  const urlRef = host.endsWith(".supabase.co") ? host.split(".")[0] : null;
  let keyRef = null;
  let role = null;
  try {
    const claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
    keyRef = claims.ref ?? null;
    role = claims.role ?? null;
  } catch {
    // New-style publishable keys (sb_publishable_…) are not JWTs and carry no ref.
  }
  const problems = [];
  if (/localhost|127\.0\.0\.1|\.invalid$|example/.test(host)) problems.push(`host ${host} is not a hosted project`);
  if (urlRef && keyRef && urlRef !== keyRef) problems.push(`the anon key belongs to project ${keyRef}, not ${urlRef}`);
  if (role && role !== "anon") problems.push(`the browser key has role ${role}, not anon`);
  if (problems.length) {
    console.error(`\ncheck-env: Supabase configuration is wrong: ${problems.join("; ")}\n`);
    process.exit(1);
  }
  return `supabase host=${host} ref=${urlRef ?? "n/a"} key_ref=${keyRef ?? "n/a"} key_role=${role ?? "n/a"}`;
}
