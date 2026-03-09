import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const MIN_API_KEY_LENGTH = 32;

/**
 * Validate API keys meet minimum entropy requirements.
 * Call at config load time to fail fast on weak keys.
 */
export function validateApiKeys(keys: string[]): void {
  for (const key of keys) {
    if (key.length < MIN_API_KEY_LENGTH) {
      throw new Error(
        `API key too short (${key.length} chars). Minimum ${MIN_API_KEY_LENGTH} characters required for security.`,
      );
    }
  }
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Compare against itself to burn same CPU time, then return false
    const buf = Buffer.from(a);
    crypto.timingSafeEqual(buf, buf);
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Auth middleware — validates that the request has a valid API key.
 * In zero-config mode (no auth keys configured), all requests pass through.
 */
export function createAuthMiddleware(apiKeys?: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip auth for health/models endpoints
    if (req.path === '/health' || req.path === '/v1/models') {
      next();
      return;
    }

    // No keys configured = open access (zero-config mode)
    if (!apiKeys || apiKeys.length === 0) {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const xApiKey = req.headers['x-api-key'] as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (authHeader ?? xApiKey);

    if (!token) {
      res.status(401).json({
        error: {
          message: 'Missing Authorization header or x-api-key',
          type: 'auth_error',
          code: 'missing_api_key',
        },
      });
      return;
    }

    const isValid = apiKeys.some((key) => timingSafeCompare(token, key));
    if (!isValid) {
      res.status(401).json({
        error: { message: 'Invalid API key', type: 'auth_error', code: 'invalid_api_key' },
      });
      return;
    }

    next();
  };
}
