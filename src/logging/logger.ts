import pino, { type Logger } from "pino";

/** Create a configured Pino logger instance. */
export function createLogger(options?: { level?: string; name?: string }): Logger {
  return pino({
    name: options?.name ?? "prism-pipe",
    level: options?.level ?? "info",
    transport:
      process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty", options: { colorize: true } }
        : undefined,
  });
}
