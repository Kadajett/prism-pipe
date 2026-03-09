import { describe, it, expect } from 'vitest';
import {
  ErrorClass,
  ProxyError,
  ProviderError,
  RateLimitError,
  TimeoutError,
  ValidationError,
  AuthError,
  BudgetError,
  ConfigError,
  classifyError,
  toHttpResponse,
  type ErrorResponseBody,
} from '../src/core/errors.js';

describe('Error Classes', () => {
  describe('ProxyError', () => {
    it('creates base error with all properties', () => {
      const error = new ProxyError(
        'Test error',
        'test_code',
        500,
        ErrorClass.SERVER_ERROR,
        true,
        60
      );
      
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('test_code');
      expect(error.statusCode).toBe(500);
      expect(error.errorClass).toBe(ErrorClass.SERVER_ERROR);
      expect(error.retryable).toBe(true);
      expect(error.retryAfter).toBe(60);
      expect(error.name).toBe('ProxyError');
    });

    it('has optional retryAfter', () => {
      const error = new ProxyError(
        'Test',
        'code',
        500,
        ErrorClass.SERVER_ERROR
      );
      expect(error.retryAfter).toBeUndefined();
    });
  });

  describe('ProviderError', () => {
    it('has correct defaults', () => {
      const error = new ProviderError('Provider failed', 'anthropic');
      
      expect(error.statusCode).toBe(502);
      expect(error.code).toBe('provider_error');
      expect(error.errorClass).toBe(ErrorClass.SERVER_ERROR);
      expect(error.retryable).toBe(false);
      expect(error.providerName).toBe('anthropic');
    });

    it('accepts custom parameters', () => {
      const providerResponse = { error: 'overloaded' };
      const error = new ProviderError(
        'Overloaded',
        'openai',
        529,
        ErrorClass.OVERLOADED,
        true,
        providerResponse
      );
      
      expect(error.statusCode).toBe(529);
      expect(error.errorClass).toBe(ErrorClass.OVERLOADED);
      expect(error.retryable).toBe(true);
      expect(error.providerResponse).toEqual(providerResponse);
    });
  });

  describe('RateLimitError', () => {
    it('has correct statusCode and is retryable', () => {
      const error = new RateLimitError();
      
      expect(error.statusCode).toBe(429);
      expect(error.code).toBe('rate_limit_exceeded');
      expect(error.errorClass).toBe(ErrorClass.RATE_LIMITED);
      expect(error.retryable).toBe(true);
      expect(error.message).toBe('Rate limit exceeded');
    });

    it('accepts custom message and retryAfter', () => {
      const error = new RateLimitError('Custom rate limit', 120);
      
      expect(error.message).toBe('Custom rate limit');
      expect(error.retryAfter).toBe(120);
    });
  });

  describe('TimeoutError', () => {
    it('has correct statusCode and is retryable', () => {
      const error = new TimeoutError();
      
      expect(error.statusCode).toBe(504);
      expect(error.code).toBe('timeout');
      expect(error.errorClass).toBe(ErrorClass.TIMEOUT);
      expect(error.retryable).toBe(true);
      expect(error.message).toBe('Request timeout');
    });

    it('accepts custom message', () => {
      const error = new TimeoutError('Gateway timeout');
      expect(error.message).toBe('Gateway timeout');
    });
  });

  describe('ValidationError', () => {
    it('has correct statusCode and is not retryable', () => {
      const error = new ValidationError('Invalid input');
      
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe('validation_error');
      expect(error.errorClass).toBe(ErrorClass.INVALID_REQUEST);
      expect(error.retryable).toBe(false);
    });

    it('accepts validation details', () => {
      const details = { field: 'temperature', issue: 'must be between 0 and 2' };
      const error = new ValidationError('Validation failed', details);
      
      expect(error.details).toEqual(details);
    });
  });

  describe('AuthError', () => {
    it('has correct statusCode and is not retryable', () => {
      const error = new AuthError();
      
      expect(error.statusCode).toBe(401);
      expect(error.code).toBe('auth_failed');
      expect(error.errorClass).toBe(ErrorClass.AUTH_FAILED);
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('Authentication failed');
    });

    it('accepts custom message', () => {
      const error = new AuthError('Invalid API key');
      expect(error.message).toBe('Invalid API key');
    });
  });

  describe('BudgetError', () => {
    it('has correct statusCode and is not retryable', () => {
      const error = new BudgetError();
      
      expect(error.statusCode).toBe(403);
      expect(error.code).toBe('budget_exceeded');
      expect(error.errorClass).toBe(ErrorClass.BUDGET_EXCEEDED);
      expect(error.retryable).toBe(false);
      expect(error.message).toBe('Budget limit exceeded');
    });
  });

  describe('ConfigError', () => {
    it('is a standard Error with optional field', () => {
      const error = new ConfigError('Invalid config', 'server.port');
      
      expect(error.message).toBe('Invalid config');
      expect(error.field).toBe('server.port');
      expect(error.name).toBe('ConfigError');
      expect(error).toBeInstanceOf(Error);
    });

    it('works without field', () => {
      const error = new ConfigError('General config error');
      expect(error.field).toBeUndefined();
    });
  });
});

