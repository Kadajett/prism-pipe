/**
 * Rate limiter interface + factory
 */
export interface RateLimiter {
    allowRequest(key: string, cost?: number): Promise<boolean>;
    reset(key: string): Promise<void>;
    getStatus(key: string): Promise<{
        remaining: number;
        resetAt: number;
    }>;
}
export declare abstract class AbstractLimiter implements RateLimiter {
    abstract allowRequest(key: string, cost?: number): Promise<boolean>;
    abstract reset(key: string): Promise<void>;
    abstract getStatus(key: string): Promise<{
        remaining: number;
        resetAt: number;
    }>;
}
export declare function createLimiter(type?: "token-bucket"): RateLimiter;
//# sourceMappingURL=limiter.d.ts.map