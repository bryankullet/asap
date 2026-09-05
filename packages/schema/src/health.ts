import { z } from "zod";

/**
 * GET /health response. apps/web imports the derived type, so an incompatible
 * change here fails the web build rather than surfacing at runtime.
 */
export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string().min(1),
  commit: z.string().min(1),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
