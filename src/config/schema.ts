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

export interface AuthConfig {
  enabled: boolean
  apiKey?: string
}

export interface RateLimitConfig {
  enabled: boolean
  requestsPerMinute?: number
  tokensPerMinute?: number
  capacity?: number
  refillRate?: number // tokens per second
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
  auth: AuthConfig
  providers: ProviderConfig[]
  rateLimit: RateLimitConfig
  logging: LoggingConfig
  [key: string]: unknown
}
