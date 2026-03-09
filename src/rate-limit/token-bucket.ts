import type { Store } from '../store/interface.js';

export interface TokenBucketConfig {
  capacity: number;
  refillRate: number; // tokens per second
  store: Store;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number;
  retryAfterMs?: number;
}

export class TokenBucket {
  private capacity: number;
  private refillRate: number;
  private store: Store;

  constructor(config: TokenBucketConfig) {
    if (config.capacity <= 0) {
      throw new Error(`TokenBucket capacity must be positive, got ${config.capacity}`);
    }
    if (config.refillRate <= 0) {
      throw new Error(`TokenBucket refillRate must be positive, got ${config.refillRate}`);
    }
    this.capacity = config.capacity;
    this.refillRate = config.refillRate;
    this.store = config.store;
  }

  async check(key: string, cost = 1): Promise<RateLimitResult> {
    const now = Date.now();
    let entry = await this.store.rateLimitGet(key);

    if (!entry) {
      entry = {
        key,
        tokens: this.capacity,
        lastRefill: now,
        resetAt: now + Math.ceil((this.capacity / this.refillRate) * 1000),
      };
    }

    // Refill tokens based on elapsed time
    const elapsedMs = now - entry.lastRefill;
    const refillTokens = (elapsedMs / 1000) * this.refillRate;
    entry.tokens = Math.min(this.capacity, entry.tokens + refillTokens);
    entry.lastRefill = now;

    if (entry.tokens >= cost) {
      entry.tokens -= cost;
      entry.resetAt = now + Math.ceil(((this.capacity - entry.tokens) / this.refillRate) * 1000);
      await this.store.rateLimitSet(key, entry);
      return {
        allowed: true,
        remaining: Math.floor(entry.tokens),
        limit: this.capacity,
        resetAt: entry.resetAt,
      };
    }

    // Not enough tokens
    const waitMs = Math.ceil(((cost - entry.tokens) / this.refillRate) * 1000);
    await this.store.rateLimitSet(key, entry);
    return {
      allowed: false,
      remaining: 0,
      limit: this.capacity,
      resetAt: entry.resetAt,
      retryAfterMs: waitMs,
    };
  }
}
