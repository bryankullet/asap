import { createWorkerDb } from "@asap/db";
import { loadWorkerEnv } from "@asap/schema/env/worker";
import { createLogger } from "./logger.js";

// Fails immediately, naming the variable, if the environment is incomplete.
const env = loadWorkerEnv();
const logger = createLogger(env.LOG_LEVEL, env.APP_ENV === "local");

const db = createWorkerDb(env.WORKER_DATABASE_URL);

/**
 * Phase 1 work items 1–3 ship the skeleton only. The event dispatcher and the audit-echo
 * consumer arrive with work item 8; queue consumers register here.
 */
logger.info({ app_env: env.APP_ENV }, "workers started; no consumers registered yet");

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  await db.$client.end({ timeout: 5 });
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}
