import { serve } from "@hono/node-server";
import { loadServerEnv } from "@asap/schema/env/server";
import { createApp } from "./app.js";
import { resolveBuildInfo } from "./build-info.js";
import { createLogger } from "./logger.js";
import { LogMailer, PostmarkMailer } from "./mail/index.js";
import { createExecutor } from "./runs/executor.js";
import { createSupabaseFactory } from "./supabase.js";

// Fails immediately, naming the variable, if the environment is incomplete.
const env = loadServerEnv();

const logger = createLogger(env.LOG_LEVEL, env.APP_ENV === "local");
const build = resolveBuildInfo(env);

const supabase = createSupabaseFactory({
  url: env.SUPABASE_URL,
  anonKey: env.SUPABASE_ANON_KEY,
  serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
  apiInternalKey: env.API_INTERNAL_KEY,
});

// Postmark is required outside local (D-007); locally the link is logged instead of sent.
const mailer =
  env.POSTMARK_SERVER_TOKEN && env.POSTMARK_FROM_EMAIL
    ? new PostmarkMailer(
        {
          serverToken: env.POSTMARK_SERVER_TOKEN,
          from: env.POSTMARK_FROM_EMAIL,
          messageStream: env.POSTMARK_MESSAGE_STREAM,
        },
        logger,
      )
    : new LogMailer(logger);

const app = createApp({
  logger,
  build,
  supabase,
  mailer,
  webBaseUrl: env.WEB_BASE_URL,
  invitationTtlHours: env.INVITATION_TOKEN_TTL_HOURS,
  exposeAcceptUrl: env.APP_ENV === "local",
  executor: createExecutor({ logger, delayMs: 400 }),
});

const server = serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  logger.info(
    {
      port: info.port,
      app_env: env.APP_ENV,
      version: build.version,
      commit: build.commit,
      mailer: mailer instanceof PostmarkMailer ? "postmark" : "log",
    },
    "api listening",
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    logger.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
  });
}
