/**
 * Error handler middleware
 * Maps error classes to HTTP status codes with structured JSON responses
 */
import type { Request, Response, NextFunction } from 'express';
import type { PrismError, ErrorResponse } from '../../types/index.js';

const ERROR_TYPE_MAP: Record<string, number> = {
  validation_error: 400,
  authentication_error: 401,
  permission_denied: 403,
  not_found: 404,
  rate_limit_exceeded: 429,
  provider_error: 502,
  timeout_error: 504,
  internal_error: 500,
};

export function errorHandler(
  err: Error | PrismError,
  req: Request,
  res: Response,
  // biome-ignore lint/suspicious/noUnusedParameters: Express requires 4 params for error handler
  next: NextFunction
): void {
  // Check if this is a PrismError with additional metadata
  const isPrismError = 'code' in err && 'type' in err;

  const statusCode = isPrismError
    ? (err as PrismError).statusCode || 500
    : 500;

  const errorType = isPrismError
    ? (err as PrismError).type
    : 'internal_error';

  const errorCode = isPrismError
    ? (err as PrismError).code
    : 'INTERNAL_ERROR';

  const retryAfter = isPrismError
    ? (err as PrismError).retryAfter
    : undefined;

  // Never leak stack traces in production
  const message =
    process.env.NODE_ENV === 'production'
      ? err.message
      : err.stack || err.message;

  // Log error with request context
  console.error({
    requestId: req.id,
    error: errorType,
    code: errorCode,
    message: err.message,
    stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
  });

  const errorResponse: ErrorResponse = {
    error: {
      type: errorType,
      message: err.message,
      code: errorCode,
      request_id: req.id,
      ...(retryAfter && { retry_after: retryAfter }),
    },
  };

  res.status(statusCode).json(errorResponse);
}

/**
 * Create a PrismError
 */
export function createError(
  type: string,
  message: string,
  code: string,
  retryAfter?: number
): PrismError {
  const error = new Error(message) as PrismError;
  error.type = type;
  error.code = code;
  error.statusCode = ERROR_TYPE_MAP[type] || 500;
  if (retryAfter) {
    error.retryAfter = retryAfter;
  }
  return error;
}
