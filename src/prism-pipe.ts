/**
 * PrismPipe class: top-level entry point that manages shared resources
 * (store, transform registry) and spawns ProxyInstance objects.
 */

import pino from 'pino';
import type {
  CostSummary,
  ModelDefinition,
  PrismStatus,
  ProxyDefinition,
  ProxyErrorEvent,
  ScopedLogger,
  UsageSummary,
} from './core/types';
import {
  CostSummarySchema,
  ModelDefinitionSchema,
  PrismStatusSchema,
  ProxyDefinitionSchema,
  UsageSummarySchema,
} from './core/types';
import type { ProviderTransformer } from './proxy/transform-registry';
import { TransformRegistry } from './proxy/transform-registry';
import { AnthropicTransformer } from './proxy/transforms/anthropic';
import { OpenAITransformer } from './proxy/transforms/openai';
import { ProxyInstance } from './proxy-instance';
import type {
  LogQuery,
  RequestLogEntry,
  Store,
  UsageLogEntry,
  UsageLogQuery,
} from './store/interface';
import { MemoryStore } from './store/memory';
import { SQLiteStore } from './store/sqlite';

// ─── Config ───

export interface PrismConfig {
  /** Log level. Defaults to 'info'. */
  logLevel?: string;
  /** Store type: 'memory' or 'sqlite'. Defaults to 'memory'. */
  storeType?: 'memory' | 'sqlite';
  /** SQLite store path. */
  storePath?: string;
}

type ErrorHandler = (event: ProxyErrorEvent) => void;

// ─── PrismPipe Class ───

export class PrismPipe {
  readonly store: Store;
  readonly transforms: TransformRegistry;
  readonly proxies: ProxyInstance[] = [];
  readonly models = new Map<string, ModelDefinition>();

  private readonly errorHandlers: ErrorHandler[] = [];
  private readonly logger: ScopedLogger;
  private storeInitialized = false;

  constructor(config: PrismConfig = {}) {
    // Logger
    const pinoLogger = pino({
      level: config.logLevel ?? 'info',
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

    // Store
    this.store =
      config.storeType === 'memory'
        ? new MemoryStore()
        : new SQLiteStore(config.storePath ?? './data/prism-pipe.db');

    // Transform registry with built-in transformers
    this.transforms = new TransformRegistry();
    this.transforms.register(new OpenAITransformer());
    this.transforms.register(new AnthropicTransformer());
  }

  /**
   * Register a custom transformer (e.g., GeminiTransformer).
   */
  registerTransform(transformer: ProviderTransformer): this {
    this.transforms.register(transformer);
    return this;
  }

  /**
   * Register a model for token and cost accounting.
   */
  registerModel(name: string, definition: ModelDefinition): this {
    this.models.set(name, ModelDefinitionSchema.parse(definition));
    return this;
  }

  /**
   * Resolve a registered model by name.
   */
  getModel(name: string): ModelDefinition | undefined {
    return this.models.get(name);
  }

  /**
   * Create a proxy instance from the stable public direct config shape.
   */
  createProxy(definition: ProxyDefinition): ProxyInstance {
    const config = ProxyDefinitionSchema.parse(definition);
    const proxy = new ProxyInstance(this, config);
    this.proxies.push(proxy);
    return proxy;
  }

  getProxies(): ProxyInstance[] {
    if (this.proxies.length === 0) {
      return [];
    }

    return [...this.proxies];
  }

  /**
   * Register a global error handler.
   */
  onError(handler: ErrorHandler): this {
    this.errorHandlers.push(handler);
    return this;
  }

  /**
   * Query logs across all proxies.
   */
  async getLogs(query: LogQuery = {}): Promise<RequestLogEntry[]> {
    return this.store.queryLogs(query);
  }

  /**
   * Start all registered proxies.
   */
  async start(): Promise<void> {
    if (this.proxies.length === 0) {
      return;
    }

    await Promise.all(this.proxies.map((proxy) => proxy.start()));
  }

  /**
   * Stop all registered proxies without disposing the Prism instance itself.
   */
  async stop(): Promise<void> {
    if (this.proxies.length === 0) {
      return;
    }

    await Promise.all(this.proxies.map((proxy) => proxy.stop()));
  }

  /**
   * Reload all registered proxies.
   */
  async reload(): Promise<void> {
    if (this.proxies.length === 0) {
      return;
    }

    await Promise.all(this.proxies.map((proxy) => proxy.reload()));
  }

  /**
   * Public aggregate lifecycle view.
   */
  status(): PrismStatus {
    const proxies = this.proxies.map((proxy) => proxy.status());
    const running = proxies.filter((proxy) => proxy.state === 'running').length;
    const degraded = proxies.some((proxy) => proxy.state === 'degraded');
    const state = running === 0 ? 'stopped' : degraded ? 'degraded' : 'running';

    return PrismStatusSchema.parse({
      state,
      proxies,
      totals: {
        registered: proxies.length,
        running,
      },
    });
  }

  /**
   * Placeholder aggregate usage view during the rewrite.
   */
  async getUsage(): Promise<UsageSummary> {
    const entries = await this.store.queryUsage({});
    return this.summarizeUsageEntries(entries);
  }

  /**
   * Placeholder aggregate cost view during the rewrite.
   */
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
      emptyCostSummary()
    );
  }

