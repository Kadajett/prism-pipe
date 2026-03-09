import type { RateLimiter } from "./limiter.js";

/** Token bucket rate limiter implementation. */
export class TokenBucket implements RateLimiter {
  constructor(
    private readonly maxTokens: number,
    private readonly refillRateMs: number,
  ) {}

  async check(
    _key: string,
  ): Promise<{ allowed: boolean; remaining: number; retryAfterMs?: number }> {
    // TODO: implement token bucket check
    throw new Error("Not implemented");
  }

  async consume(_key: string): Promise<void> {
    // TODO: implement token bucket consume
    throw new Error("Not implemented");
  }
}
