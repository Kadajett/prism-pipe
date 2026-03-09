/**
 * Multi-tenant auth: API key lookup, JWT validation, tenant context injection.
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { JwtConfig, JwtPayload, TenantContext, TenantKey } from './types.js';

// ── Tenant Key Store (in-memory, loaded from config) ──

export class TenantKeyStore {
  private keys = new Map<string, TenantKey>();

  load(tenants: TenantKey[]): void {
    this.keys.clear();
    for (const t of tenants) {
      this.keys.set(t.key, t);
    }
  }

  lookup(apiKey: string): TenantKey | undefined {
    // Timing-safe comparison against all keys
    for (const [storedKey, tenant] of this.keys) {
      if (storedKey.length === apiKey.length) {
        if (crypto.timingSafeEqual(Buffer.from(storedKey), Buffer.from(apiKey))) {
          return tenant;
        }
      }
    }
    return undefined;
  }

  getAll(): TenantKey[] {
    return [...this.keys.values()];
  }

  getById(id: string): TenantKey | undefined {
    for (const t of this.keys.values()) {
      if (t.id === id) return t;
    }
    return undefined;
  }
}

// ── JWT Validation ──

/**
 * Minimal JWT decode/verify for HS256 and RS256.
 * For production, consider using a dedicated JWT library.
 */
export function decodeJwt(token: string, config: JwtConfig): JwtPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(Buffer.from(headerB64, 'base64url').toString());

  if (header.alg !== config.algorithm) {
    throw new Error(`JWT algorithm mismatch: expected ${config.algorithm}, got ${header.alg}`);
  }

  // Verify signature
  const signingInput = `${headerB64}.${payloadB64}`;

  if (config.algorithm === 'HS256') {
    if (!config.secret) throw new Error('HS256 requires a secret');
    const expected = crypto.createHmac('sha256', config.secret).update(signingInput).digest();
    const actual = Buffer.from(signatureB64, 'base64url');
    if (!crypto.timingSafeEqual(expected, actual)) {
      throw new Error('Invalid JWT signature');
    }
  } else if (config.algorithm === 'RS256') {
    if (!config.publicKey) throw new Error('RS256 requires a public key');
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signingInput);
    const isValid = verifier.verify(config.publicKey, Buffer.from(signatureB64, 'base64url'));
    if (!isValid) throw new Error('Invalid JWT signature');
  }

  const payload: JwtPayload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString());

  // Validate claims
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    throw new Error('JWT expired');
  }
  if (config.issuer && payload.iss !== config.issuer) {
    throw new Error(`JWT issuer mismatch: expected ${config.issuer}`);
  }
  if (config.audience && payload.aud !== config.audience) {
    throw new Error(`JWT audience mismatch: expected ${config.audience}`);
  }

  return payload;
}

// ── Express middleware ──

export interface MultiTenantAuthOptions {
  tenantStore: TenantKeyStore;
  jwt?: JwtConfig;
  adminKey?: string;
}

declare global {
  namespace Express {
    interface Request {
      tenantContext?: TenantContext;
    }
  }
}

/**
 * Multi-tenant auth middleware. Supports API keys, JWT, and admin key.
 * Sets req.tenantContext on success.
 */
export function createMultiTenantAuthMiddleware(opts: MultiTenantAuthOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip auth for health
    if (req.path === '/health') {
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    const xApiKey = req.headers['x-api-key'] as string | undefined;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : (authHeader ?? xApiKey);

    if (!token) {
      // No keys configured at all = open access
      if (opts.tenantStore.getAll().length === 0 && !opts.jwt?.enabled && !opts.adminKey) {
        next();
        return;
      }
      res.status(401).json({
        error: { message: 'Missing authentication', type: 'auth_error', code: 'missing_auth' },
      });
      return;
    }

    // Try admin key first
    if (opts.adminKey && token.length === opts.adminKey.length) {
      if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(opts.adminKey))) {
        req.tenantContext = {
          tenantId: 'admin',
          name: 'Admin',
          permissions: { admin: true, chat: true, models: true },
        };
        next();
        return;
      }
    }

    // Try JWT
    if (opts.jwt?.enabled && token.includes('.')) {
      try {
        const payload = decodeJwt(token, opts.jwt);
        req.tenantContext = {
          tenantId: payload.tenantId ?? payload.sub,
          name: payload.sub,
          permissions: payload.permissions ?? {
            admin: payload.role === 'admin',
            chat: true,
            models: true,
          },
        };
        next();
        return;
      } catch {
        // Fall through to API key check
      }
    }

    // Try tenant API key
    const tenant = opts.tenantStore.lookup(token);
    if (tenant) {
      req.tenantContext = {
        tenantId: tenant.id,
        name: tenant.name,
        permissions: tenant.permissions,
        rateLimit: tenant.rateLimit,
        allowedProviders: tenant.allowedProviders,
        budget: tenant.budget,
      };
      next();
      return;
    }

    res.status(401).json({
      error: { message: 'Invalid credentials', type: 'auth_error', code: 'invalid_auth' },
    });
  };
}

/**
 * Middleware to require admin permissions on admin routes.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.tenantContext?.permissions.admin) {
    res.status(403).json({
      error: { message: 'Admin access required', type: 'auth_error', code: 'forbidden' },
    });
    return;
  }
  next();
}
