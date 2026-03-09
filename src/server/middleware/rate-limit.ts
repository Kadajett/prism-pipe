/**
 * Rate limit middleware using token bucket
 */

import type { Request, Response, NextFunction } from "express"
import type { Store } from "../../store/interface.js"
import type { RateLimitConfig } from "../../config/schema.js"
import { TokenBucket } from "../../rate-limit/token-bucket.js"
import { RateLimitError } from "../../core/errors.js"

export interface RateLimitMiddlewareOptions {
  config: RateLimitConfig
  store: Store
}

/**
 * Determines the rate limit scope for a request
 * Can be global, per-API-key, or per-IP
 */
export function getRateLimitScope(req: Request): string {
  // Check for API key (set by auth middleware)
  const apiKey = (req as any).apiKey
  if (apiKey) {
    return `api-key:${apiKey}`
  }

  // Fall back to IP address
  const ip = req.ip || req.socket?.remoteAddress || "unknown"
  return `ip:${ip}`
}

/**
 * Rate limit middleware factory
 * Checks token bucket before allowing request through
 * Adds X-RateLimit-* headers to all responses
 */
export function createRateLimitMiddleware(options: RateLimitMiddlewareOptions) {
  const { config, store } = options

  // If rate limiting is disabled, just pass through
  if (!config.enabled) {
    return (_req: Request, _res: Response, next: NextFunction) => {
      next()
    }
  }

  // Default config: 60 requests per minute = 1 req/sec
  const capacity = config.capacity ?? 60
  const refillRate = config.refillRate ?? 1 // tokens per second

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getRateLimitScope(req)

      const bucket = new TokenBucket(
        {
          capacity,
          refillRate,
          scope,
        },
        store,
      )

      const result = await bucket.consume(1)

      // Add rate limit headers to response
      res.setHeader("X-RateLimit-Limit", capacity.toString())
      res.setHeader("X-RateLimit-Remaining", result.remaining.toString())
      res.setHeader("X-RateLimit-Reset", Math.floor(result.resetAt / 1000).toString())

      if (!result.allowed) {
        if (result.retryAfter) {
          res.setHeader("Retry-After", Math.ceil(result.retryAfter).toString())
        }

        const error = new RateLimitError(
          "Rate limit exceeded",
          result.retryAfter ? Math.ceil(result.retryAfter) : undefined,
        )

        return res.status(429).json({
          error: {
            type: "rate_limit_error",
            message: error.message,
            retryAfter: result.retryAfter,
          },
        })
      }

      next()
    } catch (error) {
      next(error)
    }
  }
}
