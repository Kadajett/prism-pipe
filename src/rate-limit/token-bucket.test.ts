/**
 * Token bucket tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import { TokenBucket } from "./token-bucket.js"
import type { Store, RateLimitEntry, RequestLogEntry, LogFilter } from "../store/interface.js"

class MockStore implements Store {
  private data = new Map<string, RateLimitEntry>()

  async init(): Promise<void> {}
  async close(): Promise<void> {}
  async migrate(): Promise<void> {}
  async logRequest(_entry: RequestLogEntry): Promise<void> {}
  async queryLogs(_filter: LogFilter): Promise<RequestLogEntry[]> { return [] }

  async rateLimitGet(key: string): Promise<RateLimitEntry | null> {
    return this.data.get(key) ?? null
  }

  async rateLimitSet(key: string, entry: RateLimitEntry): Promise<void> {
    this.data.set(key, entry)
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
      { capacity: 10, refillRate: 1, scope: "test" },
      store,
    )

    for (let i = 0; i < 10; i++) {
      const result = await bucket.consume()
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9 - i)
    }

    const result = await bucket.consume()
    expect(result.allowed).toBe(false)
    expect(result.remaining).toBe(0)
    expect(result.retryAfter).toBeGreaterThan(0)
  })

  it("refills tokens at the correct rate", async () => {
    const bucket = new TokenBucket(
      { capacity: 10, refillRate: 1, scope: "test" },
      store,
    )

    for (let i = 0; i < 10; i++) {
      await bucket.consume()
    }

    let result = await bucket.consume()
    expect(result.allowed).toBe(false)

    vi.advanceTimersByTime(3000)

    for (let i = 0; i < 3; i++) {
      result = await bucket.consume()
      expect(result.allowed).toBe(true)
    }

    result = await bucket.consume()
    expect(result.allowed).toBe(false)
  })

  it("caps refill at capacity", async () => {
    const bucket = new TokenBucket(
      { capacity: 5, refillRate: 1, scope: "test" },
      store,
    )

    await bucket.consume(3)

    vi.advanceTimersByTime(10000)

    const status = await bucket.status()
    expect(status.remaining).toBe(5)
  })

  it("returns status without consuming", async () => {
    const bucket = new TokenBucket(
      { capacity: 10, refillRate: 1, scope: "test" },
      store,
    )

    await bucket.consume(5)

    const status = await bucket.status()
    expect(status.remaining).toBe(5)

    const result = await bucket.consume()
    expect(result.allowed).toBe(true)
    expect(result.remaining).toBe(4)
  })

  it("handles different scopes independently", async () => {
    const bucket1 = new TokenBucket(
      { capacity: 10, refillRate: 1, scope: "user-1" },
      store,
    )
    const bucket2 = new TokenBucket(
      { capacity: 10, refillRate: 1, scope: "user-2" },
      store,
    )

    for (let i = 0; i < 10; i++) {
      await bucket1.consume()
    }

    const result1 = await bucket1.consume()
    expect(result1.allowed).toBe(false)

    const result2 = await bucket2.consume()
    expect(result2.allowed).toBe(true)
    expect(result2.remaining).toBe(9)
  })

  it("initializes new bucket at full capacity", async () => {
    const bucket = new TokenBucket(
      { capacity: 10, refillRate: 1, scope: "new-bucket" },
      store,
    )

    const status = await bucket.status()
    expect(status.remaining).toBe(10)
    expect(status.allowed).toBe(true)
  })

  it("rejects zero or negative capacity", () => {
    expect(() => new TokenBucket({ capacity: 0, refillRate: 1, scope: "test" }, store))
      .toThrow("capacity must be positive")
  })

  it("rejects zero or negative refillRate", () => {
    expect(() => new TokenBucket({ capacity: 10, refillRate: 0, scope: "test" }, store))
      .toThrow("refillRate must be positive")
  })
})
