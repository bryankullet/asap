import { z } from "zod";
import {
  encryptionKey,
  envBoolean,
  monitoringShape,
  nonEmpty,
  optionalNonEmpty,
  parseEnv,
  postgresUrl,
  requireInDeployedEnvironments,
  runtimeShape,
  withHostFallbacks,
} from "./shared.js";

/**
 * apps/api environment. Import from "@asap/schema/env/server" only — never from the root index,
 * which is what apps/web bundles. Even the variable *names* here would fail the web bundle
 * check, and that is intended (docs/DECISIONS.md D-016).
 */
export const serverEnvSchema = z
  .object({
    ...runtimeShape,
    API_PORT: z.coerce.number().int().positive().max(65535).default(8787),
    API_BASE_URL: z.string().url(),
    WEB_BASE_URL: z.string().url(),

    SUPABASE_URL: z.string().url(),
    SUPABASE_ANON_KEY: nonEmpty,
    SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
    SUPABASE_JWT_SECRET: nonEmpty,
    SUPABASE_PROJECT_REF: optionalNonEmpty,

    DATABASE_URL: postgresUrl,

    STORAGE_BUCKET: nonEmpty.default("insurance-documents"),
    // Capped in the schema, not left to a .env value: a long-lived signed URL to a client's
    // policy schedule is a data leak with a timer on it.
    SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().max(3600).default(300),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(52_428_800),

    ENCRYPTION_KEY: encryptionKey,
    /**
     * Sent as `x-asap-api-key` on every database call the API makes; migration 0023's engine
     * functions refuse writes without it. The API registers its hash itself on boot (0025).
     */
    API_INTERNAL_KEY: z.string().min(32),
    INVITATION_TOKEN_TTL_HOURS: z.coerce
      .number()
      .int()
      .positive()
      .max(24 * 30)
      .default(168),
    SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(480),
    /** D-005: never below 12. Mirrors supabase/config.toml auth.minimum_password_length. */
    PASSWORD_MIN_LENGTH: z.coerce.number().int().min(12).default(12),

    /** Resend, platform transactional mail only. Absent → email disabled with a startup log line (D-046). */
    RESEND_API_KEY: optionalNonEmpty,
    RESEND_FROM_EMAIL: z.string().email().optional(),

    ...monitoringShape,

    // Phase 2+ — optional until their phase.
    GOOGLE_OAUTH_CLIENT_ID: optionalNonEmpty,
    GOOGLE_OAUTH_CLIENT_SECRET: optionalNonEmpty,
    GOOGLE_OAUTH_REDIRECT_URI: optionalNonEmpty,
    MICROSOFT_OAUTH_CLIENT_ID: optionalNonEmpty,
    MICROSOFT_OAUTH_CLIENT_SECRET: optionalNonEmpty,
    MICROSOFT_OAUTH_TENANT_ID: optionalNonEmpty,
    MICROSOFT_OAUTH_REDIRECT_URI: optionalNonEmpty,
    EXTRACTOR_URL: optionalNonEmpty,
    EXTRACTOR_SHARED_SECRET: optionalNonEmpty,
    /**
     * Which adapter serves Ask. `openai` is the first production adapter; `anthropic` is a
     * drop-in; `fake` is deterministic and is what tests and the evaluation set run against.
     * Server-side only — the browser never learns which provider or model is configured.
     */
    AI_DEFAULT_PROVIDER: z.enum(["openai", "anthropic", "fake"]).default("openai"),
    /** The exact model. Configuration, never a constant in code, so it moves without a deploy. */
    AI_MODEL: optionalNonEmpty,
    AI_FAST_MODEL: optionalNonEmpty,
    AI_FRONTIER_MODEL: optionalNonEmpty,
    AI_EMBEDDING_PROVIDER: optionalNonEmpty,
    AI_EMBEDDING_MODEL: optionalNonEmpty,
    AI_MAX_TOKENS: z.coerce.number().int().positive().default(4096),
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    ANTHROPIC_API_KEY: optionalNonEmpty,
    OPENAI_API_KEY: optionalNonEmpty,

    FEATURE_AI_ENABLED: envBoolean.default(false),
    FEATURE_AUTOMATIONS_ENABLED: envBoolean.default(false),
    FEATURE_EXTERNAL_SEND_ENABLED: envBoolean.default(false),
  })
  // Email and Sentry are optional everywhere (D-046): absence disables the feature at boot with a
  // log line. What stays required in deployed environments is what the API cannot run without.
  .superRefine(requireInDeployedEnvironments([]))
  .refine((v) => (v.RESEND_API_KEY === undefined) === (v.RESEND_FROM_EMAIL === undefined), {
    message: "RESEND_API_KEY and RESEND_FROM_EMAIL must be set together",
    path: ["RESEND_FROM_EMAIL"],
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function loadServerEnv(raw: Record<string, string | undefined> = process.env): ServerEnv {
  return parseEnv(
    serverEnvSchema,
    withHostFallbacks(raw, [
      ["API_BASE_URL", "API_BASE_HOST"],
      ["WEB_BASE_URL", "WEB_BASE_HOST"],
    ]),
    "apps/api",
  );
}
