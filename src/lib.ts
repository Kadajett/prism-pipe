/**
 * Programmatic API for Prism Pipe.
 *
 * New API (Phase 2):
 * ```typescript
 * import { PrismPipe, ProxyInstance } from 'prism-pipe';
 *
 * const prism = new PrismPipe({ storeType: 'memory' });
 * const proxy = prism.createProxy(() => ({
 *   ports: {
 *     "3100": { providers: {...}, routes: {...} },
 *     "3101": { providers: {...}, routes: {...} },
 *   }
 * }));
 * await proxy.start();
 * ```
 *
 * Legacy API (backward compatible):
 * ```typescript
 * import { createPrismPipe } from 'prism-pipe';
 *
 * const proxy = createPrismPipe({ port: 3100, providers: {...} });
 * await proxy.start();
 * ```
 */

import type { Express } from 'express';
import type { Server } from 'node:http';
import pino from 'pino';
import { setupAdminRoutes, StatsTracker } from './admin/routes';
import { startConfigWatcher } from './config/hot-reload';
import { PipelineEngine } from './core/pipeline';
import type {
  ComposeConfig,
  ProviderConfig,
  ResolvedConfig,
  RouteConfig,
  ToolRouterComposeConfig,
} from './core/types';
import { createLogMiddleware } from './middleware/log-request';
import { createTransformMiddleware } from './middleware/transform-format';
import { AgentFactory } from './network/agent-factory';
import { IpPool } from './network/ip-pool';
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

// ─── New API re-exports ───

export { PrismPipeClass as PrismPipe } from './prism-pipe';
export type { PrismPipeClassConfig } from './prism-pipe';
export { ProxyInstance } from './proxy-instance';
export type { PortInfo, ProxyHealthInfo } from './proxy-instance';

// ─── Legacy Public Types ───

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

export type PrismPipeComposeConfig =
  | { type: 'chain'; steps: PrismPipeComposeStepConfig[] }
  | { type: 'tool-router'; toolRouter: ToolRouterComposeConfig };

export interface PrismPipeRouteConfig {
  path: string;
  providers?: string[];
  pipeline?: string[];
  systemPrompt?: string;
  compose?: PrismPipeComposeConfig;
}

export interface PrismPipeEgressConfig {
  /** Local addresses to bind outbound connections to */
  addresses?: string[];
  /** Keep-alive for outbound connections. Default: true */
  keepAlive?: boolean;
  /** Max sockets per host. Default: 10 */
  maxSockets?: number;
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
  /** Path to YAML config file for hot-reload support. */
  configPath?: string;
  /** Egress / multi-IP configuration. */
  egress?: PrismPipeEgressConfig;
}

/** Legacy PrismPipe interface (from createPrismPipe) */
export interface LegacyPrismPipe {
  /** Start the server. Returns the instance for chaining. */
  start(): Promise<LegacyPrismPipe>;
  /** Stop the server gracefully. */
  stop(): Promise<void>;
  /** The port the server is listening on. */
  readonly port: number;
  /** The underlying Express app. */
  readonly app: Express;
  /** Health check info. */
  health(): { status: string; uptime: number; providers: string[] };
}

/**
 * @deprecated Use `LegacyPrismPipe` instead. This alias exists for backward compatibility.
 */
export type PrismPipeInterface = LegacyPrismPipe;

// ─── Legacy Factory (backward compatible) ───

export function createPrismPipe(config: PrismPipeConfig = {}): LegacyPrismPipe {
  let resolvedConfig = resolveConfig(config);
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

  // Stats tracker
  const stats = new StatsTracker();

  // Transform registry
  const transformRegistry = new TransformRegistry();
  transformRegistry.register(new OpenAITransformer());
  transformRegistry.register(new AnthropicTransformer());

  // Pipeline
  const pipeline = new PipelineEngine();
  pipeline.use(createLogMiddleware());
  pipeline.use(createTransformMiddleware(transformRegistry));

  // Agent factory (multi-IP egress)
  let agentFactory: AgentFactory | undefined;
  if (config.egress?.addresses && config.egress.addresses.length > 0) {
    const ipPool = new IpPool({
      ips: config.egress.addresses.map((addr) => ({ address: addr })),
    });
    agentFactory = new AgentFactory({
      ipPool,
      keepAlive: config.egress.keepAlive,
      maxSockets: config.egress.maxSockets,
    });
  }

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

  // Admin routes
  setupAdminRoutes(app, {
    config: resolvedConfig,
    stats,
    getConfig: () => resolvedConfig,
  });

  // Routes (with store, stats, agentFactory for logging, metrics, egress)
  setupRoutes(app, {
    config: resolvedConfig,
    pipeline,
    transformRegistry,
    store,
    stats,
    agentFactory,
  });

  // Error handler (last)
  app.use(errorHandler);

  let server: Server | null = null;
  let actualPort: number = resolvedConfig.port;
  let stopConfigWatcher: (() => void) | undefined;

  const instance: LegacyPrismPipe = {
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

      // Config hot-reload
      if (config.configPath) {
        stopConfigWatcher = startConfigWatcher({
          configPath: config.configPath,
          getConfig: () => resolvedConfig,
          onApply: (newConfig, changes) => {
            resolvedConfig = newConfig;
            logger.info(
              { changes: changes.map((c) => c.field) },
              'Config hot-reloaded',
            );
          },
          log: {
            info: (msg, data) => logger.info(data, msg),
            warn: (msg, data) => logger.warn(data, msg),
            error: (msg, data) => logger.error(data, msg),
            debug: (msg, data) => logger.debug(data, msg),
          },
        });
      }

      return new Promise<LegacyPrismPipe>((resolve, reject) => {
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
      // Stop config watcher
      if (stopConfigWatcher) {
        stopConfigWatcher();
        stopConfigWatcher = undefined;
      }

      // Destroy agent factory
      if (agentFactory) {
        agentFactory.destroy();
      }

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
  PortConfig,
  ProxyConfig,
  ProxyErrorEvent,
  RouteValue,
  RouteConfigObject,
  RouteHandler,
  HotReloadConfig,
  ExtendedComposeConfig,
  RetryConfig,
} from './core/types';
