import { z } from "zod";
import {
  encryptionKey,
  monitoringShape,
  parseEnv,
  postgresUrl,
  runtimeShape,
  sentryDsn,
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
    /**
     * Optional, including in staging and production.
     *
     * It was required once APP_ENV left `local`, on the reasoning that a background worker whose
     * failures nobody sees is worse than no worker. That reasoning still holds, but it was buying
     * the wrong thing: the worker refused to start, which is a louder failure than the one it was
     * guarding against, and its errors go to the platform log either way.
     *
     * So the DSN is optional and the worker says at startup which of the two is happening. What
     * is *not* optional is the shape: a DSN that is present and malformed is refused, because a
     * truncated copy-paste that reports nowhere is the one outcome nobody would notice.
     */
    SENTRY_DSN: sentryDsn,
  });

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(raw: Record<string, string | undefined> = process.env): WorkerEnv {
  return parseEnv(workerEnvSchema, raw, "apps/workers");
}
