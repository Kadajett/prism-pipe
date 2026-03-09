/**
 * Rate limit middleware tests
 */

import { describe, it, expect, beforeEach, vi } from "vitest"
import type { Request, Response, NextFunction } from "express"
import { createRateLimitMiddleware, getRateLimitScope } from "./rate-limit.js"
import type { Store } from "../../store/interface.js"
import type { RateLimitConfig } from "../../config/schema.js"

// Mock store
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

describe("getRateLimitScope", () => {
  it("uses api-key scope when apiKey is present", () => {
    const req = {
      apiKey: "test-key-123",
    } as Request & { apiKey?: string }

    expect(getRateLimitScope(req)).toBe("api-key:test-key-123")
  })

  it("falls back to IP scope when no apiKey", () => {
    const req = {
      ip: "192.168.1.100",
    } as Request

    expect(getRateLimitScope(req)).toBe("ip:192.168.1.100")
  })

  it("uses socket remoteAddress when ip is not available", () => {
    const req = {
      socket: {
        remoteAddress: "10.0.0.5",
      },
    } as Request

    expect(getRateLimitScope(req)).toBe("ip:10.0.0.5")
  })

  it("uses 'unknown' when no IP is available", () => {
    const req = {} as Request

    expect(getRateLimitScope(req)).toBe("ip:unknown")
  })
})

describe("createRateLimitMiddleware", () => {
  let store: MockStore

  beforeEach(() => {
    store = new MockStore()
    vi.useFakeTimers()
  })

  it("passes through when rate limiting is disabled", async () => {
    const config: RateLimitConfig = {
      enabled: false,
    }

    const middleware = createRateLimitMiddleware({ config, store })
    const req = {} as Request
    const res = {} as Response
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(next).toHaveBeenCalledWith()
  })

  it("adds rate limit headers on successful request", async () => {
    const config: RateLimitConfig = {
      enabled: true,
      capacity: 10,
      refillRate: 1,
    }

    const middleware = createRateLimitMiddleware({ config, store })
    const req = {
      ip: "192.168.1.1",
    } as Request

    const setHeader = vi.fn()
    const res = { setHeader } as unknown as Response
    const next = vi.fn()

    await middleware(req, res, next)

    expect(setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", "10")
    expect(setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", "9")
    expect(setHeader).toHaveBeenCalledWith("X-RateLimit-Reset", expect.any(String))
    expect(next).toHaveBeenCalledOnce()
  })

  it("returns 429 when rate limit is exceeded", async () => {
    const config: RateLimitConfig = {
      enabled: true,
      capacity: 3,
      refillRate: 1,
    }

    const middleware = createRateLimitMiddleware({ config, store })

    // Make 3 successful requests (exhaust capacity)
    for (let i = 0; i < 3; i++) {
      const req = { ip: "192.168.1.1" } as Request
      const setHeader = vi.fn()
      const res = { setHeader } as unknown as Response
      const next = vi.fn()

      await middleware(req, res, next)
      expect(next).toHaveBeenCalled()
    }

    // 4th request should fail
    const req = { ip: "192.168.1.1" } as Request
    const setHeader = vi.fn()
    const json = vi.fn()
    const status = vi.fn(() => ({ json }))
    const res = { setHeader, status } as unknown as Response
    const next = vi.fn()

    await middleware(req, res, next)

    expect(status).toHaveBeenCalledWith(429)
    expect(json).toHaveBeenCalledWith({
      error: {
        type: "rate_limit_error",
        message: "Rate limit exceeded",
        retryAfter: expect.any(Number),
      },
    })
    expect(setHeader).toHaveBeenCalledWith("Retry-After", expect.any(String))
    expect(next).not.toHaveBeenCalled()
  })

  it("tracks rate limits separately per scope", async () => {
    const config: RateLimitConfig = {
      enabled: true,
      capacity: 2,
      refillRate: 1,
    }

    const middleware = createRateLimitMiddleware({ config, store })

    // Exhaust limits for IP1
    for (let i = 0; i < 2; i++) {
      const req = { ip: "192.168.1.1" } as Request
      const setHeader = vi.fn()
      const res = { setHeader } as unknown as Response
      const next = vi.fn()

      await middleware(req, res, next)
    }

    // IP1 should be rate limited
    {
      const req = { ip: "192.168.1.1" } as Request
      const setHeader = vi.fn()
      const json = vi.fn()
      const status = vi.fn(() => ({ json }))
      const res = { setHeader, status } as unknown as Response
      const next = vi.fn()

      await middleware(req, res, next)
      expect(status).toHaveBeenCalledWith(429)
    }

    // IP2 should still work
    {
      const req = { ip: "192.168.1.2" } as Request
      const setHeader = vi.fn()
      const res = { setHeader } as unknown as Response
      const next = vi.fn()

      await middleware(req, res, next)
      expect(next).toHaveBeenCalled()
    }
  })

  it("allows requests again after refill time", async () => {
    const config: RateLimitConfig = {
      enabled: true,
      capacity: 2,
      refillRate: 1, // 1 token per second
    }

    const middleware = createRateLimitMiddleware({ config, store })

    // Exhaust capacity
    for (let i = 0; i < 2; i++) {
      const req = { ip: "192.168.1.1" } as Request
      const setHeader = vi.fn()
      const res = { setHeader } as unknown as Response
      const next = vi.fn()

      await middleware(req, res, next)
    }

    // Should be rate limited
    {
      const req = { ip: "192.168.1.1" } as Request
      const setHeader = vi.fn()
      const json = vi.fn()
      const status = vi.fn(() => ({ json }))
      const res = { setHeader, status } as unknown as Response
      const next = vi.fn()

      await middleware(req, res, next)
      expect(status).toHaveBeenCalledWith(429)
    }

    // Advance time by 2 seconds (refill 2 tokens)
    vi.advanceTimersByTime(2000)

    // Should work now
    {
      const req = { ip: "192.168.1.1" } as Request
      const setHeader = vi.fn()
      const res = { setHeader } as unknown as Response
      const next = vi.fn()

      await middleware(req, res, next)
      expect(next).toHaveBeenCalled()
    }
  })
})
