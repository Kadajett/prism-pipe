/**
 * Error handler middleware
 * Maps error classes to HTTP status codes with structured JSON responses
 */
import type { NextFunction, Request, Response } from 'express';
import { getAppLogger } from '../../logging/app-logger';
import type { ErrorResponse, PrismError } from '../../types/index';

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
  // biome-ignore lint/correctness/noUnusedFunctionParameters: Express requires 4 params for error handler
  _next: NextFunction
): void {
  // Check if this is a PrismError with additional metadata
  const isPrismError = 'code' in err && 'type' in err;

  const statusCode = isPrismError ? (err as PrismError).statusCode || 500 : 500;

  const errorType = isPrismError ? (err as PrismError).type : 'internal_error';

  const errorCode = isPrismError ? (err as PrismError).code : 'INTERNAL_ERROR';

  const retryAfter = isPrismError ? (err as PrismError).retryAfter : undefined;

  // Never leak stack traces in production
  const _message = process.env.NODE_ENV === 'production' ? err.message : err.stack || err.message;

  // Log error with request context
  getAppLogger().error(
    {
      reqId: req.id,
      errorType,
      code: errorCode,
      ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
    },
    err.message
  );

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
