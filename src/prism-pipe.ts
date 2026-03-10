/**
 * PrismPipe class: top-level entry point that manages shared resources
 * (store, transform registry) and spawns ProxyInstance objects.
 */

import pino from 'pino';
import type { Store } from './store/interface';
import type { RequestLogEntry, LogQuery } from './store/interface';
import { MemoryStore } from './store/memory';
import { SQLiteStore } from './store/sqlite';
import { TransformRegistry } from './proxy/transform-registry';
import type { ProviderTransformer } from './proxy/transform-registry';
import { AnthropicTransformer } from './proxy/transforms/anthropic';
import { OpenAITransformer } from './proxy/transforms/openai';
import { ProxyInstance } from './proxy-instance';
import type { ProxyConfig, ProxyErrorEvent, ScopedLogger } from './core/types';

// ─── Config ───

export interface PrismPipeClassConfig {
  /** Log level. Defaults to 'info'. */
  logLevel?: string;
  /** Store type: 'memory' or 'sqlite'. Defaults to 'memory'. */
  storeType?: 'memory' | 'sqlite';
  /** SQLite store path. */
  storePath?: string;
}

type ErrorHandler = (event: ProxyErrorEvent) => void;

// ─── PrismPipe Class ───

export class PrismPipeClass {
  readonly store: Store;
  readonly transforms: TransformRegistry;
  readonly proxies: ProxyInstance[] = [];

  private readonly errorHandlers: ErrorHandler[] = [];
  private readonly logger: ScopedLogger;
  private storeInitialized = false;

  constructor(config: PrismPipeClassConfig = {}) {
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
      config.storeType === 'sqlite'
        ? new SQLiteStore(config.storePath ?? './data/prism-pipe.db')
        : new MemoryStore();

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
   * Create a proxy instance from a factory function.
   * The factory returns a ProxyConfig (port→config map).
   */
  createProxy(factory: () => ProxyConfig): ProxyInstance {
    const proxy = new ProxyInstance(this, factory);
    this.proxies.push(proxy);
    return proxy;
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
}
