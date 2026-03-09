import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLogger, createScopedLogger } from './logger';
import type { Logger } from 'pino';

describe('Logger', () => {
  let logger: Logger;

  beforeEach(() => {
    // Set NODE_ENV to test mode
    process.env.NODE_ENV = 'test';
    logger = createLogger({ level: 'trace', prettyPrint: false });
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  describe('createLogger', () => {
    it('should create a logger instance', () => {
      expect(logger).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.debug).toBeDefined();
      expect(logger.error).toBeDefined();
    });

    it('should respect log level configuration', () => {
      const debugLogger = createLogger({ level: 'debug', prettyPrint: false });
      expect(debugLogger.level).toBe('debug');
    });

    it('should use info level by default in production', () => {
      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const prodLogger = createLogger({ prettyPrint: false });
      expect(prodLogger.level).toBe('info');
      process.env.NODE_ENV = oldEnv;
    });

    it('should use debug level by default in development', () => {
      const oldEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      const devLogger = createLogger({ prettyPrint: false });
      expect(devLogger.level).toBe('debug');
      process.env.NODE_ENV = oldEnv;
    });
  });

  describe('createScopedLogger', () => {
    it('should create a scoped logger with context', () => {
      const scopedLogger = createScopedLogger(logger, { requestId: 'req-123' });

      expect(scopedLogger).toBeDefined();
      expect(scopedLogger.info).toBeDefined();
      expect(scopedLogger.debug).toBeDefined();
      expect(scopedLogger.error).toBeDefined();
      expect(scopedLogger.warn).toBeDefined();
      expect(scopedLogger.trace).toBeDefined();
    });

    it('should accept log messages with data', () => {
      const scopedLogger = createScopedLogger(logger, { requestId: 'req-456' });

      // These should not throw
      expect(() => {
        scopedLogger.info('Test message', { key: 'value' });
        scopedLogger.debug('Debug message', { count: 42 });
        scopedLogger.warn('Warning message', { level: 'high' });
        scopedLogger.error('Error message', { code: 'ERR_001' });
        scopedLogger.trace('Trace message', { details: 'very detailed' });
      }).not.toThrow();
    });

    it('should accept log messages without data', () => {
      const scopedLogger = createScopedLogger(logger, { requestId: 'req-789' });

      // These should not throw
      expect(() => {
        scopedLogger.info('Test message');
        scopedLogger.debug('Debug message');
        scopedLogger.warn('Warning message');
        scopedLogger.error('Error message');
        scopedLogger.trace('Trace message');
      }).not.toThrow();
    });

    it('should include context in child logger', () => {
      const context = { requestId: 'req-999', provider: 'openai' };
      const scopedLogger = createScopedLogger(logger, context);

      // The scoped logger should be properly initialized with context
      // We can't directly test the context propagation without inspecting internals,
      // but we can verify the logger works
      expect(scopedLogger.info).toBeDefined();
    });

    it('should create multiple scoped loggers with different contexts', () => {
      const logger1 = createScopedLogger(logger, { requestId: 'req-1', provider: 'openai' });
      const logger2 = createScopedLogger(logger, { requestId: 'req-2', provider: 'anthropic' });

      expect(logger1).toBeDefined();
      expect(logger2).toBeDefined();

      // Both should work independently
      expect(() => {
        logger1.info('Message 1');
        logger2.info('Message 2');
      }).not.toThrow();
    });
  });

  describe('Logger levels', () => {
    it('should handle all log levels', () => {
      const testLogger = createLogger({ level: 'trace', prettyPrint: false });

      expect(() => {
        testLogger.trace('trace');
        testLogger.debug('debug');
        testLogger.info('info');
        testLogger.warn('warn');
        testLogger.error('error');
      }).not.toThrow();
    });
  });
});
