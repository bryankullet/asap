import { z } from "zod";
import { appEnvSchema, nonEmpty, optionalNonEmpty, parseEnv, withHostFallbacks } from "./shared.js";

/** apps/web — only VITE_PUBLIC_* variables. Parsed from import.meta.env. Safe to bundle. */
export const PUBLIC_ENV_PREFIX = "VITE_PUBLIC_" as const;

export const publicEnvSchema = z.object({
  VITE_PUBLIC_SUPABASE_URL: z.string().url(),
  VITE_PUBLIC_SUPABASE_ANON_KEY: nonEmpty,
  VITE_PUBLIC_API_BASE_URL: z.string().url(),
  VITE_PUBLIC_APP_ENV: appEnvSchema,
  VITE_PUBLIC_SENTRY_DSN: optionalNonEmpty,
  VITE_PUBLIC_POSTHOG_KEY: optionalNonEmpty,
  VITE_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function loadPublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  return parseEnv(
    publicEnvSchema,
    withHostFallbacks(raw, [["VITE_PUBLIC_API_BASE_URL", "VITE_PUBLIC_API_BASE_HOST"]]),
    "apps/web",
  );
}
