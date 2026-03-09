/**
 * Pino logger factory
 */

import pino from "pino"

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
    },
  },
})

export function createLogger(name: string) {
  return logger.child({ module: name })
}
