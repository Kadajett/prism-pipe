/**
 * Singleton application logger.
 * All modules should import this instead of using console.* directly.
 * Ensures every log line has: time, level, msg (pino adds these automatically).
 */

import type { Logger as PinoLogger } from 'pino';
import pino from 'pino';

let _instance: PinoLogger | undefined;

/**
 * Get (or create) the singleton pino logger.
 * The first call may pass a level; subsequent calls return the same instance.
 */
export function getAppLogger(level?: string): PinoLogger {
  if (!_instance) {
    const isDev = process.env.NODE_ENV !== 'production';
    _instance = pino({
      level: level ?? (isDev ? 'debug' : 'info'),
      // pino always includes `time` in JSON output; pino-pretty renders it nicely
      transport: process.stdout.isTTY
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'yyyy-mm-dd HH:MM:ss.l Z',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
    });
  }
  return _instance;
}

/**
 * Replace the singleton (useful in tests or when PrismPipe sets a log level).
 */
export function setAppLogger(logger: PinoLogger): void {
  _instance = logger;
}
