/** Retry a function with exponential backoff. */
export async function retryWithBackoff<T>(
  _fn: () => Promise<T>,
  _options?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  },
): Promise<T> {
  // TODO: implement retry with exponential backoff + jitter
  throw new Error("Not implemented");
}
