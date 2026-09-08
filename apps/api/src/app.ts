import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import type { Logger } from "pino";
import { requireUser } from "./auth.js";
import type { BuildInfo } from "./build-info.js";
import { HttpError, sendError } from "./errors.js";
import type { Mailer } from "./mail/index.js";
import { askRoutes } from "./routes/ask.js";
import { healthRoutes } from "./routes/health.js";
import { invitationPublicRoutes, invitationRoutes } from "./routes/invitations.js";
import { meRoutes } from "./routes/me.js";
import { organizationRoutes } from "./routes/organizations.js";
import type { SupabaseFactory } from "./supabase.js";

export type AppDeps = {
  logger: Logger;
  build: BuildInfo;
  supabase: SupabaseFactory;
  mailer: Mailer;
  webBaseUrl: string;
  invitationTtlHours: number;
  exposeAcceptUrl: boolean;
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
  ]) {
    app.use(path, guard);
  }
  app.route("/", meRoutes());
  app.route("/", askRoutes());
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
