/**
 * ProxyInstance: manages one or more Express servers (one per port).
 * Each proxy holds references to the parent PrismPipe for shared resources.
 */

import type { Express } from 'express';
import express from 'express';
import type { Server } from 'node:http';
import { ulid } from 'ulid';
import pino from 'pino';
import { setupAdminRoutes, StatsTracker } from './admin/routes';
import type { AdminRouteOptions } from './admin/routes';
import { TenantManager } from './auth/tenant';
import { createAuthMiddleware } from './server/auth';
import { CircuitBreakerRegistry } from './fallback/circuit-breaker';
import { PipelineEngine } from './core/pipeline';
import type { Middleware } from './core/pipeline';
import { createLogMiddleware } from './middleware/log-request';
import { createTransformMiddleware } from './middleware/transform-format';
import { loadMiddlewareFromDir, watchMiddlewareDir } from './middleware/custom-loader';
import { PluginRegistry } from './plugin/registry';
import { loadPlugins } from './plugin/loader';
import { AgentFactory } from './network/agent-factory';
import { IpPool } from './network/ip-pool';
import { TokenBucket } from './rate-limit/token-bucket';
import { createRateLimitMiddleware } from './server/rate-limit';
import { errorHandler } from './server/express';
import { setupRoutes } from './server/router';
import type {
  PortConfig,
  ProxyConfig,
  ProxyErrorEvent,
  RouteConfigObject,
  RouteValue,
  HotReloadConfig,
} from './core/types';
import type {
  ProviderConfig,
  ResolvedConfig,
  RouteConfig,
  ComposeConfig,
  ScopedLogger,
} from './core/types';
import type { Store } from './store/interface';
import type { RequestLogEntry, LogQuery } from './store/interface';
import type { TransformRegistry } from './proxy/transform-registry';
import type { PrismPipeClass } from './prism-pipe';

// ─── Types ───

export interface PortInfo {
  port: string;
  server: Server;
  app: Express;
  pipeline: PipelineEngine;
  agentFactory?: AgentFactory;
  tenantManager?: TenantManager;
}

export interface ProxyHealthInfo {
  status: 'healthy' | 'stopped' | 'degraded';
  uptime: number;
  ports: Record<string, { listening: boolean; address: string | null }>;
  stats: ReturnType<StatsTracker['getStats']>;
}

type ErrorHandler = (event: ProxyErrorEvent) => void;

// ─── ProxyInstance ───

export class ProxyInstance {
  readonly id: string;
  readonly stats: StatsTracker;
  readonly circuitBreakers: CircuitBreakerRegistry;
  readonly plugins: PluginRegistry;
  readonly ports: Map<string, PortInfo> = new Map();

  private readonly parent: PrismPipeClass;
  private readonly configFactory: () => ProxyConfig;
  private readonly errorHandlers: ErrorHandler[] = [];
  private readonly startedAt: number;
  private started = false;
  private middlewareWatchers: Array<() => void> = [];
  private readonly logger: ScopedLogger;

  constructor(parent: PrismPipeClass, factory: () => ProxyConfig) {
    this.id = ulid();
    this.parent = parent;
    this.configFactory = factory;
    this.stats = new StatsTracker();
    this.circuitBreakers = new CircuitBreakerRegistry();
    this.plugins = new PluginRegistry();
    this.startedAt = Date.now();

    const pinoLogger = pino({
      level: 'info',
      transport: process.stdout.isTTY
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    });
    this.logger = {
      info: (msg, data) => pinoLogger.info(data, msg),
      warn: (msg, data) => pinoLogger.warn(data, msg),
      error: (msg, data) => pinoLogger.error(data, msg),
      debug: (msg, data) => pinoLogger.debug(data, msg),
    };
  }

  /**
   * Register a proxy-level error handler.
   */
  onError(handler: ErrorHandler): this {
    this.errorHandlers.push(handler);
    return this;
  }

  /**
   * Start all ports. Returns self for chaining.
   */
  async start(): Promise<ProxyInstance> {
    if (this.started) return this;

    // Initialize store if not already done
    await this.parent.initStore();

    const proxyConfig = this.configFactory();
    const store = this.parent.store;
    const transformRegistry = this.parent.transforms;

    // Load plugins if configured
    for (const [, portConfig] of Object.entries(proxyConfig.ports)) {
      if (portConfig.plugins && portConfig.plugins.length > 0) {
        await loadPlugins(portConfig.plugins, process.cwd(), this.plugins);
      }
    }

    // Call plugin onStart hooks
    for (const plugin of this.plugins.allPlugins()) {
      if (plugin.onStart) await plugin.onStart();
    }

    // Start each port
    const portEntries = Object.entries(proxyConfig.ports);
    const startPromises = portEntries.map(([portStr, portConfig]) =>
      this.startPort(portStr, portConfig, store, transformRegistry),
    );

    await Promise.all(startPromises);
    this.started = true;
    return this;
  }

