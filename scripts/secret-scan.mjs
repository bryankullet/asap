#!/usr/bin/env node
/**
 * Secret scan over tracked files (work item 2).
 *
 * Fails on anything shaped like a real credential. Patterns are chosen to catch secret
 * *values*, not the words that name them: SECRETS.md must be allowed to say
 * "SUPABASE_SERVICE_ROLE_KEY" without tripping the build. See docs/DECISIONS.md D-012.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  {
    name: "OpenAI/Anthropic-style key",
    re: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/,
  },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  {
    name: "Postmark-style token",
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b(?=.*(?:POSTMARK|SERVER_TOKEN))/i,
  },
  {
    name: "database URL with a real-looking password",
    // allow the documented local defaults and placeholders
    re: /postgres(?:ql)?:\/\/[^:\s/]+:(?!postgres@|CHANGE_ME@|pw@|\$\{?[A-Z_]+|<)[^@\s]{8,}@/,
  },
  {
    name: "service_role key assignment",
    // the *word* is fine in docs; a value assigned to it is not
    re: /service_role["']?\s*[:=]\s*["']?eyJ/i,
  },
  { name: "Supabase secret key", re: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/ },
];

const SKIP = [/^pnpm-lock\.yaml$/, /\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf|pdf|zip)$/i];

// Tracked files plus untracked files that are not ignored, so a scan before the first commit
// still sees the working tree.
const files = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .filter((f) => !SKIP.some((re) => re.test(f)));

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, i) => {
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) hits.push(`${file}:${i + 1}: ${name}`);
    }
  });
}

if (hits.length > 0) {
  console.error("secret-scan: possible secrets in tracked files:");
  for (const h of hits) console.error(`  - ${h}`);
  console.error("Rotate first, investigate second (docs/SECRETS.md).");
  process.exit(1);
}
console.log(`secret-scan: ok (${files.length} files)`);
