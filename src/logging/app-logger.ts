/**
 * Application-wide pino logger singleton.
 *
 * Every module that needs logging should import { appLogger } from this file
 * and create child loggers via appLogger.child({ component: 'router' }) etc.
 *
 * All log lines automatically include: time, level, msg, pid.
 * Child loggers add reqId and other context fields.
 */

import type { Logger as PinoLogger } from 'pino';
import pino from 'pino';

const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const isDev = process.env.NODE_ENV !== 'production';

/**
 * Singleton pino logger for the entire application.
 * Level can be overridden via LOG_LEVEL env var.
 * Silent in test mode to avoid noise in test output.
 */
export const appLogger: PinoLogger = pino({
  level: isTest ? 'silent' : (process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info')),
  // Timestamps on every line (ISO format)
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Get the app logger (for modules that prefer a function call).
 */
export function getAppLogger(): PinoLogger {
  return appLogger;
}
