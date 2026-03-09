/**
 * Retry with backoff (stub)
 */
export interface RetryOptions {
    maxAttempts: number;
    initialDelay: number;
    maxDelay: number;
    backoffFactor: number;
}
export declare function withRetry<T>(_fn: () => Promise<T>, _options?: RetryOptions): Promise<T>;
export declare function calculateBackoff(attempt: number, initialDelay: number, backoffFactor: number, maxDelay: number): number;
//# sourceMappingURL=retry.d.ts.map