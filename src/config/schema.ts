/**
 * Config type definitions + validation
 */

export interface ServerConfig {
  port: number
  host: string
  timeout: number
}

export interface ProviderConfig {
  name: string
  type: "openai" | "anthropic" | "custom"
  apiKey: string
  baseUrl?: string
  [key: string]: unknown
}

export interface RateLimitConfig {
  enabled: boolean
  requestsPerMinute?: number
  tokensPerMinute?: number
}

export interface LoggingConfig {
  level: "debug" | "info" | "warn" | "error"
  format: "json" | "text"
  database?: {
    enabled: boolean
    path: string
  }
}

export interface Config {
  server: ServerConfig
  providers: ProviderConfig[]
  rateLimit: RateLimitConfig
  logging: LoggingConfig
  [key: string]: unknown
}
