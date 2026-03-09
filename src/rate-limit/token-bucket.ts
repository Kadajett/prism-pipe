/**
 * Token bucket rate limiter implementation
 */

import type { Store } from "../store/interface.js"

export interface TokenBucketConfig {
  capacity: number // Maximum tokens in the bucket
  refillRate: number // Tokens added per second
  scope: string // "global" | "api-key:<key>" | "ip:<ip>"
}

export interface TokenBucketState {
  tokens: number
  lastRefill: number
}

export interface TokenBucketResult {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfter?: number
}

/**
 * Token bucket rate limiter
 * Allows burst traffic up to capacity, then refills at a steady rate
 */
export class TokenBucket {
  private config: TokenBucketConfig
  private store: Store

  constructor(config: TokenBucketConfig, store: Store) {
    this.config = config
    this.store = store
  }

  private getKey(): string {
    return `rate-limit:token-bucket:${this.config.scope}`
  }

  /**
   * Refills tokens based on elapsed time
   */
  private refill(state: TokenBucketState, now: number): TokenBucketState {
    const elapsed = (now - state.lastRefill) / 1000 // Convert to seconds
    const tokensToAdd = elapsed * this.config.refillRate

    return {
      tokens: Math.min(this.config.capacity, state.tokens + tokensToAdd),
      lastRefill: now,
    }
  }

  /**
   * Attempts to consume tokens from the bucket
   * Returns whether the request was allowed and rate limit metadata
   */
  async consume(tokens = 1): Promise<TokenBucketResult> {
    const key = this.getKey()
    const now = Date.now()

    // Get current state
    let state = (await this.store.get(key)) as TokenBucketState | null

    // Initialize if doesn't exist
    if (!state) {
      state = {
        tokens: this.config.capacity,
        lastRefill: now,
      }
    }

    // Refill tokens based on elapsed time
    state = this.refill(state, now)

    // Check if we have enough tokens
    const allowed = state.tokens >= tokens

    if (allowed) {
      state.tokens -= tokens
    }

    // Save updated state (TTL = time to refill from 0 to capacity)
    const ttl = Math.ceil((this.config.capacity / this.config.refillRate) * 1000)
    await this.store.set(key, state, ttl)

    // Calculate when the bucket will have tokens again
    const resetAt = now + ((tokens - state.tokens) / this.config.refillRate) * 1000

    const result: TokenBucketResult = {
      allowed,
      remaining: Math.floor(state.tokens),
      resetAt: Math.ceil(resetAt),
    }

    if (!allowed) {
      // Calculate retry after (time until we'll have enough tokens)
      const tokensNeeded = tokens - state.tokens
      result.retryAfter = Math.ceil((tokensNeeded / this.config.refillRate) * 1000) / 1000
    }

    return result
  }

  /**
   * Gets current bucket state without consuming
   */
  async status(): Promise<TokenBucketResult> {
    const key = this.getKey()
    const now = Date.now()

    let state = (await this.store.get(key)) as TokenBucketState | null

    if (!state) {
      return {
        allowed: true,
        remaining: this.config.capacity,
        resetAt: now,
      }
    }

    state = this.refill(state, now)

    const resetAt = now + ((this.config.capacity - state.tokens) / this.config.refillRate) * 1000

    return {
      allowed: state.tokens >= 1,
      remaining: Math.floor(state.tokens),
      resetAt: Math.ceil(resetAt),
    }
  }
}
