/**
 * Script entry point — loads YAML config and boots a PrismPipe instance.
 * For programmatic use, import { PrismPipe } from 'prism-pipe'.
 */

import { loadConfig } from './config/loader';
import type { ProxyDefinition, RouteConfigObject, RouteValue } from './core/types';
import { PrismPipe } from './lib';

const config = loadConfig(process.env.PRISM_CONFIG);

const prism = new PrismPipe({
  logLevel: config.logLevel,
  storeType: process.env.STORE_TYPE === 'memory' ? 'memory' : 'sqlite',
  storePath: process.env.STORE_PATH,
});

const proxy = prism.createProxy({
  port: config.port,
  providers: config.providers,
  routes: routeArrayToMap(config.routes),
  apiKeys: process.env.PRISM_API_KEYS?.split(',')
    .map((key) => key.trim())
    .filter(Boolean),
  rateLimitRpm: Number(process.env.RATE_LIMIT_RPM ?? 60),
});

proxy.start().catch((err) => {
  console.error('Failed to start Prism Pipe:', err);
  process.exit(1);
});

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);
  prism.shutdown().then(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function routeArrayToMap(routes: typeof config.routes): ProxyDefinition['routes'] {
  if (routes.length === 0) {
    return {};
  }

  return Object.fromEntries(
    routes.map((route) => [
      route.path,
      {
        providers: route.providers,
        systemPrompt: route.systemPrompt,
        compose: route.compose as RouteConfigObject['compose'],
      } satisfies RouteValue,
    ])
  );
}
