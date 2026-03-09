import crypto from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TenantKeyStore, decodeJwt, createMultiTenantAuthMiddleware, requireAdmin } from '../../../src/admin/tenant-auth.js';
import type { TenantKey, JwtConfig } from '../../../src/admin/types.js';

// ── TenantKeyStore ──

describe('TenantKeyStore', () => {
  const store = new TenantKeyStore();
  const testKey: TenantKey = {
    id: 'tenant-1',
    key: 'a'.repeat(32),
    name: 'Test Tenant',
    permissions: { admin: false, chat: true, models: true },
    rateLimit: { rpm: 100 },
    allowedProviders: ['openai'],
    budget: { maxCostUsd: 50, periodDays: 30 },
    createdAt: Date.now(),
  };

  beforeEach(() => {
    store.load([testKey]);
  });

  it('looks up a valid key', () => {
    const result = store.lookup('a'.repeat(32));
    expect(result).toBeDefined();
    expect(result!.id).toBe('tenant-1');
  });

  it('returns undefined for invalid key', () => {
    expect(store.lookup('b'.repeat(32))).toBeUndefined();
  });

  it('returns undefined for wrong-length key', () => {
    expect(store.lookup('short')).toBeUndefined();
  });

  it('getAll returns all loaded keys', () => {
    expect(store.getAll()).toHaveLength(1);
  });

  it('getById finds by id', () => {
    expect(store.getById('tenant-1')?.name).toBe('Test Tenant');
    expect(store.getById('nope')).toBeUndefined();
  });
});

// ── JWT ──

describe('decodeJwt', () => {
  const secret = 'test-secret-key-for-jwt-testing!';
  const config: JwtConfig = { enabled: true, algorithm: 'HS256', secret };

  function makeJwt(payload: Record<string, unknown>, alg = 'HS256', sec = secret): string {
    const header = Buffer.from(JSON.stringify({ alg, typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', sec).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${sig}`;
  }

  it('decodes valid HS256 token', () => {
    const token = makeJwt({ sub: 'user1', tenantId: 'tenant-1', role: 'admin' });
    const payload = decodeJwt(token, config);
    expect(payload.sub).toBe('user1');
    expect(payload.tenantId).toBe('tenant-1');
    expect(payload.role).toBe('admin');
  });

  it('rejects expired token', () => {
    const token = makeJwt({ sub: 'user1', exp: Math.floor(Date.now() / 1000) - 100 });
    expect(() => decodeJwt(token, config)).toThrow('JWT expired');
  });

  it('rejects wrong issuer', () => {
    const cfgWithIss = { ...config, issuer: 'expected-iss' };
    const token = makeJwt({ sub: 'user1', iss: 'wrong-iss' });
    expect(() => decodeJwt(token, cfgWithIss)).toThrow('issuer mismatch');
  });

  it('rejects tampered token', () => {
    const token = makeJwt({ sub: 'user1' });
    const tampered = token.slice(0, -5) + 'XXXXX';
    expect(() => decodeJwt(tampered, config)).toThrow('Invalid JWT signature');
  });

  it('rejects invalid format', () => {
    expect(() => decodeJwt('not.a.valid.jwt.token', config)).toThrow();
  });
});

// ── Middleware ──

function mockReqRes(headers: Record<string, string> = {}, path = '/v1/chat/completions') {
  const req = {
    path,
    headers,
    tenantContext: undefined,
  } as any;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as any;
  const next = vi.fn();
  return { req, res, next };
}

describe('createMultiTenantAuthMiddleware', () => {
  const store = new TenantKeyStore();
  const testKey: TenantKey = {
    id: 'tenant-1',
    key: 'k'.repeat(32),
    name: 'Test',
    permissions: { admin: false, chat: true, models: true },
    createdAt: Date.now(),
  };

  beforeEach(() => {
    store.load([testKey]);
  });

  it('passes through on /health', () => {
    const mw = createMultiTenantAuthMiddleware({ tenantStore: store });
    const { req, res, next } = mockReqRes({}, '/health');
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('allows open access when no auth configured', () => {
    const emptyStore = new TenantKeyStore();
    emptyStore.load([]);
    const mw = createMultiTenantAuthMiddleware({ tenantStore: emptyStore });
    const { req, res, next } = mockReqRes({});
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('authenticates via API key', () => {
    const mw = createMultiTenantAuthMiddleware({ tenantStore: store });
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${'k'.repeat(32)}` });
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.tenantContext).toBeDefined();
    expect(req.tenantContext.tenantId).toBe('tenant-1');
  });

  it('authenticates via admin key', () => {
    const adminKey = 'admin-key-' + 'x'.repeat(22);
    const mw = createMultiTenantAuthMiddleware({ tenantStore: store, adminKey });
    const { req, res, next } = mockReqRes({ authorization: `Bearer ${adminKey}` });
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.tenantContext.permissions.admin).toBe(true);
  });

  it('rejects invalid credentials', () => {
    const mw = createMultiTenantAuthMiddleware({ tenantStore: store });
    const { req, res, next } = mockReqRes({ authorization: 'Bearer wrong-key-here-padding!!' });
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects missing auth when keys configured', () => {
    const mw = createMultiTenantAuthMiddleware({ tenantStore: store });
    const { req, res, next } = mockReqRes({});
    mw(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('requireAdmin', () => {
  it('passes when admin', () => {
    const { req, res, next } = mockReqRes();
    req.tenantContext = { tenantId: 'admin', name: 'Admin', permissions: { admin: true, chat: true, models: true } };
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects non-admin', () => {
    const { req, res, next } = mockReqRes();
    req.tenantContext = { tenantId: 't1', name: 'User', permissions: { admin: false, chat: true, models: true } };
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rejects missing context', () => {
    const { req, res, next } = mockReqRes();
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
