/**
 * Programmatic API for Prism Pipe.
 *
 * @example
 * ```typescript
 * import { createPrismPipe } from 'prism-pipe';
 *
 * const proxy = createPrismPipe({
 *   port: 3100,
 *   providers: {
 *     openai: { baseUrl: 'https://api.openai.com', apiKey: '...' },
 *   },
 *   routes: [{ path: '/v1/chat/completions', providers: ['openai'] }],
 * });
 *
 * await proxy.start();
 * // ...
 * await proxy.stop();
 * ```
 */

import type { Express } from 'express';
import type { Server } from 'node:http';
import pino from 'pino';
import { PipelineEngine } from './core/pipeline';
import type {
  ComposeConfig,
  ProviderConfig,
  ResolvedConfig,
  RouteConfig,
} from './core/types';
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

// ─── Public Types ───

export interface PrismPipeProviderConfig {
  baseUrl: string;
  apiKey: string;
  format?: string;
  models?: Record<string, string>;
  defaultModel?: string;
  timeout?: number;
}

export interface PrismPipeComposeStepConfig {
  name: string;
  provider: string;
  model?: string;
  systemPrompt?: string;
  inputTransform?: string;
  timeout?: number;
  onError?: 'fail' | 'skip' | 'default' | 'partial';
  defaultContent?: string;
}

export interface PrismPipeComposeConfig {
  type: 'chain';
  steps: PrismPipeComposeStepConfig[];
}

export interface PrismPipeRouteConfig {
  path: string;
  providers?: string[];
  pipeline?: string[];
  systemPrompt?: string;
  compose?: PrismPipeComposeConfig;
}

export interface PrismPipeConfig {
  /** Port to listen on. Defaults to 3000. */
  port?: number;
  /** Log level. Defaults to 'info'. */
  logLevel?: string;
  /** Request timeout in ms. Defaults to 120000. */
  requestTimeout?: number;
  /** Provider configurations keyed by name. */
  providers?: Record<string, PrismPipeProviderConfig>;
  /** Route configurations. */
  routes?: PrismPipeRouteConfig[];
  /** API keys for auth. If empty, auth is disabled. */
  apiKeys?: string[];
  /** Rate limit requests per minute. Defaults to 60. */
  rateLimitRpm?: number;
  /** Store type: 'memory' or 'sqlite'. Defaults to 'memory'. */
  storeType?: 'memory' | 'sqlite';
  /** SQLite store path. Only used when storeType is 'sqlite'. */
  storePath?: string;
}

export interface PrismPipe {
  /** Start the server. Returns the instance for chaining. */
  start(): Promise<PrismPipe>;
  /** Stop the server gracefully. */
  stop(): Promise<void>;
  /** The port the server is listening on. */
  readonly port: number;
  /** The underlying Express app. */
  readonly app: Express;
  /** Health check info. */
  health(): { status: string; uptime: number; providers: string[] };
}

// ─── Factory ───

export function createPrismPipe(config: PrismPipeConfig = {}): PrismPipe {
  const resolvedConfig = resolveConfig(config);
  const startedAt = Date.now();

  // Logger
  const logger = pino({
    level: resolvedConfig.logLevel,
    transport: process.stdout.isTTY
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
  });

  // Store
  const store: Store =
    config.storeType === 'sqlite'
      ? new SQLiteStore(config.storePath ?? './data/prism-pipe.db')
      : new MemoryStore();

  // Transform registry
  const transformRegistry = new TransformRegistry();
  transformRegistry.register(new OpenAITransformer());
  transformRegistry.register(new AnthropicTransformer());

  // Pipeline
  const pipeline = new PipelineEngine();
  pipeline.use(createLogMiddleware());
  pipeline.use(createTransformMiddleware(transformRegistry));

  // Express app
  const app = createApp();

  // Auth
  if (config.apiKeys && config.apiKeys.length > 0) {
    app.use(createAuthMiddleware(config.apiKeys));
  }

  // Rate limit
  const rpm = config.rateLimitRpm ?? 60;
  const bucket = new TokenBucket({
    capacity: rpm,
    refillRate: rpm / 60,
    store,
  });
  app.use(createRateLimitMiddleware(bucket));

  // /v1/models endpoint
  app.get('/v1/models', (_req, res) => {
    const models = Object.entries(resolvedConfig.providers).flatMap(
      ([providerName, provider]) => {
        const providerModels = provider.models
          ? Object.keys(provider.models)
          : [provider.defaultModel ?? `${providerName}/default`];
        return providerModels.map((model) => ({
          id: model,
          object: 'model' as const,
          created: Math.floor(Date.now() / 1000),
          owned_by: providerName,
        }));
      },
    );
    res.json({ object: 'list', data: models });
  });

  // Routes
  setupRoutes(app, { config: resolvedConfig, pipeline, transformRegistry });

  // Error handler (last)
  app.use(errorHandler);

  let server: Server | null = null;
  let actualPort: number = resolvedConfig.port;

  const instance: PrismPipe = {
    get port() {
      return actualPort;
    },
    get app() {
      return app;
    },

    health() {
      return {
        status: server ? 'healthy' : 'stopped',
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        providers: Object.keys(resolvedConfig.providers),
      };
    },

    async start() {
      await store.init();

      return new Promise<PrismPipe>((resolve, reject) => {
        try {
          server = app.listen(resolvedConfig.port, () => {
            const addr = server!.address();
            if (addr && typeof addr === 'object') {
              actualPort = addr.port;
            }
            logger.info(`Prism Pipe listening on port ${actualPort}`);
            resolve(instance);
          });
          server.on('error', reject);
        } catch (err) {
          reject(err);
        }
      });
    },

    async stop() {
      if (!server) return;
      return new Promise<void>((resolve, reject) => {
        server!.close(async (err) => {
          if (err) {
            reject(err);
            return;
          }
          await store.close();
          server = null;
          logger.info('Prism Pipe stopped');
          resolve();
        });
      });
    },
  };

  return instance;
}

// ─── Config Resolution ───

function resolveConfig(config: PrismPipeConfig): ResolvedConfig {
  const providers: Record<string, ProviderConfig> = {};

  if (config.providers) {
    for (const [name, p] of Object.entries(config.providers)) {
      providers[name] = {
        name,
        baseUrl: p.baseUrl,
        apiKey: p.apiKey,
        format: p.format,
        models: p.models,
        defaultModel: p.defaultModel,
        timeout: p.timeout,
      };
    }
  }

  const routes: RouteConfig[] = (config.routes ?? []).map((r) => {
    const route: RouteConfig = {
      path: r.path,
      providers: r.providers ?? [],
      pipeline: r.pipeline,
      systemPrompt: r.systemPrompt,
    };
    if (r.compose) {
      route.compose = r.compose as ComposeConfig;
    }
    return route;
  });

  // Default route if none provided
  if (routes.length === 0) {
    routes.push({
      path: '/v1/chat/completions',
      providers: Object.keys(providers),
      pipeline: ['log-request', 'transform-format'],
    });
  }

  return {
    port: config.port ?? 3000,
    logLevel: config.logLevel ?? 'info',
    requestTimeout: config.requestTimeout ?? 120_000,
    providers,
    routes,
  };
}

// ─── Re-exports ───

export { loadConfig } from './config/loader';
export type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamChunk,
  ComposeConfig,
  ComposeStepConfig,
  ProviderConfig,
  ResolvedConfig,
  RouteConfig,
} from './core/types';
