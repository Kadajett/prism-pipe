/** Rate limiter interface. */
export interface RateLimiter {
  /** Check if a request is allowed. Returns remaining tokens/requests. */
  check(key: string): Promise<{ allowed: boolean; remaining: number; retryAfterMs?: number }>;
  /** Consume a token for the given key. */
  consume(key: string): Promise<void>;
}

/** Factory to create rate limiters by strategy. */
export function createRateLimiter(_strategy: string): RateLimiter {
  // TODO: implement rate limiter factory
  throw new Error("Not implemented");
}
