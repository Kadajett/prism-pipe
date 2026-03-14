/**
 * ProxyInstance: manages a single public proxy lifecycle.
 * Listener bootstrapping and route execution live in dedicated runtime modules.
 */

import pino from 'pino';
import { ulid } from 'ulid';
import { StatsTracker } from './admin/routes';
import type {
  CostSummary,
  ModelDefinition,
  ProxyDefinition,
  ProxyErrorEvent,
  ProxyStatus,
  ScopedLogger,
  UsageSummary,
} from './core/types';
import { CostSummarySchema, ModelDefinitionSchema, ProxyStatusSchema } from './core/types';
import { CircuitBreakerRegistry } from './fallback/circuit-breaker';
import { promptGuardMiddleware } from './middleware/prompt-guard';
import { loadPlugins } from './plugin/loader';
import { PluginRegistry } from './plugin/registry';
import type { PrismPipe } from './prism-pipe';
import type { PortInfo } from './proxy/listener-runtime';
import { buildPortConfig, getPrimaryPort, startProxyListener } from './proxy/listener-runtime';
import { groupUsageByDimension, groupUsageByModel } from './proxy/usage-grouping';
import type { LogQuery, RequestLogEntry } from './store/interface';

export interface ProxyHealthInfo {
  status: 'healthy' | 'stopped' | 'degraded';
  uptime: number;
  port: number;
  listening: boolean;
  address: string | null;
  stats: ReturnType<StatsTracker['getStats']>;
}

type ErrorHandler = (event: ProxyErrorEvent) => void;

// ─── ProxyInstance ───

export class ProxyInstance {
  readonly id: string;
  readonly stats: StatsTracker;
  readonly circuitBreakers: CircuitBreakerRegistry;
  readonly plugins: PluginRegistry;
  readonly models = new Map<string, ModelDefinition>();

  private readonly parent: PrismPipe;
  private readonly definition: ProxyDefinition;
  private readonly errorHandlers: ErrorHandler[] = [];
  private readonly startedAt: number;
  private started = false;
  private middlewareWatchers: Array<() => void> = [];
  private readonly logger: ScopedLogger;
  private portInfo?: PortInfo;

  constructor(parent: PrismPipe, definition: ProxyDefinition) {
    this.id = definition.id ?? ulid();
    this.parent = parent;
    this.definition = definition;
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

    for (const [name, modelDefinition] of Object.entries(definition.models ?? {})) {
      this.models.set(name, ModelDefinitionSchema.parse(modelDefinition));
    }
  }

  registerModel(name: string, definition: ModelDefinition): this {
    this.models.set(name, ModelDefinitionSchema.parse(definition));
    return this;
  }

  getModel(name: string): ModelDefinition | undefined {
    return this.models.get(name) ?? this.parent.getModel(name);
  }

  /**
   * Register a proxy-level error handler.
   */
  onError(handler: ErrorHandler): this {
    this.errorHandlers.push(handler);
    return this;
  }

  /**
   * Start the proxy listener. Returns self for chaining.
   */
  async start(): Promise<ProxyInstance> {
    if (this.started) {
      return this;
    }

    await this.parent.initStore();

    const portConfig = this.buildPortConfig();

    if (portConfig.plugins && portConfig.plugins.length > 0) {
      await loadPlugins(portConfig.plugins, process.cwd(), this.plugins);
    }

    // Register built-in prompt-guard middleware (priority 10 — runs before inject-system)
    this.plugins.register({
      name: 'builtin:prompt-guard',
      version: '1.0.0',
      middleware: [promptGuardMiddleware],
    });

    for (const plugin of this.plugins.allPlugins()) {
      if (plugin.onStart) {
        await plugin.onStart();
      }
    }

    this.portInfo = await startProxyListener({
      circuitBreakers: this.circuitBreakers,
      definition: this.definition,
      logger: this.logger,
      plugins: this.plugins,
      proxyId: this.id,
      resolveModel: (name) => this.getModel(name),
      stats: this.stats,
      store: this.parent.store,
      transformRegistry: this.parent.transforms,
    });
    this.started = true;
    return this;
  }

