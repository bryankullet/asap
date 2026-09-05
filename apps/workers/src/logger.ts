import pino, { type Logger } from "pino";

export function createLogger(level: string, pretty: boolean): Logger {
  return pino({
    level,
    redact: {
      paths: [
        "*.password",
        "*.token",
        "*.refresh_token",
        "*.ENCRYPTION_KEY",
        "*.WORKER_DATABASE_URL",
      ],
      censor: "[redacted]",
    },
    ...(pretty ? { transport: { target: "pino-pretty", options: { colorize: true } } } : {}),
  });
}
