import { z } from "zod";

/**
 * Building blocks shared by the three environment schemas (server, worker, public).
 *
 * Rules (.env.example, docs/SECRETS.md):
 * - Nothing outside packages/schema/src/env reads process.env for configuration.
 * - Only what the current phase needs is required. Requiring an unset Phase 5 key in Phase 1
 *   teaches people to paste dummy values, which is how a dummy value reaches production.
 * - A missing required variable throws an error naming the variable, never echoing its value.
 * - Only VITE_PUBLIC_* variables may reach the browser bundle.
 */

export const appEnvSchema = z.enum(["local", "staging", "production"]);
export type AppEnv = z.infer<typeof appEnvSchema>;

/** "true" / "false" strings. z.coerce.boolean() treats "false" as true, so it is not used. */
export const envBoolean = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

export const nonEmpty = z.string().trim().min(1);

export const optionalNonEmpty = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

export const postgresUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith("postgres://") || u.startsWith("postgresql://"), {
    message: "must be a postgres:// or postgresql:// URL",
  });

/** 32 bytes, base64: always 44 characters ending in "=". */
/**
 * At least 32 characters of key material. Nothing derives a cipher key from it yet; when
 * something does, it must run the value through a KDF (sha256 at minimum) rather than use it
 * raw, because Render's generateValue and a 32-byte base64 string are both acceptable here.
 */
export const encryptionKey = z
  .string()
  .min(
    32,
    "at least 32 characters; generate with `openssl rand -base64 32` or let Render generate it",
  );

export const runtimeShape = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_ENV: appEnvSchema,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Build metadata, not configuration. Reported by GET /health. CI sets GITHUB_SHA. */
  GIT_COMMIT: optionalNonEmpty,
  GITHUB_SHA: optionalNonEmpty,
};

export const monitoringShape = {
  SENTRY_DSN: optionalNonEmpty,
  SENTRY_ENVIRONMENT: optionalNonEmpty,
  POSTHOG_API_KEY: optionalNonEmpty,
};

/**
 * Marks variables as required when APP_ENV is staging or production. Since D-046 the list for the
 * API is empty (email and Sentry are optional with a startup log line); the helper stays for
 * workers and future services.
 */
export function requireInDeployedEnvironments<T extends { APP_ENV: AppEnv }>(
  keys: readonly (keyof T & string)[],
) {
  return (value: T, ctx: z.RefinementCtx) => {
    if (value.APP_ENV === "local") return;
    for (const key of keys) {
      if (value[key] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: `required when APP_ENV is ${value.APP_ENV}`,
        });
      }
    }
  };
}

export class EnvValidationError extends Error {
  readonly issues: readonly { variable: string; message: string }[];

  constructor(processName: string, issues: readonly { variable: string; message: string }[]) {
    const lines = issues.map((i) => `  - ${i.variable}: ${i.message}`).join("\n");
    super(
      `[${processName}] environment validation failed. Fix the variables below (see .env.example and docs/SECRETS.md):\n${lines}`,
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Parse a raw environment against a schema. Throws EnvValidationError naming every offending
 * variable. Values are never included in the message — a missing or malformed secret must not
 * be echoed into logs.
 */
/**
 * Render's `fromService` can hand a service another service's hostname, never a URL. When a
 * `*_URL` variable is absent and its `*_HOST` twin is present, the URL is `https://<host>`.
 * Local .env files keep setting the URL directly.
 */
export function withHostFallbacks(
  raw: Record<string, string | undefined>,
  pairs: readonly (readonly [url: string, host: string])[],
): Record<string, string | undefined> {
  const out = { ...raw };
  for (const [url, host] of pairs) {
    if (!out[url] && out[host]) out[url] = `https://${out[host]}`;
  }
  return out;
}

export function parseEnv<S extends z.ZodTypeAny>(
  schema: S,
  raw: Record<string, string | undefined>,
  processName: string,
): z.infer<S> {
  const result = schema.safeParse(raw);
  if (result.success) return result.data as z.infer<S>;
  const issues = result.error.issues.map((issue) => ({
    variable: issue.path.map(String).join(".") || "(root)",
    message:
      issue.code === "invalid_type" && issue.message.includes("undefined")
        ? "missing"
        : issue.message,
  }));
  throw new EnvValidationError(processName, issues);
}
