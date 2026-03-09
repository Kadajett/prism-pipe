/**
 * Express middleware for multi-tenant auth.
 * Attaches TenantContext to the request if authenticated.
 * Falls back to legacy API key auth if no TenantManager.
 */

import type { NextFunction, Request, Response } from 'express';
import type { TenantContext, TenantManager } from './tenant.js';

declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
    }
  }
}

export interface MultiTenantAuthOptions {
  tenantManager: TenantManager;
  /** Paths that skip auth entirely */
  publicPaths?: string[];
}

/**
 * Multi-tenant auth middleware.
 * Extracts token from Authorization header or x-api-key,
 * authenticates via TenantManager, and attaches tenant context.
 */
export function createMultiTenantAuthMiddleware(opts: MultiTenantAuthOptions) {
  const { tenantManager, publicPaths = ['/health', '/v1/models'] } = opts;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Skip auth for public paths
    if (publicPaths.includes(req.path)) {
      next();
      return;
    }

    // No tenants configured = open access
    if (tenantManager.allTenants().length === 0) {
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
          code: 'missing_credentials',
        },
      });
      return;
    }

    const tenantCtx = await tenantManager.authenticate(token);
    if (!tenantCtx) {
      res.status(401).json({
        error: { message: 'Invalid credentials', type: 'auth_error', code: 'invalid_credentials' },
      });
      return;
    }

    // Budget enforcement
    if (tenantManager.isOverBudget(tenantCtx)) {
      res.status(429).json({
        error: {
          message: 'Monthly budget exceeded',
          type: 'budget_error',
          code: 'budget_exceeded',
          tenantId: tenantCtx.tenantId,
        },
      });
      return;
    }

    req.tenant = tenantCtx;
    next();
  };
}

/**
 * Admin-only middleware. Must be placed after multi-tenant auth.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.tenant?.admin) {
    // Also allow if admin key is set via env
    const adminKey = process.env.PRISM_ADMIN_KEY;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

    if (adminKey && token === adminKey) {
      next();
      return;
    }

    res.status(403).json({
      error: { message: 'Admin access required', type: 'auth_error', code: 'forbidden' },
    });
    return;
  }
  next();
}
