import { serve } from "@hono/node-server";
import { loadServerEnv } from "@asap/schema/env/server";
import { resolveProvider } from "./ai/gateway.js";
import { createApp } from "./app.js";
import { resolveBuildInfo } from "./build-info.js";
import { createLogger } from "./logger.js";
import { registerApiKey } from "./boot/apiKey.js";
import { LogMailer, ResendMailer } from "./mail/index.js";
import { createExecutor } from "./runs/executor.js";
import { httpExtractor } from "./documents/extractor.js";
import { newBootToken, recoverOrphanedRuns } from "./runs/recovery.js";
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

// Optional transports (D-046): absent config disables the feature and says so once.
const mailer =
  env.RESEND_API_KEY && env.RESEND_FROM_EMAIL
    ? new ResendMailer({ apiKey: env.RESEND_API_KEY, from: env.RESEND_FROM_EMAIL }, logger)
    : new LogMailer(logger);
if (mailer instanceof LogMailer)
  logger.warn(
    { app_env: env.APP_ENV },
    "email disabled: RESEND_API_KEY not set; invitation links are logged, not sent",
  );
if (!env.SENTRY_DSN)
  logger.warn({ app_env: env.APP_ENV }, "error reporting disabled: SENTRY_DSN not set");

const bootToken = newBootToken();

const app = createApp({
  aiProvider: resolveProvider(env, logger),
  storage: {
    bucket: env.STORAGE_BUCKET,
    signedUrlTtlSeconds: env.SIGNED_URL_TTL_SECONDS,
    maxUploadBytes: env.MAX_UPLOAD_BYTES,
  },
  // Absent means a brokerage cannot connect that provider here, and the surface says so.
  mailboxOAuth: {
    gmail: {
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
    },
    microsoft: {
      clientId: env.MICROSOFT_OAUTH_CLIENT_ID,
      clientSecret: env.MICROSOFT_OAUTH_CLIENT_SECRET,
      tenantId: env.MICROSOFT_OAUTH_TENANT_ID,
      redirectUri: env.MICROSOFT_OAUTH_REDIRECT_URI,
    },
  },
  logger,
  build,
  supabase,
  mailer,
  webBaseUrl: env.WEB_BASE_URL,
  invitationTtlHours: env.INVITATION_TOKEN_TTL_HOURS,
  exposeAcceptUrl: env.APP_ENV === "local",
  executor: createExecutor({ logger, delayMs: 400 }),
  apiInternalKey: env.API_INTERNAL_KEY,
  /*
   * The service that reads documents. Absent is a valid deployment: files are still filed, and
   * say plainly that nothing has read them — which is better than a queue that never drains.
   */
  extractor:
    env.EXTRACTOR_URL && env.EXTRACTOR_SHARED_SECRET
      ? httpExtractor({
          url: env.EXTRACTOR_URL,
          secret: env.EXTRACTOR_SHARED_SECRET,
          timeoutMs: 120_000,
        })
      : null,
  bootToken,
});

// Before accepting traffic, in this order: this process's API key becomes the one active key
// (0025), then runs a previous process left working become could_not_finish and their work items
// need a person (0024). Registration failure is fatal: no engine write could succeed.
if ((await registerApiKey(supabase.service(), env.API_INTERNAL_KEY, logger)) === "failed") {
  process.exit(1);
}
await recoverOrphanedRuns(supabase.service(), bootToken, logger);

const server = serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  logger.info(
    {
      port: info.port,
      app_env: env.APP_ENV,
      version: build.version,
      commit: build.commit,
      mailer: mailer instanceof ResendMailer ? "resend" : "disabled",
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
