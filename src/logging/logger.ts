import pino from 'pino';
import type { Logger as PinoLogger } from 'pino';
import type { LoggerConfig, ScopedLogger } from './interface';

/**
 * Create a Pino logger with the given config
 * Auto-detects dev vs production mode from NODE_ENV
 */
export function createLogger(config: LoggerConfig = {}): PinoLogger {
  const isDev = process.env.NODE_ENV !== 'production';
  const level = config.level || (isDev ? 'debug' : 'info');

  const options: pino.LoggerOptions = {
    level,
    transport: undefined,
  };

  // Use pretty print in dev mode if not explicitly disabled
  if (isDev && config.prettyPrint !== false) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss Z',
        ignore: 'pid,hostname',
        singleLine: false,
        ...config.transport?.options,
      },
    };
  } else if (config.transport) {
    options.transport = config.transport as any;
  }

  return pino(options);
}

/**
 * Create a child logger with request context
 */
export function createScopedLogger(baseLogger: PinoLogger, context: Record<string, unknown>): ScopedLogger {
  const child = baseLogger.child(context);

  return {
    trace(msg: string, data?: Record<string, unknown>) {
      child.trace(data || {}, msg);
    },
    debug(msg: string, data?: Record<string, unknown>) {
      child.debug(data || {}, msg);
    },
    info(msg: string, data?: Record<string, unknown>) {
      child.info(data || {}, msg);
    },
    warn(msg: string, data?: Record<string, unknown>) {
      child.warn(data || {}, msg);
    },
    error(msg: string, data?: Record<string, unknown>) {
      child.error(data || {}, msg);
    },
  };
}
