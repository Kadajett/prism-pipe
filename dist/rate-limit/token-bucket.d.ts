/**
 * Token bucket implementation (stub)
 */
import type { RateLimiter } from "./limiter";
export interface TokenBucketOptions {
    capacity: number;
    refillRate: number;
    refillInterval: number;
}
export declare class TokenBucket implements RateLimiter {
    constructor(_options: TokenBucketOptions);
    allowRequest(_key: string, _cost?: number): Promise<boolean>;
    reset(_key: string): Promise<void>;
    getStatus(_key: string): Promise<{
        remaining: number;
        resetAt: number;
    }>;
}
//# sourceMappingURL=token-bucket.d.ts.map