import pino from 'pino';
import { loadConfig } from './config/loader';
import { PipelineEngine } from './core/pipeline';
import type { ResolvedConfig } from './core/types';
import { createLogMiddleware } from './middleware/log-request';
import { createTransformMiddleware } from './middleware/transform-format';
import { TransformRegistry } from './proxy/transform-registry';
import { AnthropicTransformer } from './proxy/transforms/anthropic';
import { OpenAITransformer } from './proxy/transforms/openai';
import { TokenBucket } from './rate-limit/token-bucket';
import { createAuthMiddleware } from './server/auth';
import { createApp, errorHandler } from './server/express';
import { createRateLimitMiddleware } from './server/rate-limit';
import { setupRoutes } from './server/router';
import type { Store } from './store/interface';
import { MemoryStore } from './store/memory';
import { SQLiteStore } from './store/sqlite';

// ── Load config ──
const config: ResolvedConfig = loadConfig();

// ── Logger ──
const logger = pino({
  level: config.logLevel,
  transport: process.stdout.isTTY
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

// ── Store ──
const store: Store =
  process.env.STORE_TYPE === 'memory'
    ? new MemoryStore()
    : new SQLiteStore(process.env.STORE_PATH ?? './data/prism-pipe.db');

// ── Transform registry ──
const transformRegistry = new TransformRegistry();
transformRegistry.register(new OpenAITransformer());
transformRegistry.register(new AnthropicTransformer());

// ── Pipeline ──
const pipeline = new PipelineEngine();
pipeline.use(createLogMiddleware());
pipeline.use(createTransformMiddleware(transformRegistry));

// ── Express app ──
const app = createApp();

// ── Auth middleware ──
const apiKeys = process.env.PRISM_API_KEYS?.split(',')
  .map((k) => k.trim())
  .filter(Boolean);
app.use(createAuthMiddleware(apiKeys));

// ── Rate limit middleware ──
const rateLimitCapacity = Number(process.env.RATE_LIMIT_RPM ?? 60);
const bucket = new TokenBucket({
  capacity: rateLimitCapacity,
  refillRate: rateLimitCapacity / 60, // per second
  store,
});
app.use(createRateLimitMiddleware(bucket));

// ── /v1/models endpoint ──
app.get('/v1/models', (_req, res) => {
  const models = Object.entries(config.providers).flatMap(([providerName, provider]) => {
    const providerModels = provider.models
      ? Object.keys(provider.models)
      : [provider.defaultModel ?? `${providerName}/default`];
    return providerModels.map((model) => ({
      id: model,
      object: 'model' as const,
      created: Math.floor(Date.now() / 1000),
      owned_by: providerName,
    }));
  });

  res.json({ object: 'list', data: models });
});

// ── Routes ──
setupRoutes(app, { config, pipeline, transformRegistry });

// ── Error handler (must be last) ──
app.use(errorHandler);

// ── Boot ──
async function boot() {
  await store.init();
  logger.info('Store initialized');

  const port = config.port;
  const server = app.listen(port, () => {
    const providerNames = Object.keys(config.providers);
    const banner = [
      '',
      '  🔷 Prism Pipe v0.1.0',
      `  ├─ Port:       ${port}`,
      `  ├─ Providers:  ${providerNames.length > 0 ? providerNames.join(', ') : '(none)'}`,
      `  ├─ Routes:     ${config.routes.map((r) => r.path).join(', ')}`,
      `  ├─ Rate limit: ${rateLimitCapacity} req/min`,
      `  ├─ Store:      ${store instanceof SQLiteStore ? 'SQLite' : 'Memory'}`,
      `  ├─ Auth:       ${apiKeys?.length ? `${apiKeys.length} key(s)` : 'open (no keys)'}`,
      `  └─ Log level:  ${config.logLevel}`,
      '',
    ];
    for (const line of banner) logger.info(line);
  });

  // Graceful shutdown
  function shutdown(signal: string) {
    logger.info(`Received ${signal}, shutting down...`);
    server.close(async () => {
      await store.close();
      logger.info('Server closed');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

boot().catch((err) => {
  logger.fatal({ err }, 'Failed to start Prism Pipe');
  process.exit(1);
});

export { app };