  /**
   * Stop all ports gracefully with connection draining.
   */
  async stop(): Promise<void> {
    if (!this.started) return;

    // Stop middleware watchers
    for (const stop of this.middlewareWatchers) {
      stop();
    }
    this.middlewareWatchers = [];

    // Call plugin onShutdown hooks
    for (const plugin of this.plugins.allPlugins()) {
      if (plugin.onShutdown) {
        await plugin.onShutdown();
      }
    }

    // Stop all port servers with connection draining
    const stopPromises = [...this.ports.values()].map(async (info) => {
      // Destroy agent factory
      if (info.agentFactory) {
        info.agentFactory.destroy();
      }

      if (!info.server.listening) return;

      return new Promise<void>((resolve, reject) => {
        // Stop accepting new connections
        info.server.close((err) => {
          if (err) reject(err);
          else resolve();
        });

        // Force close after timeout (5 seconds default)
        setTimeout(() => {
          resolve(); // Resolve anyway after timeout
        }, 5000);
      });
    });

    await Promise.all(stopPromises);
    this.ports.clear();
    this.started = false;
  }

  /**
   * Re-call factory function and gracefully restart with new config.
   */
  async reload(): Promise<void> {
    this.logger.info('Proxy reload initiated');
    await this.stop();
    await this.start();
    this.logger.info('Proxy reload complete');
  }

  /**
   * Query logs scoped to this proxy.
   */
  async getLogs(query: LogQuery = {}): Promise<RequestLogEntry[]> {
    // Add proxy_id filter - store queryLogs doesn't support it yet
    // but we can post-filter
    const allLogs = await this.parent.store.queryLogs(query);
    return allLogs.filter((log) => log.proxy_id === this.id);
  }

  /**
   * Aggregated health info across all ports.
   */
  health(): ProxyHealthInfo {
    const portsInfo: Record<string, { listening: boolean; address: string | null }> = {};
    let allListening = true;

    for (const [portStr, info] of this.ports) {
      const listening = info.server.listening;
      if (!listening) allListening = false;
      const addr = info.server.address();
      portsInfo[portStr] = {
        listening,
        address: addr && typeof addr === 'object' ? `${addr.address}:${addr.port}` : null,
      };
    }

    const status = !this.started
      ? 'stopped' as const
      : allListening
        ? 'healthy' as const
        : 'degraded' as const;

    return {
      status,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      ports: portsInfo,
      stats: this.stats.getStats(),
    };
  }

  // ─── Private ───

  private async startPort(
    portStr: string,
    portConfig: PortConfig,
    store: Store,
    transformRegistry: TransformRegistry,
  ): Promise<void> {
    const app = express();

    // Body parser
    app.use(express.json({ limit: '10mb' }));

    // CORS
    app.use((_req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
      if (_req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });

    // Request ID + port/proxy augmentation
    app.use((req, res, next) => {
      const reqId = (req.headers['x-request-id'] as string) ?? ulid();
      (req as unknown as Record<string, unknown>).requestId = reqId;
      (req as unknown as Record<string, unknown>).port = portStr;
      (req as unknown as Record<string, unknown>).proxyId = this.id;
      res.setHeader('X-Request-ID', reqId);
      res.setHeader('X-Prism-Version', '0.2.0');
      next();
    });

    // Health endpoint
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', port: portStr, proxyId: this.id, timestamp: new Date().toISOString() });
    });

    // Auth
    if (portConfig.apiKeys && portConfig.apiKeys.length > 0) {
      app.use(createAuthMiddleware(portConfig.apiKeys));
    }

    // Tenant manager
    let tenantManager: TenantManager | undefined;
    if (portConfig.tenants || portConfig.jwt || portConfig.oauth2) {
      tenantManager = new TenantManager({
        tenants: portConfig.tenants,
        jwt: portConfig.jwt,
        oauth2: portConfig.oauth2,
      });
    }

