import type { Request, Response, NextFunction } from 'express';
import type { TokenBucket } from '../rate-limit/token-bucket.js';

/**
 * Express middleware that enforces rate limiting via a TokenBucket.
 */
export function createRateLimitMiddleware(bucket: TokenBucket) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip rate limiting for health/models
    if (req.path === '/health' || req.path === '/v1/models') {
      next();
      return;
    }

    const key = `ip:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
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