describe('classifyError', () => {
  it('returns errorClass from ProxyError instances', () => {
    const error = new RateLimitError();
    expect(classifyError(error)).toBe(ErrorClass.RATE_LIMITED);
  });

  describe('HTTP status-based classification', () => {
    it('classifies 429 as RATE_LIMITED', () => {
      expect(classifyError({ status: 429 })).toBe(ErrorClass.RATE_LIMITED);
    });

    it('classifies 401 as AUTH_FAILED', () => {
      expect(classifyError({ status: 401 })).toBe(ErrorClass.AUTH_FAILED);
    });

    it('classifies 403 as AUTH_FAILED', () => {
      expect(classifyError({ status: 403 })).toBe(ErrorClass.AUTH_FAILED);
    });

    it('classifies 400 as INVALID_REQUEST', () => {
      expect(classifyError({ status: 400 })).toBe(ErrorClass.INVALID_REQUEST);
    });

    it('classifies 413 as CONTEXT_TOO_LONG', () => {
      expect(classifyError({ status: 413 })).toBe(ErrorClass.CONTEXT_TOO_LONG);
    });

    it('classifies 504 as TIMEOUT', () => {
      expect(classifyError({ status: 504 })).toBe(ErrorClass.TIMEOUT);
    });

    it('classifies 408 as TIMEOUT', () => {
      expect(classifyError({ status: 408 })).toBe(ErrorClass.TIMEOUT);
    });

    it('classifies 529 as OVERLOADED', () => {
      expect(classifyError({ status: 529 })).toBe(ErrorClass.OVERLOADED);
    });

    it('classifies 500-599 (except specific) as SERVER_ERROR', () => {
      expect(classifyError({ status: 500 })).toBe(ErrorClass.SERVER_ERROR);
      expect(classifyError({ status: 502 })).toBe(ErrorClass.SERVER_ERROR);
      expect(classifyError({ status: 503 })).toBe(ErrorClass.SERVER_ERROR);
    });
  });

  describe('Provider-specific error body classification', () => {
    it('classifies Anthropic overloaded error', () => {
      const error = {
        type: 'overloaded_error',
        message: 'Overloaded',
      };
      expect(classifyError(error)).toBe(ErrorClass.OVERLOADED);
    });

    it('classifies OpenAI rate limit error', () => {
      const error = {
        error: {
          message: 'Rate limit exceeded for requests',
          type: 'rate_limit_error',
        },
      };
      expect(classifyError(error.error)).toBe(ErrorClass.RATE_LIMITED);
    });

    it('classifies rate limit from message', () => {
      const error = { message: 'Rate limit exceeded' };
      expect(classifyError(error)).toBe(ErrorClass.RATE_LIMITED);
    });

    it('classifies timeout from message', () => {
      const error = { message: 'Request timeout occurred' };
      expect(classifyError(error)).toBe(ErrorClass.TIMEOUT);
    });

    it('classifies context too long from message', () => {
      const error = { message: 'Context is too long' };
      expect(classifyError(error)).toBe(ErrorClass.CONTEXT_TOO_LONG);
    });

    it('classifies content filter from message', () => {
      const error = { message: 'Content filtered by safety system' };
      expect(classifyError(error)).toBe(ErrorClass.CONTENT_FILTERED);
    });

    it('classifies auth failure from message', () => {
      expect(classifyError({ message: 'Invalid API key' })).toBe(ErrorClass.AUTH_FAILED);
      expect(classifyError({ message: 'Unauthorized access' })).toBe(ErrorClass.AUTH_FAILED);
      expect(classifyError({ message: 'Authentication failed' })).toBe(ErrorClass.AUTH_FAILED);
    });

    it('classifies invalid request from message', () => {
      expect(classifyError({ message: 'Invalid parameter temperature' })).toBe(ErrorClass.INVALID_REQUEST);
      expect(classifyError({ message: 'Validation error: missing field' })).toBe(ErrorClass.INVALID_REQUEST);
    });
  });

  describe('Node.js error classification', () => {
    it('classifies TimeoutError by name', () => {
      const error = new Error('Something timed out');
      error.name = 'TimeoutError';
      expect(classifyError(error)).toBe(ErrorClass.TIMEOUT);
    });

    it('classifies timeout from message', () => {
      const error = new Error('socket timeout');
      expect(classifyError(error)).toBe(ErrorClass.TIMEOUT);
    });

    it('classifies ECONNREFUSED as TIMEOUT', () => {
      const error = new Error('connect ECONNREFUSED 127.0.0.1:3000');
      expect(classifyError(error)).toBe(ErrorClass.TIMEOUT);
    });

    it('classifies ETIMEDOUT as TIMEOUT', () => {
      const error = new Error('connect ETIMEDOUT');
      expect(classifyError(error)).toBe(ErrorClass.TIMEOUT);
    });
  });

  it('returns UNKNOWN for unclassifiable errors', () => {
    expect(classifyError(new Error('Random error'))).toBe(ErrorClass.UNKNOWN);
    expect(classifyError({ foo: 'bar' })).toBe(ErrorClass.UNKNOWN);
    expect(classifyError('string error')).toBe(ErrorClass.UNKNOWN);
    expect(classifyError(null)).toBe(ErrorClass.UNKNOWN);
  });
});