    // Rate limit
    const rpm = portConfig.rateLimitRpm ?? 60;
    const bucket = new TokenBucket({ capacity: rpm, refillRate: rpm / 60, store });
    app.use(createRateLimitMiddleware(bucket));

    // Agent factory (multi-IP egress)
    let agentFactory: AgentFactory | undefined;
    if (portConfig.ipPool) {
      const ipPool = new IpPool(portConfig.ipPool);
      agentFactory = new AgentFactory({
        ipPool,
        keepAlive: true,
        maxSockets: 10,
      });
    }

    // Pipeline engine per port
    const pipeline = new PipelineEngine();
    pipeline.use(createLogMiddleware());
    pipeline.use(createTransformMiddleware(transformRegistry));

    // Add plugin-registered middleware
    for (const mw of this.plugins.allMiddleware()) {
      pipeline.use(mw.middleware);
    }

    // Resolve providers from PortConfig
    const resolvedProviders: Record<string, ProviderConfig> = portConfig.providers ?? {};

    // Convert PortConfig routes to RouteConfig[]
    const resolvedRoutes = this.resolveRoutes(portConfig);

    // Build resolved config for this port
    const portResolvedConfig: ResolvedConfig = {
      port: parseInt(portStr, 10),
      logLevel: 'info',
      requestTimeout: 120_000,
      providers: resolvedProviders,
      routes: resolvedRoutes,
    };

    // /v1/models endpoint
    app.get('/v1/models', (_req, res) => {
      const models = Object.entries(resolvedProviders).flatMap(([providerName, provider]) => {
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

    // Admin routes (if configured)
    if (portConfig.admin) {
      const adminOpts: AdminRouteOptions =
        typeof portConfig.admin === 'object'
          ? portConfig.admin
          : {
              config: portResolvedConfig,
              stats: this.stats,
              tenantManager,
              circuitBreakers: this.circuitBreakers,
              pluginRegistry: this.plugins,
              getConfig: () => portResolvedConfig,
            };

      // If admin is `true`, we build opts ourselves
      if (portConfig.admin === true) {
        setupAdminRoutes(app, {
          config: portResolvedConfig,
          stats: this.stats,
          tenantManager,
          circuitBreakers: this.circuitBreakers,
          pluginRegistry: this.plugins,
          getConfig: () => portResolvedConfig,
        });
      } else {
        setupAdminRoutes(app, adminOpts);
      }
    }

    // Setup routes with store, stats, agentFactory
    setupRoutes(app, {
      config: portResolvedConfig,
      pipeline,
      transformRegistry,
      store,
      stats: this.stats,
      agentFactory,
    });

    // Error handler (last)
    app.use(errorHandler);

    // Start listening
    const server = await new Promise<Server>((resolve, reject) => {
      try {
        const portNum = parseInt(portStr, 10);
        const srv = app.listen(portNum, () => {
          this.logger.info(`Proxy port ${portStr} listening`);
          resolve(srv);
        });
        srv.on('error', reject);
      } catch (err) {
        reject(err);
      }
    });

    this.ports.set(portStr, {
      port: portStr,
      server,
      app,
      pipeline,
      agentFactory,
      tenantManager,
    });
  }

  /**
   * Convert PortConfig route map to RouteConfig array.
   * Routes can be handler functions or config objects.
   */
  private resolveRoutes(portConfig: PortConfig): RouteConfig[] {
    const routes: RouteConfig[] = [];

    for (const [path, value] of Object.entries(portConfig.routes)) {
      if (typeof value === 'function') {
        // Function routes are handled separately by Express directly
        // For now, skip them in the resolved config (they get wired as Express middleware)
        continue;
      }

      const routeObj = value as RouteConfigObject;
      const route: RouteConfig = {
        path,
        providers: routeObj.providers ?? [],
        systemPrompt: routeObj.systemPrompt,
      };

      if (routeObj.compose) {
        route.compose = routeObj.compose as ComposeConfig;
      }

      routes.push(route);
    }

    // Default route if none were config-type routes
    if (routes.length === 0 && portConfig.providers) {
      routes.push({
        path: '/v1/chat/completions',
        providers: Object.keys(portConfig.providers),
        pipeline: ['log-request', 'transform-format'],
      });
    }

    return routes;
  }

  /**
   * Emit an error event to all registered handlers.
   */
  private emitError(event: ProxyErrorEvent): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(event);
      } catch {
        // Don't let error handlers crash the proxy
      }
    }

    // Also emit to parent
    this.parent.emitError(event);
  }
}
