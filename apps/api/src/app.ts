import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { Logger } from "pino";
import type { BuildInfo } from "./build-info.js";
import { healthRoutes } from "./routes/health.js";

export type AppDeps = { logger: Logger; build: BuildInfo };

/**
 * Builds the Hono app without binding a port, so tests can call app.request() directly.
 * Every future route resolves organization and role from the session (§45) — never from a
 * header or body supplied by the browser.
 */
export function createApp({ logger, build }: AppDeps) {
  const app = new Hono();

  app.use(secureHeaders());

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

  app.route("/", healthRoutes(build));

  app.notFound((c) => c.json({ error: "not_found" }, 404));

  app.onError((err, c) => {
    // Never echo error details to the client; they may carry record data.
    logger.error({ err, path: c.req.path }, "unhandled error");
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}
