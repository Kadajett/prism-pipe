/**
 * Script entry point — loads YAML config and boots a PrismPipe instance.
 * For programmatic use, import { createPrismPipe } from 'prism-pipe' instead.
 */

import { loadConfig } from './config/loader';
import { createPrismPipe } from './lib';

const config = loadConfig(process.env.PRISM_CONFIG);

const proxy = createPrismPipe({
  port: config.port,
  logLevel: config.logLevel,
  requestTimeout: config.requestTimeout,
  providers: Object.fromEntries(
    Object.entries(config.providers).map(([name, p]) => [
      name,
      {
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        format: p.format,
        models: p.models,
        defaultModel: p.defaultModel,
        timeout: p.timeout,
      },
    ]),
  ),
  routes: config.routes,
  apiKeys: process.env.PRISM_API_KEYS?.split(',')
    .map((k) => k.trim())
    .filter(Boolean),
  rateLimitRpm: Number(process.env.RATE_LIMIT_RPM ?? 60),
  storeType: process.env.STORE_TYPE === 'memory' ? 'memory' : 'sqlite',
  storePath: process.env.STORE_PATH,
  configPath: process.env.PRISM_CONFIG,
});

proxy.start().catch((err) => {
  console.error('Failed to start Prism Pipe:', err);
  process.exit(1);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);
  proxy.stop().then(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
