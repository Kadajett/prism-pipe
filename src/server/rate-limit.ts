import type { NextFunction, Request, Response } from 'express';
import type { TokenBucket } from '../rate-limit/token-bucket';

/**
 * Express middleware that enforces rate limiting via a TokenBucket.
 * Rejects requests without an identifiable IP to prevent shared-bucket abuse.
 */
export function createRateLimitMiddleware(bucket: TokenBucket) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip rate limiting for health/models
    if (req.path === '/health' || req.path === '/v1/models') {
      next();
      return;
    }

    const ip = req.ip ?? req.socket.remoteAddress;
    if (!ip) {
      res.status(400).json({
        error: {
          message: 'Unable to identify client IP for rate limiting',
          type: 'request_error',
          code: 'missing_client_ip',
        },
      });
      return;
    }

    const key = `ip:${ip}`;
    const result = await bucket.check(key);

    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));

    if (!result.allowed) {
      const retryAfter = Math.ceil((result.retryAfterMs ?? 1000) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: {
          message: 'Rate limit exceeded',
          type: 'rate_limit_error',
          code: 'rate_limit_exceeded',
          retryAfter,
        },
      });
      return;
    }

    next();
  };
}
