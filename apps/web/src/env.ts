import { loadPublicEnv, type PublicEnv } from "@asap/schema";

/**
 * Vite only exposes VITE_PUBLIC_* (see vite.config.ts envPrefix). Parsing happens once here;
 * nothing else reads import.meta.env.
 */
export const env: PublicEnv = loadPublicEnv(import.meta.env as Record<string, string | undefined>);
