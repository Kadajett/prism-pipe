/**
 * Retry with backoff (stub)
 */

export interface RetryOptions {
  maxAttempts: number
  initialDelay: number
  maxDelay: number
  backoffFactor: number
}

export async function withRetry<T>(_fn: () => Promise<T>, _options?: RetryOptions): Promise<T> {
  throw new Error("Not implemented")
}

export function calculateBackoff(
  attempt: number,
  initialDelay: number,
  backoffFactor: number,
  maxDelay: number,
): number {
  const delay = initialDelay * backoffFactor ** attempt
  return Math.min(delay, maxDelay)
}
