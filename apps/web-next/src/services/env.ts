import { loadPublicEnv, type PublicEnv } from "@asap/schema";

/** Vite exposes VITE_PUBLIC_* only. Parsed once; nothing else reads import.meta.env. */
export const env: PublicEnv = loadPublicEnv(import.meta.env as Record<string, string | undefined>);
