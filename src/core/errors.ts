/** Base error for all prism-pipe errors. */
export class ProxyError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = "PROXY_ERROR") {
    super(message);
    this.name = "ProxyError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Thrown when a provider returns an error or is unreachable. */
export class ProviderError extends ProxyError {
  public readonly provider: string;

  constructor(message: string, provider: string, statusCode = 502) {
    super(message, statusCode, "PROVIDER_ERROR");
    this.name = "ProviderError";
    this.provider = provider;
  }
}

/** Thrown when a request or provider call exceeds its timeout. */
export class TimeoutError extends ProxyError {
  public readonly timeoutMs: number;

  constructor(message: string, timeoutMs: number) {
    super(message, 504, "TIMEOUT_ERROR");
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

/** Thrown when rate limits are exceeded. */
export class RateLimitError extends ProxyError {
  public readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message, 429, "RATE_LIMIT_ERROR");
    this.name = "RateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** Thrown when request validation fails. */
export class ValidationError extends ProxyError {
  public readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message, 400, "VALIDATION_ERROR");
    this.name = "ValidationError";
    this.details = details;
  }
}

/** Thrown when configuration is invalid. */
export class ConfigError extends ProxyError {
  constructor(message: string) {
    super(message, 500, "CONFIG_ERROR");
    this.name = "ConfigError";
  }
}
