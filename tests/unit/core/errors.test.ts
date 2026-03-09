import { describe, expect, it } from 'vitest';
import {
  AuthError,
  BudgetError,
  ConfigError,
  ContentFilterError,
  ContextLengthError,
  ErrorClass,
  OverloadedError,
  ProviderError,
  ProxyError,
  RateLimitError,
  TimeoutError,
  ValidationError,
  classifyError,
  toHttpResponse,
} from '../../../src/core/errors.js';

describe('Error Classes', () => {
  describe('ProxyError', () => {
    it('should create a base proxy error with correct properties', () => {
      const error = new ProxyError('Test error', {
        code: 'TEST_ERROR',
        statusCode: 500,
        retryable: true,
        errorClass: ErrorClass.SERVER_ERROR,
      });

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.retryable).toBe(true);
      expect(error.errorClass).toBe(ErrorClass.SERVER_ERROR);
      expect(error.name).toBe('ProxyError');
    });

    it('should default retryable to false', () => {
      const error = new ProxyError('Test', {
        code: 'TEST',
        statusCode: 400,
      });
      expect(error.retryable).toBe(false);
    });

    it('should default errorClass to UNKNOWN', () => {
      const error = new ProxyError('Test', {
        code: 'TEST',
        statusCode: 500,
      });
      expect(error.errorClass).toBe(ErrorClass.UNKNOWN);
    });

    it('should capture stack trace', () => {
      const error = new ProxyError('Test', {
        code: 'TEST',
        statusCode: 500,
      });
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ProxyError');
    });
  });

  describe('RateLimitError', () => {
    it('should have status 429 and be retryable', () => {
      const error = new RateLimitError('Rate limit exceeded');
      expect(error.statusCode).toBe(429);
      expect(error.retryable).toBe(true);
      expect(error.errorClass).toBe(ErrorClass.RATE_LIMITED);
      expect(error.code).toBe('RATE_LIMITED');
    });

    it('should include rate limit details', () => {
      const resetAt = new Date('2024-03-09T00:00:00Z');
      const error = new RateLimitError('Rate limit exceeded', {
        limit: 100,
        remaining: 0,
        resetAt,
        retryAfter: 60,
      });

      expect(error.limit).toBe(100);
      expect(error.remaining).toBe(0);
      expect(error.resetAt).toEqual(resetAt);
      expect(error.retryAfter).toBe(60);
    });
  });

  describe('TimeoutError', () => {
    it('should have status 504 and be retryable', () => {
      const error = new TimeoutError('Request timeout', { timeoutMs: 30000 });
      expect(error.statusCode).toBe(504);
      expect(error.retryable).toBe(true);
      expect(error.errorClass).toBe(ErrorClass.TIMEOUT);
      expect(error.code).toBe('TIMEOUT');
      expect(error.timeoutMs).toBe(30000);
    });
  });

  describe('ValidationError', () => {
    it('should have status 400 and not be retryable', () => {
      const error = new ValidationError('Invalid request');
      expect(error.statusCode).toBe(400);
      expect(error.retryable).toBe(false);
      expect(error.errorClass).toBe(ErrorClass.INVALID_REQUEST);
      expect(error.code).toBe('VALIDATION_ERROR');
    });

    it('should include field and constraint details', () => {
      const error = new ValidationError('Invalid field', {
        field: 'temperature',
        constraint: 'must be between 0 and 2',
      });

      expect(error.field).toBe('temperature');
      expect(error.constraint).toBe('must be between 0 and 2');
    });
  });

  describe('AuthError', () => {
    it('should have status 401 and not be retryable', () => {
      const error = new AuthError('Invalid API key');
      expect(error.statusCode).toBe(401);
      expect(error.retryable).toBe(false);
      expect(error.errorClass).toBe(ErrorClass.AUTH_FAILED);
      expect(error.code).toBe('AUTH_FAILED');
    });
  });

  describe('BudgetError', () => {
    it('should have status 403 and not be retryable', () => {
      const error = new BudgetError('Budget exceeded', {
        limit: 1000,
        current: 1050,
      });

      expect(error.statusCode).toBe(403);
      expect(error.retryable).toBe(false);
      expect(error.errorClass).toBe(ErrorClass.BUDGET_EXCEEDED);
      expect(error.code).toBe('BUDGET_EXCEEDED');
      expect(error.limit).toBe(1000);
      expect(error.current).toBe(1050);
    });
  });

  describe('ConfigError', () => {
    it('should have status 500 and not be retryable', () => {
      const error = new ConfigError('Invalid config', {
        configKey: 'providers.openai.apiKey',
      });

      expect(error.statusCode).toBe(500);
      expect(error.retryable).toBe(false);
      expect(error.errorClass).toBe(ErrorClass.INVALID_REQUEST);
      expect(error.code).toBe('CONFIG_ERROR');
      expect(error.configKey).toBe('providers.openai.apiKey');
    });
  });

  describe('ContextLengthError', () => {
    it('should have status 400 and not be retryable', () => {
      const error = new ContextLengthError('Context too long', {
        maxTokens: 4096,
        actualTokens: 5000,
      });

      expect(error.statusCode).toBe(400);
      expect(error.retryable).toBe(false);
      expect(error.errorClass).toBe(ErrorClass.CONTEXT_TOO_LONG);
      expect(error.code).toBe('CONTEXT_TOO_LONG');
      expect(error.maxTokens).toBe(4096);
      expect(error.actualTokens).toBe(5000);
    });
  });

  describe('ContentFilterError', () => {
    it('should have status 400 and not be retryable', () => {
      const error = new ContentFilterError('Content filtered');
      expect(error.statusCode).toBe(400);
      expect(error.retryable).toBe(false);
      expect(error.errorClass).toBe(ErrorClass.CONTENT_FILTERED);
      expect(error.code).toBe('CONTENT_FILTERED');
    });
  });

  describe('OverloadedError', () => {
    it('should have status 503 and be retryable', () => {
      const error = new OverloadedError('Service overloaded', {
        retryAfter: 30,
      });

      expect(error.statusCode).toBe(503);
      expect(error.retryable).toBe(true);
      expect(error.errorClass).toBe(ErrorClass.OVERLOADED);
      expect(error.code).toBe('OVERLOADED');
      expect(error.retryAfter).toBe(30);
    });
  });

  describe('ProviderError', () => {
    it('should include provider details', () => {
      const error = new ProviderError('Provider failed', {
        provider: 'openai',
        providerCode: 'model_not_found',
        providerMessage: 'The model gpt-5 does not exist',
        statusCode: 404,
        errorClass: ErrorClass.INVALID_REQUEST,
      });

      expect(error.provider).toBe('openai');
      expect(error.providerCode).toBe('model_not_found');
      expect(error.providerMessage).toBe('The model gpt-5 does not exist');
      expect(error.statusCode).toBe(404);
      expect(error.code).toBe('PROVIDER_ERROR');
    });
  });
});

