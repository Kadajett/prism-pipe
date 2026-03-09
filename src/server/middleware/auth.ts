/**
 * API key authentication middleware
 */

import crypto from "node:crypto"
import type { Request, Response, NextFunction } from "express"
import type { AuthConfig } from "../../config/schema.js"
import { AuthError } from "../../core/errors.js"

/** Extend Express Request with auth context */
declare global {
  namespace Express {
    interface Request {
      apiKey?: string
      tenantId?: string
    }
  }
}

export interface AuthMiddlewareOptions {
  config: AuthConfig
}

/**
 * Extracts API key from request headers
 * Checks Authorization: Bearer <key> or x-api-key: <key>
 */
export function extractApiKey(req: Request): string | null {
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }

  const apiKeyHeader = req.headers["x-api-key"]
  if (typeof apiKeyHeader === "string") {
    return apiKeyHeader
  }

  return null
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid leaking length info via timing
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(a))
    return false
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/**
 * Auth middleware factory
 * If auth is disabled or no API key configured → open proxy mode
 * Otherwise validates API key from request headers
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  const { config } = options

  return (req: Request, res: Response, next: NextFunction) => {
    // Open proxy mode: no auth configured
    if (!config.enabled || !config.apiKey) {
      return next()
    }

    const providedKey = extractApiKey(req)

    if (!providedKey) {
      const error = new AuthError("Missing API key")
      return res.status(401).json({
        error: {
          type: "authentication_error",
          message: error.message,
        },
      })
    }

    if (!timingSafeCompare(providedKey, config.apiKey)) {
      const error = new AuthError("Invalid API key")
      return res.status(401).json({
        error: {
          type: "authentication_error",
          message: error.message,
        },
      })
    }

    // Attach API key and tenant context
    req.apiKey = providedKey
    req.tenantId = "default"

    next()
  }
}
