/**
 * Rate limiter interface + factory
 */

export interface RateLimiter {
  allowRequest(key: string, cost?: number): Promise<boolean>
  reset(key: string): Promise<void>
  getStatus(key: string): Promise<{ remaining: number; resetAt: number }>
}

export abstract class AbstractLimiter implements RateLimiter {
  abstract allowRequest(key: string, cost?: number): Promise<boolean>
  abstract reset(key: string): Promise<void>
  abstract getStatus(key: string): Promise<{ remaining: number; resetAt: number }>
}

export function createLimiter(type: "token-bucket" = "token-bucket"): RateLimiter {
  if (type === "token-bucket") {
    throw new Error("Not implemented")
  }
  throw new Error(`Unknown limiter type: ${type}`)
}
