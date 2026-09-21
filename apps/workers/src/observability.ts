import type { Logger } from "pino";

/**
 * What the worker does about error reporting at startup, and what it says about it.
 *
 * Sentry is optional. The worker used to refuse to start in staging without a DSN; that traded a
 * quiet failure for a loud one and left the service down. Now it starts either way and says which
 * of the two is happening, because the thing that actually costs an afternoon is believing errors
 * are being reported when they are not.
 *
 * `install` is the seam for a real client. **No Sentry SDK is installed in this repository yet**,
 * so nothing passes one today: a DSN is validated and recorded, and the startup line says plainly
 * that reporting is not installed. When `@sentry/node` is added, it is wired in here and nothing
 * else changes — which is why this returns what it decided rather than just logging it.
 */
export type ObservabilityState =
  | { reporting: "none"; reason: "no_dsn" }
  | { reporting: "none"; reason: "client_not_installed"; dsn: string }
  | { reporting: "sentry" };

export function initObservability(
  env: { SENTRY_DSN?: string | undefined; APP_ENV: string; SENTRY_ENVIRONMENT?: string | undefined },
  logger: Logger,
  install?: (options: { dsn: string; environment: string }) => void,
): ObservabilityState {
  if (env.SENTRY_DSN === undefined) {
    logger.info("Sentry is not configured; errors will be available in Render logs.");
    return { reporting: "none", reason: "no_dsn" };
  }

  // The DSN carries a public key, but it is still a credential-shaped string: it identifies the
  // project and anyone holding it can post events to it. It never reaches the log.
  if (install === undefined) {
    logger.warn(
      "A SENTRY_DSN was supplied but no Sentry client is installed in this build; " +
        "errors will be available in Render logs only.",
    );
    return { reporting: "none", reason: "client_not_installed", dsn: env.SENTRY_DSN };
  }

  install({ dsn: env.SENTRY_DSN, environment: env.SENTRY_ENVIRONMENT ?? env.APP_ENV });
  logger.info({ environment: env.SENTRY_ENVIRONMENT ?? env.APP_ENV }, "Sentry reporting enabled");
  return { reporting: "sentry" };
}