  async getUsageByModel(query: UsageLogQuery = {}): Promise<Record<string, UsageSummary>> {
    const entries = await this.store.queryUsage(query);
    return this.groupUsageByModel(entries);
  }

  async getCostByModel(query: UsageLogQuery = {}): Promise<Record<string, CostSummary>> {
    const usageByModel = await this.getUsageByModel(query);
    return Object.fromEntries(
      Object.entries(usageByModel).map(([modelName, usage]) => [
        modelName,
        this.calculateCostSummary(modelName, usage),
      ])
    );
  }

  async getUsageByProxy(
    query: UsageLogQuery = {}
  ): Promise<Record<string, Record<string, UsageSummary>>> {
    const entries = await this.store.queryUsage(query);
    return this.groupUsageByDimension(entries, (entry) => entry.proxy_id ?? 'unassigned');
  }

  async getCostByProxy(
    query: UsageLogQuery = {}
  ): Promise<Record<string, Record<string, CostSummary>>> {
    const usageByProxy = await this.getUsageByProxy(query);
    return this.groupCostByDimension(usageByProxy);
  }

  async getUsageByRoute(
    query: UsageLogQuery = {}
  ): Promise<Record<string, Record<string, UsageSummary>>> {
    const entries = await this.store.queryUsage(query);
    return this.groupUsageByDimension(entries, (entry) => entry.route_path ?? 'unmatched');
  }

  async getCostByRoute(
    query: UsageLogQuery = {}
  ): Promise<Record<string, Record<string, CostSummary>>> {
    const usageByRoute = await this.getUsageByRoute(query);
    return this.groupCostByDimension(usageByRoute);
  }

  /**
   * Initialize the store (called automatically on first proxy start).
   */
  async initStore(): Promise<void> {
    if (this.storeInitialized) return;
    await this.store.init();
    this.storeInitialized = true;
  }

  /**
   * Stop ALL proxies and close the store.
   */
  async shutdown(): Promise<void> {
    this.logger.info('PrismPipe shutdown initiated');

    // Stop all proxies in parallel
    await Promise.all(this.proxies.map((p) => p.stop()));

    // Close store
    await this.store.close();
    this.storeInitialized = false;

    this.logger.info('PrismPipe shutdown complete');
  }

