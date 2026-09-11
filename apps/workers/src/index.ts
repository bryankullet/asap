import { createWorkerDb } from "@asap/db";
import { loadWorkerEnv } from "@asap/schema/env/worker";
import { createLogger } from "./logger.js";
import { dispatchPending, httpDispatcher } from "./events/dispatcher.js";

// Fails immediately, naming the variable, if the environment is incomplete.
const env = loadWorkerEnv();
const logger = createLogger(env.LOG_LEVEL, env.APP_ENV === "local");

const db = createWorkerDb(env.WORKER_DATABASE_URL);

/**
 * The worker tier.
 *
 * One consumer so far: the event dispatcher, which claims events nobody has handled, asks the API
 * to run what is waiting for them, and records what each consumer did. Everything it touches is
 * scoped to one organization per transaction — `withOrganization` does that, and a direct query
 * outside it is a bug.
 *
 * It polls rather than listening. A queue would be better and is what the architecture calls for;
 * polling a table that already has the right index is what can be had honestly today, and the
 * shape of the job does not change when the queue arrives — only where `dispatchPending` is
 * called from.
 */
const dispatch = httpDispatcher({
  apiBaseUrl: env.API_BASE_URL,
  internalKey: env.API_INTERNAL_KEY,
  timeoutMs: 20_000,
});

let running = true;
let inFlight: Promise<void> = Promise.resolve();

async function tick(): Promise<void> {
  try {
    const handled = await dispatchPending({ db, logger, dispatch });
    if (handled > 0) logger.info({ handled }, "events dispatched");
  } catch (e) {
    /*
     * The loop never dies. A database that is briefly unreachable, or an API that is restarting,
     * must not end the worker: the events are still there and the next tick picks them up.
     */
    logger.error({ err: e }, "the dispatch loop failed; it will try again");
  }
}

async function loop(): Promise<void> {
  while (running) {
    inFlight = tick();
    await inFlight;
    if (!running) break;
    await new Promise((resolve) => setTimeout(resolve, env.EVENT_POLL_MS));
  }
}

logger.info({ app_env: env.APP_ENV, poll_ms: env.EVENT_POLL_MS }, "workers started: event dispatcher");
void loop();

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  running = false;
  // Let the tick in progress finish: an event mid-dispatch would otherwise be retried, and a
  // consumer that is not idempotent would notice. They all are, but finishing is still cheaper.
  await inFlight.catch(() => {});
  await db.$client.end({ timeout: 5 });
  process.exit(0);
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => void shutdown(signal));
}