describe('classifyError', () => {
  describe('ProxyError classification', () => {
    it('should return the errorClass from ProxyError', () => {
      const error = new RateLimitError('Rate limited');
      expect(classifyError(error)).toBe(ErrorClass.RATE_LIMITED);
    });
  });

  describe('HTTP status classification', () => {
    it('should classify 429 as RATE_LIMITED', () => {
      expect(classifyError({ status: 429 })).toBe(ErrorClass.RATE_LIMITED);
    });

    it('should classify 401/403 as AUTH_FAILED', () => {
      expect(classifyError({ status: 401 })).toBe(ErrorClass.AUTH_FAILED);
      expect(classifyError({ status: 403 })).toBe(ErrorClass.AUTH_FAILED);
    });

    it('should classify 400 as INVALID_REQUEST', () => {
      expect(classifyError({ status: 400 })).toBe(ErrorClass.INVALID_REQUEST);
    });

    it('should classify 408/504 as TIMEOUT', () => {
      expect(classifyError({ status: 408 })).toBe(ErrorClass.TIMEOUT);
      expect(classifyError({ status: 504 })).toBe(ErrorClass.TIMEOUT);
    });

    it('should classify 503/529 as OVERLOADED', () => {
      expect(classifyError({ status: 503 })).toBe(ErrorClass.OVERLOADED);
      expect(classifyError({ status: 529 })).toBe(ErrorClass.OVERLOADED);
    });

    it('should classify 500/502/505 as SERVER_ERROR', () => {
      expect(classifyError({ status: 500 })).toBe(ErrorClass.SERVER_ERROR);
      expect(classifyError({ status: 502 })).toBe(ErrorClass.SERVER_ERROR);
      expect(classifyError({ status: 505 })).toBe(ErrorClass.SERVER_ERROR);
    });

    it('should classify 4xx as INVALID_REQUEST', () => {
      expect(classifyError({ status: 404 })).toBe(ErrorClass.INVALID_REQUEST);
      expect(classifyError({ status: 422 })).toBe(ErrorClass.INVALID_REQUEST);
    });

    it('should classify 5xx as SERVER_ERROR', () => {
      expect(classifyError({ status: 501 })).toBe(ErrorClass.SERVER_ERROR);
      expect(classifyError({ status: 507 })).toBe(ErrorClass.SERVER_ERROR);
    });
  });

  describe('Provider error body classification', () => {
    it('should classify rate limit errors from error body', () => {
      expect(
        classifyError({
          type: 'rate_limit_error',
          message: 'Too many requests',
        })
      ).toBe(ErrorClass.RATE_LIMITED);

      expect(
        classifyError({
          code: 'rate_limit_exceeded',
          message: 'Rate limit exceeded',
        })
      ).toBe(ErrorClass.RATE_LIMITED);

      expect(
        classifyError({
          message: 'Too many requests',
        })
      ).toBe(ErrorClass.RATE_LIMITED);
    });

    it('should classify Anthropic overloaded errors', () => {
      expect(
        classifyError({
          type: 'overloaded_error',
          message: 'Overloaded',
        })
      ).toBe(ErrorClass.OVERLOADED);

      expect(
        classifyError({
          message: 'Service is overloaded',
        })
      ).toBe(ErrorClass.OVERLOADED);

      expect(
        classifyError({
          message: 'Insufficient capacity',
        })
      ).toBe(ErrorClass.OVERLOADED);
    });

    it('should classify context length errors', () => {
      expect(
        classifyError({
          type: 'invalid_request_error',
          message: 'Context length exceeds maximum',
        })
      ).toBe(ErrorClass.CONTEXT_TOO_LONG);

      expect(
        classifyError({
          type: 'invalid_request_error',
          message: 'Prompt is too long',
        })
      ).toBe(ErrorClass.CONTEXT_TOO_LONG);

      expect(
        classifyError({
          type: 'invalid_request_error',
          message: 'Token limit exceeded',
        })
      ).toBe(ErrorClass.CONTEXT_TOO_LONG);
    });

    it('should classify content filter errors', () => {
      expect(
        classifyError({
          type: 'content_filter_error',
          message: 'Content filtered',
        })
      ).toBe(ErrorClass.CONTENT_FILTERED);

      expect(
        classifyError({
          message: 'Content policy violation',
        })
      ).toBe(ErrorClass.CONTENT_FILTERED);
    });

    it('should classify auth errors', () => {
      expect(
        classifyError({
          type: 'authentication_error',
          message: 'Invalid API key',
        })
      ).toBe(ErrorClass.AUTH_FAILED);

      expect(
        classifyError({
          message: 'Authentication failed',
        })
      ).toBe(ErrorClass.AUTH_FAILED);

      expect(
        classifyError({
          message: 'Invalid api key',
        })
      ).toBe(ErrorClass.AUTH_FAILED);
    });

    it('should classify generic invalid request errors', () => {
      expect(
        classifyError({
          type: 'invalid_request_error',
          message: 'Missing required field',
        })
      ).toBe(ErrorClass.INVALID_REQUEST);

      expect(
        classifyError({
          code: 'invalid_model',
          message: 'Invalid model specified',
        })
      ).toBe(ErrorClass.INVALID_REQUEST);
    });
  });

  describe('Node.js error classification', () => {
    it('should classify timeout errors', () => {
      const error = new Error('Timeout') as Error & { code?: string };
      error.code = 'ETIMEDOUT';
      expect(classifyError(error)).toBe(ErrorClass.TIMEOUT);

      const socketError = new Error('Socket timeout') as Error & { code?: string };
      socketError.code = 'ESOCKETTIMEDOUT';
      expect(classifyError(socketError)).toBe(ErrorClass.TIMEOUT);
    });

    it('should classify connection errors', () => {
      const refusedError = new Error('Connection refused') as Error & { code?: string };
      refusedError.code = 'ECONNREFUSED';
      expect(classifyError(refusedError)).toBe(ErrorClass.SERVER_ERROR);

      const resetError = new Error('Connection reset') as Error & { code?: string };
      resetError.code = 'ECONNRESET';
      expect(classifyError(resetError)).toBe(ErrorClass.SERVER_ERROR);
    });
  });

  describe('Unknown error classification', () => {
    it('should classify unknown errors as UNKNOWN', () => {
      expect(classifyError(new Error('Random error'))).toBe(ErrorClass.UNKNOWN);
      expect(classifyError({ foo: 'bar' })).toBe(ErrorClass.UNKNOWN);
      expect(classifyError('string error')).toBe(ErrorClass.UNKNOWN);
      expect(classifyError(null)).toBe(ErrorClass.UNKNOWN);
    });
  });
});