  /**
   * Emit error to global handlers (called by ProxyInstance).
   */
  emitError(event: ProxyErrorEvent): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(event);
      } catch {
        // Don't let error handlers crash
      }
    }
  }

  summarizeUsageEntries(entries: UsageLogEntry[]): UsageSummary {
    const requestIds = new Set<string>();
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let thinkingTokens = 0;

    for (const entry of entries) {
      requestIds.add(entry.request_id);
      inputTokens += entry.input_tokens;
      outputTokens += entry.output_tokens;
      thinkingTokens += entry.thinking_tokens;
      cacheReadTokens += entry.cache_read_tokens;
      cacheWriteTokens += entry.cache_write_tokens;
    }

    return UsageSummarySchema.parse({
      requests: requestIds.size,
      inputTokens,
      outputTokens,
      thinkingTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens: inputTokens + outputTokens + thinkingTokens + cacheReadTokens + cacheWriteTokens,
    });
  }

  calculateCostSummary(modelName: string, usage: UsageSummary): CostSummary {
    const model = this.getModel(modelName);
    if (!model) {
      return emptyCostSummary();
    }

    const inputUsd = calculateTokenCost(usage.inputTokens, model.inputCostPerMillion);
    const outputUsd = calculateTokenCost(usage.outputTokens, model.outputCostPerMillion);
    const thinkingUsd = calculateTokenCost(usage.thinkingTokens, model.thinkingCostPerMillion);
    const cacheReadUsd = calculateTokenCost(usage.cacheReadTokens, model.cacheReadCostPerMillion);
    const cacheWriteUsd = calculateTokenCost(
      usage.cacheWriteTokens,
      model.cacheWriteCostPerMillion
    );

    return CostSummarySchema.parse({
      inputUsd,
      outputUsd,
      thinkingUsd,
      cacheReadUsd,
      cacheWriteUsd,
      totalUsd: inputUsd + outputUsd + thinkingUsd + cacheReadUsd + cacheWriteUsd,
    });
  }

  private groupUsageByModel(entries: UsageLogEntry[]): Record<string, UsageSummary> {
    const grouped = new Map<string, UsageLogEntry[]>();

    for (const entry of entries) {
      const bucket = grouped.get(entry.model);
      if (bucket) {
        bucket.push(entry);
        continue;
      }

      grouped.set(entry.model, [entry]);
    }

    return Object.fromEntries(
      [...grouped.entries()].map(([modelName, modelEntries]) => [
        modelName,
        this.summarizeUsageEntries(modelEntries),
      ])
    );
  }

  private groupUsageByDimension(
    entries: UsageLogEntry[],
    pickKey: (entry: UsageLogEntry) => string
  ): Record<string, Record<string, UsageSummary>> {
    const grouped = new Map<string, UsageLogEntry[]>();

    for (const entry of entries) {
      const key = pickKey(entry);
      const bucket = grouped.get(key);
      if (bucket) {
        bucket.push(entry);
        continue;
      }

      grouped.set(key, [entry]);
    }

    return Object.fromEntries(
      [...grouped.entries()].map(([key, groupEntries]) => [
        key,
        this.groupUsageByModel(groupEntries),
      ])
    );
  }

  private groupCostByDimension(
    usageByDimension: Record<string, Record<string, UsageSummary>>
  ): Record<string, Record<string, CostSummary>> {
    return Object.fromEntries(
      Object.entries(usageByDimension).map(([key, usageByModel]) => [
        key,
        Object.fromEntries(
          Object.entries(usageByModel).map(([modelName, usage]) => [
            modelName,
            this.calculateCostSummary(modelName, usage),
          ])
        ),
      ])
    );
  }
}

function calculateTokenCost(tokens: number, costPerMillion?: number): number {
  if (!costPerMillion || tokens === 0) {
    return 0;
  }

  return (tokens / 1_000_000) * costPerMillion;
}

function emptyCostSummary(): CostSummary {
  return CostSummarySchema.parse({
    inputUsd: 0,
    outputUsd: 0,
    thinkingUsd: 0,
    cacheReadUsd: 0,
    cacheWriteUsd: 0,
    totalUsd: 0,
  });
}
