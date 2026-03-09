/**
 * Error taxonomy and classes for the proxy system.
 * Maps internal errors to HTTP responses and classifies provider errors.
 */

export enum ErrorClass {
  RATE_LIMITED = 'rate_limited',
  SERVER_ERROR = 'server_error',
  TIMEOUT = 'timeout',
  OVERLOADED = 'overloaded',
  CONTEXT_TOO_LONG = 'context_too_long',
  CONTENT_FILTERED = 'content_filtered',
  AUTH_FAILED = 'auth_failed',
  INVALID_REQUEST = 'invalid_request',
  BUDGET_EXCEEDED = 'budget_exceeded',
  UNKNOWN = 'unknown',
}

export interface ErrorResponseBody {
  error: {
    message: string;
    code: string;
    type: ErrorClass;
    retryable: boolean;
    retryAfter?: number;
  };
}

/**
 * Base error class for all proxy errors
 */
export class ProxyError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly retryable: boolean;
  public readonly retryAfter?: number;
  public readonly errorClass: ErrorClass;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    errorClass: ErrorClass,
    retryable: boolean = false,
    retryAfter?: number
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.errorClass = errorClass;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Upstream provider returned an error
 */
export class ProviderError extends ProxyError {
  public readonly providerName: string;
  public readonly providerResponse?: unknown;

  constructor(
    message: string,
    providerName: string,
    statusCode: number = 502,
    errorClass: ErrorClass = ErrorClass.SERVER_ERROR,
    retryable: boolean = false,
    providerResponse?: unknown
  ) {
    super(message, 'provider_error', statusCode, errorClass, retryable);
    this.providerName = providerName;
    this.providerResponse = providerResponse;
  }
}

/**
 * Rate limit exceeded (429)
 */
export class RateLimitError extends ProxyError {
  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 'rate_limit_exceeded', 429, ErrorClass.RATE_LIMITED, true, retryAfter);
  }
}

/**
 * Request or provider timeout (504)
 */
export class TimeoutError extends ProxyError {
  constructor(message: string = 'Request timeout') {
    super(message, 'timeout', 504, ErrorClass.TIMEOUT, true);
  }
}

/**
 * Bad request from client (400)
 */
export class ValidationError extends ProxyError {
  public readonly details?: unknown;

  constructor(message: string, details?: unknown) {
    super(message, 'validation_error', 400, ErrorClass.INVALID_REQUEST, false);
    this.details = details;
  }
}

/**
 * Invalid API key (401)
 */
export class AuthError extends ProxyError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'auth_failed', 401, ErrorClass.AUTH_FAILED, false);
  }
}

/**
 * Spend limit exceeded (403)
 */
export class BudgetError extends ProxyError {
  constructor(message: string = 'Budget limit exceeded') {
    super(message, 'budget_exceeded', 403, ErrorClass.BUDGET_EXCEEDED, false);
  }
}

/**
 * Invalid configuration (startup error)
 */
export class ConfigError extends Error {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Classify any error into the error taxonomy
 */
export function classifyError(error: unknown): ErrorClass {
  // Already classified
  if (error instanceof ProxyError) {
    return error.errorClass;
  }

  // HTTP status-based classification
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    
    if (status === 429) return ErrorClass.RATE_LIMITED;
    if (status === 401 || status === 403) return ErrorClass.AUTH_FAILED;
    if (status === 400) return ErrorClass.INVALID_REQUEST;
    if (status === 413) return ErrorClass.CONTEXT_TOO_LONG;
    if (status === 504 || status === 408) return ErrorClass.TIMEOUT;
    if (status === 529) return ErrorClass.OVERLOADED;
    if (status >= 500) return ErrorClass.SERVER_ERROR;
  }

  // Provider-specific error body classification
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>;
    
    // Check error message/type for known patterns
    const message = String(errorObj.message || errorObj.error || '').toLowerCase();
    const type = String(errorObj.type || '').toLowerCase();
    
    if (message.includes('rate limit') || type.includes('rate_limit')) {
      return ErrorClass.RATE_LIMITED;
    }
    if (message.includes('overloaded') || type.includes('overload')) {
      return ErrorClass.OVERLOADED;
    }
    if (message.includes('timeout') || type.includes('timeout')) {
      return ErrorClass.TIMEOUT;
    }
    if (message.includes('context') && message.includes('too long')) {
      return ErrorClass.CONTEXT_TOO_LONG;
    }
    if (message.includes('content') && message.includes('filter')) {
      return ErrorClass.CONTENT_FILTERED;
    }
    if (message.includes('auth') || message.includes('api key') || message.includes('unauthorized')) {
      return ErrorClass.AUTH_FAILED;
    }
    if (message.includes('invalid') || message.includes('validation')) {
      return ErrorClass.INVALID_REQUEST;
    }
  }

  // Node.js timeout errors
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
      return ErrorClass.TIMEOUT;
    }
    if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
      return ErrorClass.TIMEOUT;
    }
  }

  return ErrorClass.UNKNOWN;
}

/**
 * Convert a ProxyError to an HTTP response
 */
export function toHttpResponse(error: ProxyError): {
  status: number;
  body: ErrorResponseBody;
} {
  return {
    status: error.statusCode,
    body: {
      error: {
        message: error.message,
        code: error.code,
        type: error.errorClass,
        retryable: error.retryable,
        ...(error.retryAfter !== undefined && { retryAfter: error.retryAfter }),
      },
    },
  };
}
