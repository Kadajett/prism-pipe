import type { Request, Response, NextFunction } from 'express';

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
    if (!authHeader) {
      res.status(401).json({
        error: { message: 'Missing Authorization header', type: 'auth_error', code: 'missing_api_key' },
      });
      return;
    }

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    if (!apiKeys.includes(token)) {
      res.status(401).json({
        error: { message: 'Invalid API key', type: 'auth_error', code: 'invalid_api_key' },
      });
      return;
    }

    next();
  };
}
