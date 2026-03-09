/**
 * Retry with backoff (stub)
 */
export async function withRetry(_fn, _options) {
    throw new Error("Not implemented");
}
export function calculateBackoff(attempt, initialDelay, backoffFactor, maxDelay) {
    const delay = initialDelay * backoffFactor ** attempt;
    return Math.min(delay, maxDelay);
}
//# sourceMappingURL=retry.js.map