import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TokenBucket } from './token-bucket';
import { MemoryStore } from '../store/memory';

describe('TokenBucket', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.init();
    vi.useFakeTimers();
  });

  it('throws on zero or negative capacity', () => {
    expect(() => new TokenBucket({ capacity: 0, refillRate: 1, store })).toThrow(/capacity must be positive/);
    expect(() => new TokenBucket({ capacity: -1, refillRate: 1, store })).toThrow(/capacity must be positive/);
  });

  it('throws on zero or negative refillRate', () => {
    expect(() => new TokenBucket({ capacity: 10, refillRate: 0, store })).toThrow(/refillRate must be positive/);
    expect(() => new TokenBucket({ capacity: 10, refillRate: -5, store })).toThrow(/refillRate must be positive/);
  });

  it('allows burst up to capacity', async () => {
    const bucket = new TokenBucket({ capacity: 3, refillRate: 1, store });
    for (let i = 0; i < 3; i++) {
      const r = await bucket.check('k');
      expect(r.allowed).toBe(true);
    }
    const r = await bucket.check('k');
    expect(r.allowed).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it('refills tokens over time', async () => {
    const bucket = new TokenBucket({ capacity: 2, refillRate: 1, store });
    await bucket.check('k');
    await bucket.check('k');
    expect((await bucket.check('k')).allowed).toBe(false);

    vi.advanceTimersByTime(2000);
    const r = await bucket.check('k');
    expect(r.allowed).toBe(true);
  });

  it('caps tokens at capacity', async () => {
    const bucket = new TokenBucket({ capacity: 3, refillRate: 1, store });
    vi.advanceTimersByTime(10000); // would refill way past capacity
    const r = await bucket.check('k');
    expect(r.remaining).toBeLessThanOrEqual(3);
  });

  it('isolates keys', async () => {
    const bucket = new TokenBucket({ capacity: 1, refillRate: 1, store });
    await bucket.check('a');
    expect((await bucket.check('a')).allowed).toBe(false);
    expect((await bucket.check('b')).allowed).toBe(true);
  });
});