describe('toHttpResponse', () => {
  it('produces correct HTTP response shape', () => {
    const error = new RateLimitError('Too many requests', 60);
    const response = toHttpResponse(error);
    
    expect(response.status).toBe(429);
    expect(response.body).toEqual({
      error: {
        message: 'Too many requests',
        code: 'rate_limit_exceeded',
        type: ErrorClass.RATE_LIMITED,
        retryable: true,
        retryAfter: 60,
      },
    });
  });

  it('omits retryAfter when undefined', () => {
    const error = new ValidationError('Invalid input');
    const response = toHttpResponse(error);
    
    expect(response.body.error).not.toHaveProperty('retryAfter');
    expect(response.body).toEqual({
      error: {
        message: 'Invalid input',
        code: 'validation_error',
        type: ErrorClass.INVALID_REQUEST,
        retryable: false,
      },
    });
  });

  it('handles all error types correctly', () => {
    const testCases: Array<[ProxyError, number, boolean]> = [
      [new RateLimitError(), 429, true],
      [new TimeoutError(), 504, true],
      [new ValidationError('Bad'), 400, false],
      [new AuthError(), 401, false],
      [new BudgetError(), 403, false],
      [new ProviderError('Failed', 'test', 502), 502, false],
    ];

    for (const [error, expectedStatus, expectedRetryable] of testCases) {
      const response = toHttpResponse(error);
      expect(response.status).toBe(expectedStatus);
      expect(response.body.error.retryable).toBe(expectedRetryable);
      expect(response.body.error.type).toBe(error.errorClass);
    }
  });

  it('satisfies ErrorResponseBody type', () => {
    const error = new TimeoutError();
    const response = toHttpResponse(error);
    
    // Type check: this should compile
    const body: ErrorResponseBody = response.body;
    expect(body.error.message).toBe('Request timeout');
    expect(body.error.code).toBe('timeout');
    expect(body.error.type).toBe(ErrorClass.TIMEOUT);
    expect(body.error.retryable).toBe(true);
  });
});
