export { resolveConfig, findConfigFile, interpolateEnv, type LoadOptions } from './loader.js';
export { validateConfig, PrismPipeConfigSchema, type PrismPipeConfig, type ResolvedConfig, type ProviderConfig, type PipelineStepConfig, type RateLimitConfig, type LoggingConfig, type StoreConfig, type CorsConfig, type TimeoutConfig } from './schema.js';
export { getDefaults } from './defaults.js';

/**
 * Configuration loader with sane defaults for the Express server
 */
import type { PrismConfig } from '../types/index.js';

export function loadConfig(): PrismConfig {
  return {
    server: {
      port: Number.parseInt(process.env.PORT || '3000', 10),
      host: process.env.HOST || '0.0.0.0',
      cors: {
        enabled: process.env.CORS_ENABLED !== 'false',
        origins: process.env.CORS_ORIGINS?.split(',') || ['*'],
      },
      trustProxy: process.env.TRUST_PROXY === 'true',
      shutdownTimeout: Number.parseInt(
        process.env.SHUTDOWN_TIMEOUT || '30000',
        10
      ),
    },
    providers: loadProviders(),
    responseHeaders: {
      verbosity: (process.env.RESPONSE_HEADER_VERBOSITY ||
        'standard') as PrismConfig['responseHeaders']['verbosity'],
    },
  };
}

function loadProviders(): PrismConfig['providers'] {
  const providers: PrismConfig['providers'] = [];

  if (process.env.OPENAI_API_KEY) {
    providers.push({
      name: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: process.env.OPENAI_API_KEY,
      models: ['gpt-4', 'gpt-3.5-turbo'],
      enabled: true,
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    providers.push({
      name: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: process.env.ANTHROPIC_API_KEY,
      models: ['claude-3-opus-20240229', 'claude-3-sonnet-20240229'],
      enabled: true,
    });
  }

  return providers;
}
