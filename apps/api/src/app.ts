import type { SupabaseClient } from "@supabase/supabase-js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Logger } from "pino";
import { requireUser } from "./auth.js";
import type { BuildInfo } from "./build-info.js";
import { HttpError, sendError } from "./errors.js";
import type { Mailer } from "./mail/index.js";
import { askRoutes } from "./routes/ask.js";
import { attentionRoutes } from "./routes/attention.js";
import { automationRoutes } from "./routes/automations.js";
import { complianceRoutes } from "./routes/compliance.js";
import { conversationRoutes } from "./routes/conversations.js";
import { mailboxRoutes, type MailboxOAuthConfig } from "./routes/mailboxes.js";
import { importRoutes } from "./routes/imports.js";
import { documentRoutes } from "./routes/documents.js";
import { healthRoutes } from "./routes/health.js";
import { invitationPublicRoutes, invitationRoutes } from "./routes/invitations.js";
import { meRoutes } from "./routes/me.js";
import { organizationRoutes } from "./routes/organizations.js";
import { spaceRoutes } from "./routes/spaces.js";
import { workRoutes } from "./routes/work.js";
import type { AiProvider } from "@asap/schema";
import type { Executor } from "./runs/executor.js";
import type { SupabaseFactory } from "./supabase.js";

export type AppDeps = {
  logger: Logger;
  build: BuildInfo;
  supabase: SupabaseFactory;
  mailer: Mailer;
  webBaseUrl: string;
  invitationTtlHours: number;
  exposeAcceptUrl: boolean;
  /** Runs a work item run in-process; tests inject an immediate one. */
  executor: (db: SupabaseClient) => Executor;
  /** Identifies this process on every run it starts; recovery on boot ends runs from other tokens. */
  bootToken: string;
  /**
   * The AI gateway, resolved once at boot from server-side configuration. Null when nothing is
   * configured — Ask then answers with the configuration-required state instead of failing.
   */
  aiProvider?: AiProvider | null;
  /**
   * The private document bucket and its limits. `server.ts` always passes the configured values;
   * the fallback below exists so a test that never touches a document need not describe storage.
   */
  storage?: { bucket: string; signedUrlTtlSeconds: number; maxUploadBytes: number };
  /**
   * OAuth credentials for the mailboxes a brokerage can connect. Every field is optional: a
   * deployment without them says so at the moment somebody asks, rather than offering a
   * connection that cannot work (D-068).
   */
  mailboxOAuth?: MailboxOAuthConfig;
  streamPollMs?: number;
};

/**
 * Builds the Hono app without binding a port, so tests can call app.request() directly.
 * Every route under requireUser resolves organization, role and permissions from the session
 * (§45 rule 5) — never from a header or body supplied by the browser.
 */
export function createApp(deps: AppDeps) {
  const { logger, build, supabase } = deps;
  const app = new Hono();

  app.use(secureHeaders());
  app.use(
    cors({
      origin: deps.webBaseUrl,
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      maxAge: 600,
    }),
  );

  app.use(async (c, next) => {
    const started = performance.now();
    await next();
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        duration_ms: Math.round(performance.now() - started),
      },
      "request",
    );
  });

  // Public
  app.route("/", healthRoutes(build));
  app.route("/", invitationPublicRoutes({ supabase }));

  // Signed-in. The middleware is bound to the authenticated path prefixes only, so an unknown
  // path is a 404 rather than a 401, and GET /invitations/:token stays public.
  const guard = requireUser(supabase);
  for (const path of [
    "/me",
    "/me/*",
    "/organizations",
    "/organizations/*",
    "/invitations/:token/accept",
    "/ask",
    "/attention",
    "/pins",
    "/automations",
    "/automations/*",
    "/documents",
    "/documents/*",
    "/mailboxes",
    "/mailboxes/*",
    "/conversations",
    "/conversations/*",
    "/spaces/*",
    "/work",
    "/work-items",
    "/work-items/*",
    "/placements",
    "/policies",
    "/policies/*",
    "/claims/*",
    "/endorsements/*",
    "/clients",
    "/clients/*",
    "/agreements",
    "/agreements/*",
    "/drafts/*",
    "/runs",
    "/runs/*",
    "/search",
    "/imports",
    "/imports/*",
    "/contacts",
    "/audit",
    "/email/threads",
    "/email/threads/*",
  ]) {
    app.use(path, guard);
  }
  app.route("/", meRoutes());
  app.route("/", askRoutes());
  app.route("/", conversationRoutes({ logger, provider: deps.aiProvider ?? null }));
  app.route(
    "/",
    documentRoutes({
      logger,
      bucket: deps.storage?.bucket ?? "insurance-documents",
      signedUrlTtlSeconds: deps.storage?.signedUrlTtlSeconds ?? 300,
      maxUploadBytes: deps.storage?.maxUploadBytes ?? 52_428_800,
    }),
  );
  app.route(
    "/",
    mailboxRoutes({
      logger,
      oauth: deps.mailboxOAuth ?? { gmail: {}, microsoft: {} },
    }),
  );
  app.route("/", importRoutes({ logger, aiProvider: deps.aiProvider ?? null }));
  app.route("/", attentionRoutes());
  app.route("/", automationRoutes({ logger }));
  app.route("/", spaceRoutes({ logger }));
  app.route("/", complianceRoutes({ logger }));
  app.route(
    "/",
    workRoutes({
      logger,
      executor: deps.executor,
      bootToken: deps.bootToken,
      streamPollMs: deps.streamPollMs ?? 500,
    }),
  );
  app.route("/", organizationRoutes(logger));
  app.route(
    "/",
    invitationRoutes({
      logger,
      mailer: deps.mailer,
      supabase,
      webBaseUrl: deps.webBaseUrl,
      invitationTtlHours: deps.invitationTtlHours,
      exposeAcceptUrl: deps.exposeAcceptUrl,
    }),
  );

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) return sendError(c, err);
    // Never echo error details to the client; they may carry record data.
    logger.error({ err, path: c.req.path }, "unhandled error");
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
