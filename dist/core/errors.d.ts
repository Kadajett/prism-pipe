/**
 * Error classes: ProxyError, ProviderError, TimeoutError, etc.
 */
export declare class ProxyError extends Error {
    code: string;
    status?: number | undefined;
    constructor(code: string, message: string, status?: number | undefined);
}
export declare class ProviderError extends Error {
    provider: string;
    status?: number | undefined;
    originalError?: Error | undefined;
    constructor(provider: string, message: string, status?: number | undefined, originalError?: Error | undefined);
}
export declare class TimeoutError extends Error {
    timeoutMs?: number | undefined;
    constructor(message: string, timeoutMs?: number | undefined);
}
export declare class ValidationError extends Error {
    fields?: Record<string, string> | undefined;
    constructor(message: string, fields?: Record<string, string> | undefined);
}
export declare class RateLimitError extends Error {
    retryAfter?: number | undefined;
    constructor(message: string, retryAfter?: number | undefined);
}
//# sourceMappingURL=errors.d.ts.map