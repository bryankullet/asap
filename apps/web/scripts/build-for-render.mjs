#!/usr/bin/env node
/**
 * Production deployment adapter for Render's existing asap-web static service.
 *
 * Render currently invokes "@asap/web... build" and publishes apps/web/dist. Keep
 * those configured paths intact while allowing the owner to switch the published
 * frontend using ASAP_FRONTEND=next, ASAP_FRONTEND=prototype (the static
 * "hire an assistant" prototype in apps/prototype), or legacy for immediate rollback.
 *
 * This is a build-time switch only; it never becomes a browser environment value.
 * The new frontend remains independent of apps/web source and renderer modules.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const oldWebRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(oldWebRoot, "../..");
const choice = process.env.ASAP_FRONTEND || "legacy";

if (!["legacy", "next", "prototype"].includes(choice)) {
  throw new Error(`Unknown ASAP_FRONTEND=${choice}; expected "legacy", "next" or "prototype".`);
}

if (choice === "prototype") {
  // Static prototype: one HTML page plus voice lines, portraits and sample files.
  // No build step and no environment values; it talks to no ASAP backend.
  console.log("ASAP production build: static prototype");
  const source = resolve(repoRoot, "apps/prototype");
  const publish = resolve(repoRoot, "apps/web/dist");
  rmSync(publish, { recursive: true, force: true });
  mkdirSync(publish, { recursive: true });
  cpSync(source, publish, { recursive: true, filter: (src) => !src.endsWith("README.md") });
  console.log("ASAP production build: prototype published to apps/web/dist");
} else if (choice === "legacy") {
  console.log("ASAP production build: legacy frontend");
  execFileSync("node", ["scripts/check-env.mjs"], { cwd: oldWebRoot, stdio: "inherit" });
  execFileSync("tsc", ["-p", "tsconfig.json", "--noEmit"], { cwd: oldWebRoot, stdio: "inherit" });
  execFileSync("vite", ["build"], { cwd: oldWebRoot, stdio: "inherit" });
  execFileSync("node", ["scripts/check-bundle.mjs"], { cwd: oldWebRoot, stdio: "inherit" });
} else {
  console.log("ASAP production build: progressive Living Interface");
  // Keep the production environment gate as it already checks the public
  // Supabase/API variables and catches a mismatched hosted Supabase project.
  execFileSync("node", ["scripts/check-env.mjs"], { cwd: oldWebRoot, stdio: "inherit" });
  // Build and check the *new* independent application with the lockfile.
  execFileSync("pnpm", ["--filter", "@asap/web-next...", "build"], { cwd: repoRoot, stdio: "inherit" });
  const source = resolve(repoRoot, "apps/web-next/dist");
  const publish = resolve(repoRoot, "apps/web/dist");
  rmSync(publish, { recursive: true, force: true });
  mkdirSync(publish, { recursive: true });
  cpSync(source, publish, { recursive: true });
  console.log("ASAP production build: progressive bundle published to apps/web/dist");
}
