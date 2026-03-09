/**
 * Error classes: ProxyError, ProviderError, TimeoutError, etc.
 * ErrorClass enum, classifyError(), and toHttpResponse() utilities.
 */

export enum ErrorClass {
  RATE_LIMITED = 'rate_limited',
  AUTH_FAILED = 'auth_failed',
  INVALID_REQUEST = 'invalid_request',
  CONTEXT_TOO_LONG = 'context_too_long',
  TIMEOUT = 'timeout',
  OVERLOADED = 'overloaded',
  SERVER_ERROR = 'server_error',
  CONTENT_FILTERED = 'content_filtered',
  BUDGET_EXCEEDED = 'budget_exceeded',
  UNKNOWN = 'unknown',
}

export class ProxyError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number,
    public errorClass: ErrorClass,
    public retryable: boolean = false,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = 'ProxyError';
  }
}

export class ProviderError extends ProxyError {
  public providerResponse?: unknown;

  constructor(
    message: string,
    public providerName: string,
    statusCode: number = 502,
    errorClass: ErrorClass = ErrorClass.SERVER_ERROR,
    retryable: boolean = false,
    providerResponse?: unknown,
  ) {
    super(message, 'provider_error', statusCode, errorClass, retryable);
    this.name = 'ProviderError';
    this.providerResponse = providerResponse;
  }
}

export class RateLimitError extends ProxyError {
  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 'rate_limit_exceeded', 429, ErrorClass.RATE_LIMITED, true, retryAfter);
    this.name = 'RateLimitError';
  }
}

export class TimeoutError extends ProxyError {
  constructor(message: string = 'Request timeout') {
    super(message, 'timeout', 504, ErrorClass.TIMEOUT, true);
    this.name = 'TimeoutError';
  }
}

export class ValidationError extends ProxyError {
  public details?: Record<string, string>;

  constructor(message: string, details?: Record<string, string>) {
    super(message, 'validation_error', 400, ErrorClass.INVALID_REQUEST, false);
    this.name = 'ValidationError';
    this.details = details;
  }
}

export class AuthError extends ProxyError {
  constructor(message: string = 'Authentication failed') {
    super(message, 'auth_failed', 401, ErrorClass.AUTH_FAILED, false);
    this.name = 'AuthError';
  }
}

export class BudgetError extends ProxyError {
  constructor(message: string = 'Budget limit exceeded') {
    super(message, 'budget_exceeded', 403, ErrorClass.BUDGET_EXCEEDED, false);
    this.name = 'BudgetError';
  }
}

export class ConfigError extends Error {
  public field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
  }
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

export function classifyError(err: unknown): ErrorClass {
  if (err instanceof ProxyError) {
    return err.errorClass;
  }

  if (err == null || typeof err === 'string' || typeof err === 'number') {
    return ErrorClass.UNKNOWN;
  }

  const obj = err as Record<string, unknown>;

  // HTTP status-based
  if (typeof obj.status === 'number') {
    const s = obj.status;
    if (s === 429) return ErrorClass.RATE_LIMITED;
    if (s === 401 || s === 403) return ErrorClass.AUTH_FAILED;
    if (s === 400) return ErrorClass.INVALID_REQUEST;
    if (s === 413) return ErrorClass.CONTEXT_TOO_LONG;
    if (s === 504 || s === 408) return ErrorClass.TIMEOUT;
    if (s === 529) return ErrorClass.OVERLOADED;
    if (s >= 500 && s < 600) return ErrorClass.SERVER_ERROR;
  }

  // Anthropic type field
  if (typeof obj.type === 'string') {
    if (obj.type === 'overloaded_error') return ErrorClass.OVERLOADED;
    if (obj.type === 'rate_limit_error') return ErrorClass.RATE_LIMITED;
  }

  // Error name
  if (err instanceof Error && err.name === 'TimeoutError') {
    return ErrorClass.TIMEOUT;
  }

  // Message-based classification
  const message = typeof obj.message === 'string' ? obj.message.toLowerCase() : '';
  if (message) {
    if (/rate.?limit/i.test(message)) return ErrorClass.RATE_LIMITED;
    if (/timeout|timed.?out|etimedout|econnrefused/i.test(message)) return ErrorClass.TIMEOUT;
    if (/context.*(too long|length)|too long/i.test(message)) return ErrorClass.CONTEXT_TOO_LONG;
    if (/content.?filter|safety/i.test(message)) return ErrorClass.CONTENT_FILTERED;
    if (/invalid.?(api|key)|unauthorized|auth.*fail/i.test(message)) return ErrorClass.AUTH_FAILED;
    if (/invalid|validation/i.test(message)) return ErrorClass.INVALID_REQUEST;
  }

  return ErrorClass.UNKNOWN;
}

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
