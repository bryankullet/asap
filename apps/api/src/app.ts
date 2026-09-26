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
import { mailboxOAuthRoutes } from "./routes/mailbox-oauth.js";
import { onboardingRoutes } from "./routes/onboarding.js";
import { clientRoutes } from "./routes/clients.js";
import { comparisonRoutes } from "./routes/comparisons.js";
import { opportunityRoutes } from "./routes/opportunities.js";
import { placementRoutes } from "./routes/placement.js";
import { quotationReadingRoutes } from "./routes/quotation-reading.js";
import { ruleRoutes } from "./routes/rules.js";
import type { MailboxProvider, SyncLimits } from "./mailbox/types.js";
import { importRoutes } from "./routes/imports.js";
import { internalRoutes } from "./routes/internal.js";
import { documentRoutes } from "./routes/documents.js";
import { healthRoutes } from "./routes/health.js";
import { invitationPublicRoutes, invitationRoutes } from "./routes/invitations.js";
import { meRoutes } from "./routes/me.js";
import { organizationRoutes } from "./routes/organizations.js";
import { spaceRoutes } from "./routes/spaces.js";
import { workRoutes } from "./routes/work.js";
import type { AiProvider } from "@asap/schema";
import type { Executor } from "./runs/executor.js";
import type { Extractor } from "./documents/extractor.js";
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
  /**
   * The secret the worker tier presents. Absent in tests that do not exercise dispatch, in which
   * case the internal surface is not mounted at all rather than mounted with an empty key.
   */
  apiInternalKey?: string | undefined;
  /** Reads filed documents. Absent on a deployment with none: documents say they are unread. */
  extractor?: Extractor | null | undefined;
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
  /**
   * The mailbox adapters, the encryption key that reads their stored tokens, and how much one
   * pass may read. Absent in a test that never touches a mailbox, and in a deployment with no
   * provider credentials — where the honest answer is that nothing reads a mailbox.
   */
  mailbox?:
    | {
        providers: Partial<Record<"gmail" | "microsoft", MailboxProvider>>;
        limits: SyncLimits;
        encryptionKey: string;
      }
    | undefined;
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
  /*
   * The worker tier's own surface. Mounted before the session guard because it has no session:
   * it carries a shared secret instead, and is refused without it.
   */
  if (deps.apiInternalKey) {
    app.route(
      "/",
      internalRoutes({
        logger,
        service: () => supabase.service(),
        internalKey: deps.apiInternalKey,
        extractor: deps.extractor ?? null,
        bucket: deps.storage?.bucket ?? "insurance-documents",
        mailbox: deps.mailbox,
      }),
    );
  }
  /*
   * The OAuth callback. Public because it has to be: the person arrives by a redirect from the
   * provider with no session, and the single-use state row is the authentication.
   */
  if (deps.mailbox) {
    app.route(
      "/",
      mailboxOAuthRoutes({
        logger,
        service: () => supabase.service(),
        providers: deps.mailbox.providers,
        redirectUris: {
          ...(deps.mailboxOAuth?.gmail.redirectUri
            ? { gmail: deps.mailboxOAuth.gmail.redirectUri }
            : {}),
          ...(deps.mailboxOAuth?.microsoft.redirectUri
            ? { microsoft: deps.mailboxOAuth.microsoft.redirectUri }
            : {}),
        },
        encryptionKey: deps.mailbox.encryptionKey,
        webBaseUrl: deps.webBaseUrl,
      }),
    );
  }
  app.route("/", invitationPublicRoutes({ supabase }));

  // Signed-in. The middleware is bound to the authenticated path prefixes only, so an unknown
  // path is a 404 rather than a 401, and GET /invitations/:token stays public.
  const guard = requireUser(supabase);
  for (const path of [
    "/me",
    "/me/*",
    "/organizations",
    "/organizations/*",
    "/onboarding",
    "/onboarding/*",
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
    "/opportunities",
    "/opportunities/*",
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
    /* The brokerage's own rules, and the review of what was read from a quotation (4B-3A). */
    "/rules",
    /* Placement (4B-4). Guarded from the first line — the /rules defect is not repeated. */
    "/placements",
    "/placements/*",
    /* What Ask or a screen prepared, confirmed by a person (4B-4A). */
    "/prepared-actions/*",
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
      providers: deps.mailbox?.providers,
      encryptionKey: deps.mailbox?.encryptionKey,
      service: () => supabase.service(),
    }),
  );
  app.route("/", importRoutes({ logger, aiProvider: deps.aiProvider ?? null }));
  app.route("/", attentionRoutes());
  app.route("/", automationRoutes({ logger }));
  app.route("/", spaceRoutes({ logger }));
  app.route("/", complianceRoutes({ logger }));
  app.route("/", clientRoutes());
  app.route("/", opportunityRoutes({ logger }));
  app.route("/", comparisonRoutes({ logger }));
  app.route("/", ruleRoutes({ logger }));
  app.route("/", quotationReadingRoutes({ logger }));
  app.route("/", placementRoutes({ logger }));
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
    onboardingRoutes({
      logger,
      /* Honest by construction: step three offers a connection only where one could work. */
      gmailConfigured: Boolean(deps.mailbox?.providers.gmail),
    }),
  );
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
