import { z } from "zod";
import {
  encryptionKey,
  monitoringShape,
  parseEnv,
  postgresUrl,
  requireInDeployedEnvironments,
  runtimeShape,
} from "./shared.js";

/**
 * apps/workers environment — deliberately narrower than the API. No service-role key and no
 * provider keys: workers call the gateway, and read tenant data as asap_worker under RLS.
 * Import from "@asap/schema/env/worker".
 */
export const workerEnvSchema = z
  .object({
    ...runtimeShape,
    WORKER_DATABASE_URL: postgresUrl.refine((u) => !/\/\/postgres[:@]/.test(u), {
      message:
        "workers must connect as asap_worker, not postgres; the worker role does not bypass RLS",
    }),
    ENCRYPTION_KEY: encryptionKey,
    /**
     * The API, and the secret it answers to.
     *
     * Workers schedule; the API is the engine. A worker needs no service key for that — it needs
     * somewhere to send the work and a secret proving it is not a browser.
     */
    API_BASE_URL: z.string().url(),
    API_INTERNAL_KEY: z.string().min(16),
    /** How often the dispatcher looks for events nobody has handled. */
    EVENT_POLL_MS: z.coerce.number().int().min(250).max(60_000).default(2_000),
    ...monitoringShape,
  })
  .superRefine(requireInDeployedEnvironments(["SENTRY_DSN"]));

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(raw: Record<string, string | undefined> = process.env): WorkerEnv {
  return parseEnv(workerEnvSchema, raw, "apps/workers");
}
