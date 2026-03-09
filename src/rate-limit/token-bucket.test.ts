/**
 * Token bucket tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { TokenBucket } from "./token-bucket.js"
import type { Store } from "../store/interface.js"

// Mock store implementation
class MockStore implements Store {
  private data = new Map<string, any>()

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, value)
  }

  async get(key: string): Promise<unknown> {
    return this.data.get(key) ?? null
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key)
  }

  async exists(key: string): Promise<boolean> {
    return this.data.has(key)
  }

  async clear(): Promise<void> {
    this.data.clear()
  }

  async list(): Promise<any[]> {
    return []
  }

  reset() {
    this.data.clear()
  }
}

describe("TokenBucket", () => {
  let store: MockStore

  beforeEach(() => {
    store = new MockStore()
    vi.useFakeTimers()
  })

  it("allows burst up to capacity", async () => {
    const bucket = new TokenBucket(
      {
        capacity: 10,
        refillRate: 1,
        scope: "test",
      },
      store,
    )

    // Should allow 10 requests (full capacity)
    for (let i = 0; i < 10; i++) {
      const result = await bucket.consume()
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9 - i)
    }

    // 11th request should be rejected
    const result = await bucket.consume()
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfter).toBeGreaterThan(0)
  })

  it("refills tokens at the correct rate", async () => {
    const bucket = new TokenBucket(
      {
        capacity: 10,
        refillRate: 1, // 1 token per second
        scope: "test",
      },
      store,
    )

    // Exhaust the bucket
    for (let i = 0; i < 10; i++) {
      await bucket.consume()
    }

    // Verify exhausted
    let result = await bucket.consume()
    expect(result.allowed).toBe(false)

    // Advance time by 3 seconds (should refill 3 tokens)
    vi.advanceTimersByTime(3000)

    // Should allow 3 requests
    for (let i = 0; i < 3; i++) {
      result = await bucket.consume()
      expect(result.allowed).toBe(true)
    }

    // 4th should fail
    result = await bucket.consume()
    expect(result.allowed).toBe(false)
  })

  it("caps refill at capacity", async () => {
    const bucket = new TokenBucket(
      {
        capacity: 5,
        refillRate: 1,
        scope: "test",
      },
      store,
    )

    // Consume 3 tokens
    await bucket.consume(3)

    // Advance time by 10 seconds (would refill 10 tokens, but capped at 5)
    vi.advanceTimersByTime(10000)

    const status = await bucket.status()
    expect(status.remaining).toBe(5) // Should be at capacity, not 5 + 7 = 12
  })

  it("calculates resetAt correctly", async () => {
    const bucket = new TokenBucket(
      {
        capacity: 10,
        refillRate: 1,
        scope: "test",
      },
      store,
    )

    // Exhaust the bucket
    for (let i = 0; i < 10; i++) {
      await bucket.consume()
    }

    const now = Date.now()
    const result = await bucket.consume()

    expect(result.allowed).toBe(false)
    // Should take 1 second to refill 1 token
    expect(result.resetAt).toBeCloseTo(now + 1000, -2)
  })

  it("returns status without consuming", async () => {
    const bucket = new TokenBucket(
      {
        capacity: 10,
        refillRate: 1,
        scope: "test",
      },
      store,
    )

    // Consume 5 tokens
    await bucket.consume(5)

    // Check status (should not consume)
    const status = await bucket.status()
    expect(status.remaining).toBe(5)

    // Verify by consuming again - should still have 5
    const result = await bucket.consume()
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it("handles different scopes independently", async () => {
    const bucket1 = new TokenBucket(
      {
        capacity: 10,
        refillRate: 1,
        scope: "user-1",
      },
      store,
    )

    const bucket2 = new TokenBucket(
      {
        capacity: 10,
        refillRate: 1,
        scope: "user-2",
      },
      store,
    )

    // Exhaust bucket1
    for (let i = 0; i < 10; i++) {
      await bucket1.consume()
    }

    // bucket1 should be exhausted
    const result1 = await bucket1.consume()
    expect(result1.allowed).toBe(false)

    // bucket2 should still have tokens
    const result2 = await bucket2.consume()
    expect(result2.allowed).toBe(true)
    expect(result2.remaining).toBe(9)
  })

  it("initializes new bucket at full capacity", async () => {
    const bucket = new TokenBucket(
      {
        capacity: 10,
        refillRate: 1,
        scope: "new-bucket",
      },
      store,
    )

    const status = await bucket.status()
    expect(status.remaining).toBe(10)
    expect(status.allowed).toBe(true)
  })
})
