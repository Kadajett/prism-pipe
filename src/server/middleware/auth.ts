/**
 * API key authentication middleware
 */

import type { Request, Response, NextFunction } from "express"
import type { AuthConfig } from "../../config/schema.js"
import { AuthError } from "../../core/errors.js"

export interface AuthMiddlewareOptions {
  config: AuthConfig
}

/**
 * Extracts API key from request headers
 * Checks Authorization: Bearer <key> or x-api-key: <key>
 */
export function extractApiKey(req: Request): string | null {
  // Check Authorization header (Bearer token)
  const authHeader = req.headers.authorization
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7)
  }

  // Check x-api-key header
  const apiKeyHeader = req.headers["x-api-key"]
  if (typeof apiKeyHeader === "string") {
    return apiKeyHeader
  }

  return null
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

    if (providedKey !== config.apiKey) {
      const error = new AuthError("Invalid API key")
      return res.status(401).json({
        error: {
          type: "authentication_error",
          message: error.message,
        },
      })
    }

    // Attach tenant context (for future multi-tenant support)
    ;(req as any).tenantId = "default"

    next()
  }
}
