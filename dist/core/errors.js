/**
 * Error classes: ProxyError, ProviderError, TimeoutError, etc.
 */
export class ProxyError extends Error {
    constructor(code, message, status) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = "ProxyError";
    }
}
export class ProviderError extends Error {
    constructor(provider, message, status, originalError) {
        super(message);
        this.provider = provider;
        this.status = status;
        this.originalError = originalError;
        this.name = "ProviderError";
    }
}
export class TimeoutError extends Error {
    constructor(message, timeoutMs) {
        super(message);
        this.timeoutMs = timeoutMs;
        this.name = "TimeoutError";
    }
}
export class ValidationError extends Error {
    constructor(message, fields) {
        super(message);
        this.fields = fields;
        this.name = "ValidationError";
    }
}
export class RateLimitError extends Error {
    constructor(message, retryAfter) {
        super(message);
        this.retryAfter = retryAfter;
        this.name = "RateLimitError";
    }
}
//# sourceMappingURL=errors.js.map