describe('toHttpResponse', () => {
  it('should serialize a basic ProxyError', () => {
    const error = new ProxyError('Test error', {
      code: 'TEST_ERROR',
      statusCode: 500,
      retryable: true,
      errorClass: ErrorClass.SERVER_ERROR,
    });

    const response = toHttpResponse(error);

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: {
        message: 'Test error',
        code: 'TEST_ERROR',
        type: 'ProxyError',
        class: ErrorClass.SERVER_ERROR,
        retryable: true,
      },
    });
  });

  it('should include retryAfter when present', () => {
    const error = new RateLimitError('Rate limited', { retryAfter: 60 });
    const response = toHttpResponse(error);

    expect(response.body.error.retryAfter).toBe(60);
  });

  it('should include RateLimitError details', () => {
    const resetAt = new Date('2024-03-09T00:00:00Z');
    const error = new RateLimitError('Rate limited', {
      limit: 100,
      remaining: 0,
      resetAt,
    });

    const response = toHttpResponse(error);

    expect(response.body.error.details).toEqual({
      limit: 100,
      remaining: 0,
      resetAt: '2024-03-09T00:00:00.000Z',
    });
  });

  it('should include TimeoutError details', () => {
    const error = new TimeoutError('Timeout', { timeoutMs: 30000 });
    const response = toHttpResponse(error);

    expect(response.body.error.details).toEqual({
      timeoutMs: 30000,
    });
  });

  it('should include ValidationError details', () => {
    const error = new ValidationError('Invalid field', {
      field: 'temperature',
      constraint: 'must be between 0 and 2',
    });

    const response = toHttpResponse(error);

    expect(response.body.error.details).toEqual({
      field: 'temperature',
      constraint: 'must be between 0 and 2',
    });
  });

  it('should include BudgetError details', () => {
    const error = new BudgetError('Budget exceeded', {
      limit: 1000,
      current: 1050,
    });

    const response = toHttpResponse(error);

    expect(response.body.error.details).toEqual({
      limit: 1000,
      current: 1050,
    });
  });

  it('should include ConfigError details', () => {
    const error = new ConfigError('Invalid config', {
      configKey: 'providers.openai.apiKey',
    });

    const response = toHttpResponse(error);

    expect(response.body.error.details).toEqual({
      configKey: 'providers.openai.apiKey',
    });
  });

  it('should include ContextLengthError details', () => {
    const error = new ContextLengthError('Context too long', {
      maxTokens: 4096,
      actualTokens: 5000,
    });

    const response = toHttpResponse(error);

    expect(response.body.error.details).toEqual({
      maxTokens: 4096,
      actualTokens: 5000,
    });
  });

  it('should include ProviderError details', () => {
    const error = new ProviderError('Provider failed', {
      provider: 'openai',
      providerCode: 'model_not_found',
      providerMessage: 'Model does not exist',
      statusCode: 404,
    });

    const response = toHttpResponse(error);

    expect(response.body.error.details).toEqual({
      provider: 'openai',
      providerCode: 'model_not_found',
      providerMessage: 'Model does not exist',
    });
  });

  it('should not include details object when no details present', () => {
    const error = new AuthError('Invalid API key');
    const response = toHttpResponse(error);

    expect(response.body.error.details).toBeUndefined();
  });
});
