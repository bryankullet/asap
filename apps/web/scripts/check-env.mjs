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

try {
  loadPublicEnv({ ...fileEnv, ...process.env });
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
