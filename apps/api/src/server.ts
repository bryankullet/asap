import { serve } from "@hono/node-server";
import { loadServerEnv } from "@asap/schema/env/server";
import { createApp } from "./app.js";
import { resolveBuildInfo } from "./build-info.js";
import { createLogger } from "./logger.js";

// Fails immediately, naming the variable, if the environment is incomplete.
const env = loadServerEnv();

const logger = createLogger(env.LOG_LEVEL, env.APP_ENV === "local");
const build = resolveBuildInfo(env);
const app = createApp({ logger, build });

const server = serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  logger.info(
    { port: info.port, app_env: env.APP_ENV, version: build.version, commit: build.commit },
    "api listening",
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
  });
}
