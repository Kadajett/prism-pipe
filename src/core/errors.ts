/**
 * Error classification and typed error classes for Prism Pipe.
 */

export enum ErrorClass {
  RATE_LIMITED = 'rate_limited',
  AUTH_FAILED = 'auth_failed',
  INVALID_REQUEST = 'invalid_request',
  CONTEXT_TOO_LONG = 'context_too_long',
  TIMEOUT = 'timeout',
  OVERLOADED = 'overloaded',
  SERVER_ERROR = 'server_error',
  BUDGET_EXCEEDED = 'budget_exceeded',
  CONTENT_FILTERED = 'content_filtered',
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
 * Base proxy error with classification metadata.
 */
export class ProxyError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly errorClass: ErrorClass;
  public readonly retryable: boolean;
  public readonly retryAfter?: number;

  constructor(
    message: string,
    code: string,
    statusCode: number,
    errorClass: ErrorClass,
    retryable = false,
    retryAfter?: number,
  ) {
    super(message);
    this.name = 'ProxyError';
    this.code = code;
    this.statusCode = statusCode;
    this.errorClass = errorClass;
    this.retryable = retryable;
    this.retryAfter = retryAfter;
  }
}

export class ProviderError extends ProxyError {
  public readonly providerName: string;
  public readonly providerResponse?: unknown;

  constructor(
    message: string,
    providerName: string,
    statusCode = 502,
    errorClass = ErrorClass.SERVER_ERROR,
    retryable = false,
    providerResponse?: unknown,
  ) {
    super(message, 'provider_error', statusCode, errorClass, retryable);
    this.name = 'ProviderError';
    this.providerName = providerName;
    this.providerResponse = providerResponse;
  }
}

export class RateLimitError extends ProxyError {
  constructor(message = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 'rate_limit_exceeded', 429, ErrorClass.RATE_LIMITED, true, retryAfter);
    this.name = 'RateLimitError';
  }
}

export class TimeoutError extends ProxyError {
  constructor(message = 'Request timeout') {
    super(message, 'timeout', 504, ErrorClass.TIMEOUT, true);
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends ProxyError {
  public readonly details?: Record<string, string>;

  constructor(message: string, details?: Record<string, string>) {
    super(message, 'validation_error', 400, ErrorClass.INVALID_REQUEST, false);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class AuthError extends ProxyError {
  constructor(message = 'Authentication failed') {
    super(message, 'auth_failed', 401, ErrorClass.AUTH_FAILED, false);
    this.name = 'AuthError';
  }
}

export class BudgetError extends ProxyError {
  constructor(message = 'Budget limit exceeded') {
    super(message, 'budget_exceeded', 403, ErrorClass.BUDGET_EXCEEDED, false);
    this.name = 'BudgetError';
  }
}

export class ConfigError extends Error {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
  }
}

/**
 * Classify an error into an ErrorClass.
 */
export function classifyError(err: unknown): ErrorClass {
  if (err == null) return ErrorClass.UNKNOWN;

  // ProxyError instances
  if (err instanceof ProxyError) return err.errorClass;

  // Object with status code
  if (typeof err === 'object' && 'status' in err) {
    const status = (err as { status: number }).status;
    if (status === 429) return ErrorClass.RATE_LIMITED;
    if (status === 401 || status === 403) return ErrorClass.AUTH_FAILED;
    if (status === 400) return ErrorClass.INVALID_REQUEST;
    if (status === 413) return ErrorClass.CONTEXT_TOO_LONG;
    if (status === 504 || status === 408) return ErrorClass.TIMEOUT;
    if (status === 529) return ErrorClass.OVERLOADED;
    if (status >= 500 && status < 600) return ErrorClass.SERVER_ERROR;
  }

  // Error with name
  if (err instanceof Error) {
    if (err.name === 'TimeoutError') return ErrorClass.TIMEOUT;
  }

  // Object/Error with message or type
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;

    // Anthropic-style type field
    if (typeof obj.type === 'string') {
      if (obj.type.includes('overloaded')) return ErrorClass.OVERLOADED;
      if (obj.type.includes('rate_limit')) return ErrorClass.RATE_LIMITED;
    }

    // Message-based classification
    const message = typeof obj.message === 'string' ? obj.message.toLowerCase() : '';
    if (message) {
      if (message.includes('rate limit')) return ErrorClass.RATE_LIMITED;
      if (message.includes('timeout') || message.includes('timed out') || message.includes('etimedout') || message.includes('econnrefused')) return ErrorClass.TIMEOUT;
      if (message.includes('context') && message.includes('long')) return ErrorClass.CONTEXT_TOO_LONG;
      if (message.includes('filter') || message.includes('safety')) return ErrorClass.CONTENT_FILTERED;
      if (message.includes('api key') || message.includes('unauthorized') || message.includes('authentication')) return ErrorClass.AUTH_FAILED;
      if (message.includes('invalid') || message.includes('validation')) return ErrorClass.INVALID_REQUEST;
    }
  }

  return ErrorClass.UNKNOWN;
}

/**
 * Convert a ProxyError to an HTTP response shape.
 */
export function toHttpResponse(error: ProxyError): { status: number; body: ErrorResponseBody } {
  const body: ErrorResponseBody = {
    error: {
      message: error.message,
      code: error.code,
      type: error.errorClass,
      retryable: error.retryable,
    },
  };
  if (error.retryAfter !== undefined) {
    body.error.retryAfter = error.retryAfter;
  }
  return { status: error.statusCode, body };
}
