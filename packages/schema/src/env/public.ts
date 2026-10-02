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
  /**
   * The first Renewal Space, behind a flag (D-058: capabilities move into the Space system one at
   * a time). "on" renders a renewal through the registry; anything else, including absent, keeps
   * the existing record page. The old renderer stays in place either way, so this is the rollback.
   */
  /**
   * Same-origin path the static site proxies to Supabase (render.yaml `/sb/*` rewrite), e.g. "/sb".
   * Set, the browser talks only to the app's own host — for browsers whose network reaches the app
   * but drops *.supabase.co. Absent, the browser calls VITE_PUBLIC_SUPABASE_URL directly.
   */
  VITE_PUBLIC_SUPABASE_PROXY_PATH: z.string().regex(/^\/[A-Za-z0-9_-]+$/).optional(),
  VITE_PUBLIC_RENEWAL_SPACE: z.enum(["on", "off"]).default("off"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function loadPublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  const withFallbacks = withHostFallbacks(raw, [
    ["VITE_PUBLIC_API_BASE_URL", "VITE_PUBLIC_API_BASE_HOST"],
  ]);
  return parseEnv(publicEnvSchema, withFallbacks, "apps/web");
}
