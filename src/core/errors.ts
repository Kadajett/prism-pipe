/**
 * Error classes: ProxyError, ProviderError, TimeoutError, etc.
 */

export class ProxyError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = "ProxyError"
  }
}

export class ProviderError extends Error {
  constructor(
    public provider: string,
    message: string,
    public status?: number,
    public originalError?: Error,
  ) {
    super(message)
    this.name = "ProviderError"
  }
}

export class TimeoutError extends Error {
  constructor(
    message: string,
    public timeoutMs?: number,
  ) {
    super(message)
    this.name = "TimeoutError"
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message)
    this.name = "ValidationError"
  }
}

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfter?: number,
  ) {
    super(message)
    this.name = "RateLimitError"
  }
}
