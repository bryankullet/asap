import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export type BuildInfo = { version: string; commit: string };

/**
 * Version from package.json; commit from the deploy environment (GIT_COMMIT or GITHUB_SHA),
 * falling back to the local git checkout, then "unknown". Resolved once at startup.
 */
export function resolveBuildInfo(env: {
  GIT_COMMIT?: string | undefined;
  GITHUB_SHA?: string | undefined;
}): BuildInfo {
  const fromEnv = env.GIT_COMMIT ?? env.GITHUB_SHA;
  if (fromEnv) return { version: pkg.version, commit: fromEnv.slice(0, 12) };
  try {
    const out = execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
    return { version: pkg.version, commit: out || "unknown" };
  } catch {
    return { version: pkg.version, commit: "unknown" };
  }
}