  /**
   * Stop the proxy listener gracefully with connection draining.
   */
  async stop(): Promise<void> {
    if (!this.started) {
      return;
    }

    for (const stop of this.middlewareWatchers) {
      stop();
    }
    this.middlewareWatchers = [];

    for (const plugin of this.plugins.allPlugins()) {
      if (plugin.onShutdown) {
        await plugin.onShutdown();
      }
    }

    const info = this.portInfo;
    if (info?.agentFactory) {
      info.agentFactory.destroy();
    }

    if (info?.server.listening) {
      await new Promise<void>((resolve, reject) => {
        info.server.close((err) => {
          if (err) {
            reject(err);
            return;
          }

          resolve();
        });

        setTimeout(resolve, 5000);
      });
    }

    this.portInfo = undefined;
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
    return this.parent.store.queryLogs({
      ...query,
      proxy_id: this.id,
    });
  }

  async getUsage(): Promise<UsageSummary> {
    const entries = await this.parent.store.queryUsage({ proxy_id: this.id });
    return this.parent.summarizeUsageEntries(entries);
  }

  async getCost(): Promise<CostSummary> {
    const costs = Object.values(await this.getCostByModel());
    return costs.reduce<CostSummary>(
      (total, current) =>
        CostSummarySchema.parse({
          inputUsd: total.inputUsd + current.inputUsd,
          outputUsd: total.outputUsd + current.outputUsd,
          thinkingUsd: total.thinkingUsd + current.thinkingUsd,
          cacheReadUsd: total.cacheReadUsd + current.cacheReadUsd,
          cacheWriteUsd: total.cacheWriteUsd + current.cacheWriteUsd,
          totalUsd: total.totalUsd + current.totalUsd,
        }),
      CostSummarySchema.parse({
        inputUsd: 0,
        outputUsd: 0,
        thinkingUsd: 0,
        cacheReadUsd: 0,
        cacheWriteUsd: 0,
        totalUsd: 0,
      })
    );
  }

  async getUsageByModel(): Promise<Record<string, UsageSummary>> {
    const entries = await this.parent.store.queryUsage({ proxy_id: this.id });
    return groupUsageByModel(entries, (groupEntries) =>
      this.parent.summarizeUsageEntries(groupEntries)
    );
  }

  async getCostByModel(): Promise<Record<string, CostSummary>> {
    const usageByModel = await this.getUsageByModel();
    return Object.fromEntries(
      Object.entries(usageByModel).map(([modelName, usage]) => [
        modelName,
        this.parent.calculateCostSummary(modelName, usage),
      ])
    );
  }

  async getUsageByRoute(): Promise<Record<string, Record<string, UsageSummary>>> {
    const entries = await this.parent.store.queryUsage({ proxy_id: this.id });
    return groupUsageByDimension(
      entries,
      (entry) => entry.route_path ?? 'unmatched',
      (groupEntries) => this.parent.summarizeUsageEntries(groupEntries)
    );
  }

  async getCostByRoute(): Promise<Record<string, Record<string, CostSummary>>> {
    const usageByRoute = await this.getUsageByRoute();
    return Object.fromEntries(
      Object.entries(usageByRoute).map(([routePath, usageByModel]) => [
        routePath,
        Object.fromEntries(
          Object.entries(usageByModel).map(([modelName, usage]) => [
            modelName,
            this.parent.calculateCostSummary(modelName, usage),
          ])
        ),
      ])
    );
  }

  /**
   * Health info for the single listener owned by this proxy.
   */
  health(): ProxyHealthInfo {
    const info = this.portInfo;
    const address = info?.server.address();
    const listening = info?.server.listening ?? false;
    const resolvedAddress =
      address && typeof address === 'object' ? `${address.address}:${address.port}` : null;

    if (info) {
      return {
        status: listening ? 'healthy' : 'degraded',
        uptime: Math.floor((Date.now() - this.startedAt) / 1000),
        port: this.getPrimaryPort(),
        listening,
        address: resolvedAddress,
        stats: this.stats.getStats(),
      };
    }

    return {
      status: this.started ? 'degraded' : 'stopped',
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      port: this.getPrimaryPort(),
      listening,
      address: resolvedAddress,
      stats: this.stats.getStats(),
    };
  }

  status(): ProxyStatus {
    const health = this.health();
    const port = this.getPrimaryPort();

    return ProxyStatusSchema.parse({
      id: this.id,
      state: health.status === 'healthy' ? 'running' : health.status,
      port,
      routes: Object.keys(this.definition.routes),
      listening: health.status === 'healthy',
      uptime: health.uptime,
    });
  }

  // ─── Private ───

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

  private getPrimaryPort(): number {
    return getPrimaryPort(this.portInfo, this.definition.port);
  }

  private buildPortConfig(): ReturnType<typeof buildPortConfig> {
    return buildPortConfig(this.definition);
  }
}
