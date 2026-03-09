import type { ResolvedConfig } from '../core/types.js';

/**
 * Auth configuration
 */
export interface AuthConfig {
  enabled: boolean;
  apiKey?: string;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  enabled: boolean;
  capacity?: number;
  refillRate?: number;
}

/**
 * Validate a resolved config object. Throws on invalid values.
 * Lightweight runtime checks — no external dependencies.
 */
export function validateConfig(config: ResolvedConfig): void {
  const errors: string[] = [];

  // Port
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push(`Invalid port: ${config.port} (must be 1-65535)`);
  }

  // Log level
  const validLogLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
  if (!validLogLevels.includes(config.logLevel)) {
    errors.push(`Invalid logLevel: "${config.logLevel}" (must be one of: ${validLogLevels.join(', ')})`);
  }

  // Request timeout
  if (typeof config.requestTimeout !== 'number' || config.requestTimeout <= 0) {
    errors.push(`Invalid requestTimeout: ${config.requestTimeout} (must be a positive number in ms)`);
  }

  // Providers
  for (const [name, provider] of Object.entries(config.providers)) {
    if (!provider.baseUrl) {
      errors.push(`Provider "${name}": missing baseUrl`);
    }
    if (!provider.apiKey) {
      errors.push(`Provider "${name}": missing apiKey`);
    }
    if (provider.format && !['openai', 'anthropic'].includes(provider.format)) {
      errors.push(`Provider "${name}": invalid format "${provider.format}" (must be "openai" or "anthropic")`);
    }
  }

  // Routes
  if (!Array.isArray(config.routes) || config.routes.length === 0) {
    errors.push('At least one route must be configured');
  }
  for (const route of config.routes) {
    if (!route.path || !route.path.startsWith('/')) {
      errors.push(`Route path "${route.path}" must start with /`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Config validation failed:\n  - ${errors.join('\n  - ')}`);
  }
}
