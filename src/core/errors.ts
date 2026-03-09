/**
 * Error taxonomy and classification system for prism-pipe
 *
 * Maps all possible errors (HTTP statuses, provider errors, Node.js errors)
 * into a canonical taxonomy with HTTP status codes and retry policies.
 */

/**
 * Error classification taxonomy
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

/**
 * Base error class for all proxy errors
 */
export class ProxyError extends Error {
  code: string;
  statusCode: number;
  retryable: boolean;
  retryAfter?: number;
  errorClass: ErrorClass;

  constructor(
    message: string,
    options: {
      code: string;
      statusCode: number;
      retryable?: boolean;
      retryAfter?: number;
      errorClass?: ErrorClass;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.retryable = options.retryable ?? false;
    this.retryAfter = options.retryAfter;
    this.errorClass = options.errorClass ?? ErrorClass.UNKNOWN;

    // Maintains proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Provider returned an error
 */
export class ProviderError extends ProxyError {
  provider: string;
  providerCode?: string;
  providerMessage?: string;

  constructor(
    message: string,
    options: {
      provider: string;
      providerCode?: string;
      providerMessage?: string;
      statusCode: number;
      retryable?: boolean;
      errorClass?: ErrorClass;
      cause?: unknown;
    }
  ) {
    super(message, {
      code: 'PROVIDER_ERROR',
      statusCode: options.statusCode,
      retryable: options.retryable,
      errorClass: options.errorClass ?? ErrorClass.SERVER_ERROR,
      cause: options.cause,
    });
    this.provider = options.provider;
    this.providerCode = options.providerCode;
    this.providerMessage = options.providerMessage;
  }
}

/**
 * Rate limit exceeded (429)
 */
export class RateLimitError extends ProxyError {
  limit?: number;
  remaining: number;
  resetAt?: Date;

  constructor(
    message: string,
    options?: {
      limit?: number;
      remaining?: number;
      resetAt?: Date;
      retryAfter?: number;
      cause?: unknown;
    }
  ) {
    super(message, {
      code: 'RATE_LIMITED',
      statusCode: 429,
      retryable: true,
      retryAfter: options?.retryAfter,
      errorClass: ErrorClass.RATE_LIMITED,
      cause: options?.cause,
    });
    this.limit = options?.limit;
    this.remaining = options?.remaining ?? 0;
    this.resetAt = options?.resetAt;
  }
}

/**
 * Request or provider timeout (504)
 */
export class TimeoutError extends ProxyError {
  timeoutMs: number;

  constructor(
    message: string,
    options: {
      timeoutMs: number;
      cause?: unknown;
    }
  ) {
    super(message, {
      code: 'TIMEOUT',
      statusCode: 504,
      retryable: true,
      errorClass: ErrorClass.TIMEOUT,
      cause: options.cause,
    });
    this.timeoutMs = options.timeoutMs;
  }
}

/**
 * Bad request from client (400)
 */
export class ValidationError extends ProxyError {
  field?: string;
  constraint?: string;

  constructor(
    message: string,
    options?: {
      field?: string;
      constraint?: string;
      cause?: unknown;
    }
  ) {
    super(message, {
      code: 'VALIDATION_ERROR',
      statusCode: 400,
      retryable: false,
      errorClass: ErrorClass.INVALID_REQUEST,
      cause: options?.cause,
    });
    this.field = options?.field;
    this.constraint = options?.constraint;
  }
}

/**
 * Invalid API key (401)
 */
export class AuthError extends ProxyError {
  constructor(
    message: string,
    options?: {
      cause?: unknown;
    }
  ) {
    super(message, {
      code: 'AUTH_FAILED',
      statusCode: 401,
      retryable: false,
      errorClass: ErrorClass.AUTH_FAILED,
      cause: options?.cause,
    });
  }
}

/**
 * Spend limit exceeded (403)
 */
export class BudgetError extends ProxyError {
  limit?: number;
  current: number;

  constructor(
    message: string,
    options: {
      limit?: number;
      current: number;
      cause?: unknown;
    }
  ) {
    super(message, {
      code: 'BUDGET_EXCEEDED',
      statusCode: 403,
      retryable: false,
      errorClass: ErrorClass.BUDGET_EXCEEDED,
      cause: options.cause,
    });
    this.limit = options.limit;
    this.current = options.current;
  }
}

/**
 * Invalid configuration (startup error)
 */
export class ConfigError extends ProxyError {
  configKey?: string;

  constructor(
    message: string,
    options?: {
      configKey?: string;
      cause?: unknown;
    }
  ) {
    super(message, {
      code: 'CONFIG_ERROR',
      statusCode: 500,
      retryable: false,
      errorClass: ErrorClass.INVALID_REQUEST,
      cause: options?.cause,
    });
    this.configKey = options?.configKey;
  }
}

/**
 * Context/prompt too long
 */
export class ContextLengthError extends ProxyError {
  maxTokens?: number;
  actualTokens?: number;

  constructor(
    message: string,
    options?: {
      maxTokens?: number;
      actualTokens?: number;
      cause?: unknown;
    }
  ) {
    super(message, {
      code: 'CONTEXT_TOO_LONG',
      statusCode: 400,
      retryable: false,
      errorClass: ErrorClass.CONTEXT_TOO_LONG,
      cause: options?.cause,
    });
    this.maxTokens = options?.maxTokens;
    this.actualTokens = options?.actualTokens;
  }
}

/**
 * Content filtered by safety system
 */
export class ContentFilterError extends ProxyError {
  constructor(
    message: string,
    options?: {
      cause?: unknown;
    }
  ) {
    super(message, {
      code: 'CONTENT_FILTERED',
      statusCode: 400,
      retryable: false,
      errorClass: ErrorClass.CONTENT_FILTERED,
      cause: options?.cause,
    });
  }
}

/**
 * Provider overloaded (529 or 503)
 */
export class OverloadedError extends ProxyError {
  constructor(
    message: string,
    options?: {
      retryAfter?: number;
      cause?: unknown;
    }
  ) {
    super(message, {
      code: 'OVERLOADED',
      statusCode: 503,
      retryable: true,
      retryAfter: options?.retryAfter,
      errorClass: ErrorClass.OVERLOADED,
      cause: options?.cause,
    });
  }
}

/**
 * HTTP error response body structure
 */
export interface ErrorResponseBody {
  error: {
    message: string;
    code: string;
    type: string;
    class: ErrorClass;
    retryable: boolean;
    retryAfter?: number;
    details?: Record<string, unknown>;
  };
}

/**
 * Classify any error into the error taxonomy
 */
export function classifyError(error: unknown): ErrorClass {
  // Already a ProxyError with classification
  if (error instanceof ProxyError) {
    return error.errorClass;
  }

  // HTTP status-based classification
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    return classifyHttpStatus(status);
  }

  // Provider error body patterns
  if (typeof error === 'object' && error !== null) {
    const errorObj = error as Record<string, unknown>;

    // Check error type/code fields
    const errorType = String(errorObj.type || errorObj.error_type || '').toLowerCase();
    const errorCode = String(errorObj.code || errorObj.error_code || '').toLowerCase();
    const errorMessage = String(errorObj.message || errorObj.error || '').toLowerCase();

    // Rate limit patterns
    if (
      errorType.includes('rate_limit') ||
      errorCode.includes('rate_limit') ||
      errorMessage.includes('rate limit') ||
      errorMessage.includes('too many requests')
    ) {
      return ErrorClass.RATE_LIMITED;
    }

    // Overloaded patterns (Anthropic uses "overloaded_error")
    if (
      errorType === 'overloaded_error' ||
      errorCode.includes('overload') ||
      errorMessage.includes('overloaded') ||
      errorMessage.includes('capacity')
    ) {
      return ErrorClass.OVERLOADED;
    }

    // Context length patterns
    if (
      errorType.includes('invalid_request') &&
      (errorMessage.includes('context') ||
        errorMessage.includes('too long') ||
        errorMessage.includes('token limit') ||
        errorMessage.includes('maximum context'))
    ) {
      return ErrorClass.CONTEXT_TOO_LONG;
    }

    // Content filter patterns
    if (
      errorType.includes('content_filter') ||
      errorCode.includes('content_filter') ||
      errorMessage.includes('content policy') ||
      errorMessage.includes('content filter')
    ) {
      return ErrorClass.CONTENT_FILTERED;
    }

    // Auth patterns
    if (
      errorType.includes('authentication') ||
      errorType.includes('auth') ||
      errorCode.includes('auth') ||
      errorMessage.includes('authentication') ||
      errorMessage.includes('invalid api key') ||
      errorMessage.includes('unauthorized')
    ) {
      return ErrorClass.AUTH_FAILED;
    }

    // Invalid request patterns
    if (
      errorType.includes('invalid_request') ||
      errorCode.includes('invalid') ||
      errorMessage.includes('invalid')
    ) {
      return ErrorClass.INVALID_REQUEST;
    }
  }

  // Node.js error codes
  if (error instanceof Error) {
    const nodeError = error as Error & { code?: string };
    if (nodeError.code) {
      switch (nodeError.code) {
        case 'ETIMEDOUT':
        case 'ESOCKETTIMEDOUT':
        case 'ECONNABORTED':
          return ErrorClass.TIMEOUT;
        case 'ECONNREFUSED':
        case 'ECONNRESET':
        case 'ENOTFOUND':
          return ErrorClass.SERVER_ERROR;
        default:
          break;
      }
    }
  }

  return ErrorClass.UNKNOWN;
}

/**
 * Classify HTTP status codes
 */
function classifyHttpStatus(status: number): ErrorClass {
  switch (status) {
    case 429:
      return ErrorClass.RATE_LIMITED;
    case 401:
    case 403:
      return ErrorClass.AUTH_FAILED;
    case 400:
      return ErrorClass.INVALID_REQUEST;
    case 408:
    case 504:
      return ErrorClass.TIMEOUT;
    case 503:
    case 529: // Some providers use 529 for overload
      return ErrorClass.OVERLOADED;
    case 500:
    case 502:
    case 505:
      return ErrorClass.SERVER_ERROR;
    default:
      if (status >= 400 && status < 500) {
        return ErrorClass.INVALID_REQUEST;
      }
      if (status >= 500) {
        return ErrorClass.SERVER_ERROR;
      }
      return ErrorClass.UNKNOWN;
  }
}

/**
 * Convert a ProxyError to HTTP response format
 */
export function toHttpResponse(error: ProxyError): {
  status: number;
  body: ErrorResponseBody;
} {
  const details: Record<string, unknown> = {};

  // Add error-specific details
  if (error instanceof RateLimitError) {
    if (error.limit !== undefined) details.limit = error.limit;
    details.remaining = error.remaining;
    if (error.resetAt) details.resetAt = error.resetAt.toISOString();
  } else if (error instanceof TimeoutError) {
    details.timeoutMs = error.timeoutMs;
  } else if (error instanceof ValidationError) {
    if (error.field) details.field = error.field;
    if (error.constraint) details.constraint = error.constraint;
  } else if (error instanceof BudgetError) {
    if (error.limit !== undefined) details.limit = error.limit;
    details.current = error.current;
  } else if (error instanceof ConfigError) {
    if (error.configKey) details.configKey = error.configKey;
  } else if (error instanceof ContextLengthError) {
    if (error.maxTokens) details.maxTokens = error.maxTokens;
    if (error.actualTokens) details.actualTokens = error.actualTokens;
  } else if (error instanceof ProviderError) {
    details.provider = error.provider;
    if (error.providerCode) details.providerCode = error.providerCode;
    if (error.providerMessage) details.providerMessage = error.providerMessage;
  }

  return {
    status: error.statusCode,
    body: {
      error: {
        message: error.message,
        code: error.code,
        type: error.name,
        class: error.errorClass,
        retryable: error.retryable,
        retryAfter: error.retryAfter,
        ...(Object.keys(details).length > 0 ? { details } : {}),
      },
    },
  };
}
