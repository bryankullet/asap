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
  VITE_PUBLIC_RENEWAL_SPACE: z.enum(["on", "off"]).default("off"),
  /**
   * Demo mode (D-064). "on" seeds the approved fictional brokerage, makes Ask answerable without a
   * model, and shows the presenter bar. Every surface it touches is labelled as demonstration data.
   *
   * It never appears in production: the presenter controls are gated on it, and a simulated send
   * says so on its face rather than claiming a provider delivered anything.
   */
  VITE_PUBLIC_DEMO_MODE: z.enum(["on", "off"]).default("off"),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

/**
 * Inert stand-ins for the three production variables, used only when demo mode is on.
 *
 * The public demonstration has no Supabase project and no API: it never signs anybody in and never
 * makes a request (D-065). Requiring the variables anyway meant a public demo could only be
 * deployed by giving it credentials it must not use, and a missing one failed the build or threw
 * before React mounted — which is exactly the blank page this rule exists to prevent.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so if some surface ever did try to
 * call out in demo mode it fails loudly here rather than reaching a real project by accident.
 */
const DEMO_PLACEHOLDERS: Record<string, string> = {
  VITE_PUBLIC_SUPABASE_URL: "https://demo-mode.invalid",
  VITE_PUBLIC_SUPABASE_ANON_KEY: "demo-mode-has-no-session",
  VITE_PUBLIC_API_BASE_URL: "https://demo-mode.invalid",
};

export function loadPublicEnv(raw: Record<string, string | undefined>): PublicEnv {
  const withFallbacks = withHostFallbacks(raw, [
    ["VITE_PUBLIC_API_BASE_URL", "VITE_PUBLIC_API_BASE_HOST"],
  ]);
  const source =
    withFallbacks["VITE_PUBLIC_DEMO_MODE"] === "on"
      ? { ...DEMO_PLACEHOLDERS, ...stripEmpty(withFallbacks) }
      : withFallbacks;
  return parseEnv(publicEnvSchema, source, "apps/web");
}

/**
 * An empty string is a variable somebody left blank in a dashboard, not a value, so it must not
 * win over a demo placeholder.
 *
 * `import.meta.env` is not all strings — Vite puts `DEV`, `PROD` and `SSR` booleans in it — so
 * anything that is not a string is passed through untouched rather than trimmed.
 */
function stripEmpty(raw: Record<string, string | undefined>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(raw).filter(
      ([, v]) => v !== undefined && (typeof v !== "string" || v.trim() !== ""),
    ),
  );
}
