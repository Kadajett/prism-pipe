import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createAuthMiddleware, validateApiKeys } from './auth.js';

function mockRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json, res: { status } as unknown as Response };
}

describe('validateApiKeys', () => {
  it('accepts keys >= 32 chars', () => {
    expect(() => validateApiKeys(['a'.repeat(32)])).not.toThrow();
  });

  it('rejects keys < 32 chars', () => {
    expect(() => validateApiKeys(['short-key'])).toThrow(/too short/);
  });
});

describe('createAuthMiddleware', () => {
  const validKey = 'a'.repeat(40);

  it('passes through when no keys configured (open proxy)', () => {
    const mw = createAuthMiddleware();
    const next = vi.fn();
    mw({ headers: {}, path: '/v1/chat/completions' } as Request, {} as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('skips auth for /health', () => {
    const mw = createAuthMiddleware([validKey]);
    const next = vi.fn();
    mw({ headers: {}, path: '/health' } as Request, {} as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects missing key with 401', () => {
    const mw = createAuthMiddleware([validKey]);
    const { res, status } = mockRes();
    const next = vi.fn();
    mw({ headers: {}, path: '/v1/chat/completions' } as Request, res, next);
    expect(status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects invalid key with 401', () => {
    const mw = createAuthMiddleware([validKey]);
    const { res, status } = mockRes();
    const next = vi.fn();
    mw({ headers: { authorization: 'Bearer wrong-key' }, path: '/v1/chat/completions' } as unknown as Request, res, next);
    expect(status).toHaveBeenCalledWith(401);
  });

  it('accepts valid Bearer token', () => {
    const mw = createAuthMiddleware([validKey]);
    const next = vi.fn();
    mw({ headers: { authorization: `Bearer ${validKey}` }, path: '/v1/chat/completions' } as unknown as Request, {} as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('accepts valid x-api-key header', () => {
    const mw = createAuthMiddleware([validKey]);
    const next = vi.fn();
    mw({ headers: { 'x-api-key': validKey }, path: '/v1/chat/completions' } as unknown as Request, {} as Response, next);
    expect(next).toHaveBeenCalled();
  });
});
