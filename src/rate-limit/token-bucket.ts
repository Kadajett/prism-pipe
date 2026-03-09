/**
 * Token bucket implementation (stub)
 */

import type { RateLimiter } from "./limiter"

export interface TokenBucketOptions {
  capacity: number
  refillRate: number
  refillInterval: number
}

export class TokenBucket implements RateLimiter {
  constructor(_options: TokenBucketOptions) {
    throw new Error("Not implemented")
  }

  async allowRequest(_key: string, _cost?: number): Promise<boolean> {
    throw new Error("Not implemented")
  }

  async reset(_key: string): Promise<void> {
    throw new Error("Not implemented")
  }

  async getStatus(_key: string): Promise<{ remaining: number; resetAt: number }> {
    throw new Error("Not implemented")
  }
}
