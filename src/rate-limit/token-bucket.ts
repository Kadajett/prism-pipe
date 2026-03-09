import type { Store } from "../store/interface.js"

export interface TokenBucketConfig {
  capacity: number
  refillRate: number // tokens per second
  scope: string
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  limit: number
  resetAt: number
  retryAfter?: number
}

export class TokenBucket {
  private capacity: number
  private refillRate: number
  private scope: string
  private store: Store

  constructor(config: TokenBucketConfig, store: Store) {
    if (config.capacity <= 0) {
      throw new Error("Token bucket capacity must be positive")
    }
    if (config.refillRate <= 0) {
      throw new Error("Token bucket refillRate must be positive")
    }
    this.capacity = config.capacity
    this.refillRate = config.refillRate
    this.scope = config.scope
    this.store = store
  }

  private get key(): string {
    return `rate-limit:${this.scope}`
  }

  private async getState(): Promise<{ tokens: number; lastRefill: number }> {
    const entry = await this.store.rateLimitGet(this.key)
    if (entry) {
      return { tokens: entry.tokens, lastRefill: entry.lastRefill }
    }
    return { tokens: this.capacity, lastRefill: Date.now() }
  }

  private refill(tokens: number, lastRefill: number, now: number): number {
    const elapsedMs = now - lastRefill
    const refillTokens = (elapsedMs / 1000) * this.refillRate
    return Math.min(this.capacity, tokens + refillTokens)
  }

  /**
   * Try to consume tokens. Returns result with allowed/remaining/retryAfter.
   */
  async consume(cost = 1): Promise<RateLimitResult> {
    const now = Date.now()
    const state = await this.getState()
    const tokens = this.refill(state.tokens, state.lastRefill, now)

    if (tokens >= cost) {
      const remaining = tokens - cost
      const resetAt =
        now + Math.ceil(((this.capacity - remaining) / this.refillRate) * 1000)

      await this.store.rateLimitSet(this.key, {
        key: this.key,
        tokens: remaining,
        lastRefill: now,
        resetAt,
      })

      return {
        allowed: true,
        remaining: Math.floor(remaining),
        limit: this.capacity,
        resetAt,
      }
    }

    // Not enough tokens
    const waitMs = Math.ceil(((cost - tokens) / this.refillRate) * 1000)
    const resetAt = now + waitMs

    await this.store.rateLimitSet(this.key, {
      key: this.key,
      tokens,
      lastRefill: now,
      resetAt,
    })

    return {
      allowed: false,
      remaining: 0,
      limit: this.capacity,
      resetAt,
      retryAfter: waitMs / 1000,
    }
  }

  /**
   * Check current state without consuming tokens.
   */
  async status(): Promise<RateLimitResult> {
    const now = Date.now()
    const state = await this.getState()
    const tokens = this.refill(state.tokens, state.lastRefill, now)
    const remaining = Math.floor(Math.min(this.capacity, tokens))

    return {
      allowed: remaining > 0,
      remaining,
      limit: this.capacity,
      resetAt:
        now + Math.ceil(((this.capacity - remaining) / this.refillRate) * 1000),
    }
  }
}
