import pino, { type Logger } from "pino";

/**
 * Structured logger. The only place log output is configured.
 * Redaction is defensive: even if a caller passes a request object or a config blob,
 * these paths never reach a sink. Document contents and credentials must never be logged.
 */
export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        "*.password",
        "*.token",
        "*.refresh_token",
        "*.access_token",
        "*.SUPABASE_SERVICE_ROLE_KEY",
        "*.SUPABASE_JWT_SECRET",
        "*.ENCRYPTION_KEY",
        "*.ANTHROPIC_API_KEY",
        "*.OPENAI_API_KEY",
        "*.RESEND_API_KEY",
        "*.API_INTERNAL_KEY",
      ],
      censor: "[redacted]",
    },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}
