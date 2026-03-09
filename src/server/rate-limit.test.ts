import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { createRateLimitMiddleware } from './rate-limit.js';
import { TokenBucket } from '../rate-limit/token-bucket.js';
import { MemoryStore } from '../store/memory.js';

function mockRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const setHeader = vi.fn();
  return { status, json, setHeader, res: { status, setHeader } as unknown as Response };
}

describe('createRateLimitMiddleware', () => {
  let bucket: TokenBucket;
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.init();
    bucket = new TokenBucket({ capacity: 3, refillRate: 1, store });
    vi.useFakeTimers();
  });

  it('skips rate limiting for /health', async () => {
    const mw = createRateLimitMiddleware(bucket);
    const next = vi.fn();
    await mw({ path: '/health' } as Request, {} as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects requests with no identifiable IP', async () => {
    const mw = createRateLimitMiddleware(bucket);
    const { res, status } = mockRes();
    const next = vi.fn();
    await mw({ path: '/v1/chat', ip: undefined, socket: {} } as unknown as Request, res, next);
    expect(status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('sets rate limit headers on success', async () => {
    const mw = createRateLimitMiddleware(bucket);
    const { res, setHeader } = mockRes();
    const next = vi.fn();
    await mw({ path: '/v1/chat', ip: '1.2.3.4', socket: {} } as unknown as Request, res, next);
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '3');
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', expect.any(String));
    expect(next).toHaveBeenCalled();
  });

  it('returns 429 with Retry-After after exhaustion', async () => {
    const mw = createRateLimitMiddleware(bucket);

    // Exhaust 3 tokens
    for (let i = 0; i < 3; i++) {
      const { res } = mockRes();
      const next = vi.fn();
      await mw({ path: '/v1/chat', ip: '1.2.3.4', socket: {} } as unknown as Request, res, next);
      expect(next).toHaveBeenCalled();
    }

    // 4th should be 429
    const { res, status, setHeader } = mockRes();
    const next = vi.fn();
    await mw({ path: '/v1/chat', ip: '1.2.3.4', socket: {} } as unknown as Request, res, next);
    expect(status).toHaveBeenCalledWith(429);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
    expect(next).not.toHaveBeenCalled();
  });
});
