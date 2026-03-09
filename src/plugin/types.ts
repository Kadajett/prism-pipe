/**
 * Plugin system types for Prism Pipe.
 *
 * A plugin is a bundle of extensions: middleware, composers, store backends,
 * log sinks, metrics exporters, and config schema extensions.
 */

import type { z } from 'zod';
import type { Middleware } from '../core/pipeline.js';
import type { Store } from '../store/interface.js';
import type { ScopedLogger } from '../logging/interface.js';
import type { MetricsEmitter } from '../core/types.js';

// ─── Lifecycle Hooks ───

export interface PluginLifecycle {
  /** Called after plugin is loaded and validated, before extensions are registered. */
  onInit?(): Promise<void> | void;
  /** Called when the server is starting up, after all plugins are loaded. */
  onStart?(): Promise<void> | void;
  /** Called during graceful shutdown. */
  onShutdown?(): Promise<void> | void;
}

// ─── Extension Types ───

export interface NamedMiddleware {
  name: string;
  middleware: Middleware;
  /** Lower = earlier in pipeline. Default: 100 */
  priority?: number;
}

export interface StoreBackend {
  name: string;
  factory(config: Record<string, unknown>): Store;
}

export interface LogSink {
  name: string;
  factory(config: Record<string, unknown>): ScopedLogger;
}

export interface MetricsExporter {
  name: string;
  factory(config: Record<string, unknown>): MetricsEmitter;
}

export interface Composer {
  name: string;
  /** A composer is itself a middleware that composes/orchestrates sub-requests. */
  factory(config: Record<string, unknown>): Middleware;
}

// ─── Plugin Interface ───

export interface Plugin extends PluginLifecycle {
  /** Unique plugin name (e.g. 'prism-pipe-plugin-redis-store'). */
  name: string;
  /** SemVer version string. */
  version: string;

  /** Middleware extensions. */
  middleware?: NamedMiddleware[];
  /** Composer extensions (orchestration middleware). */
  composers?: Composer[];
  /** Store backend extensions. */
  stores?: StoreBackend[];
  /** Log sink extensions. */
  logSinks?: LogSink[];
  /** Metrics exporter extensions. */
  metricsExporters?: MetricsExporter[];
  /** Zod schema to merge with the base config. */
  configSchema?: z.ZodObject<z.ZodRawShape>;
}

// ─── Plugin Config ───

export interface PluginReference {
  /** npm package name or local path (./plugins/my-plugin.ts) */
  source: string;
  /** Config passed to the plugin */
  config?: Record<string, unknown>;
  /** Whether to enable the plugin. Default: true */
  enabled?: boolean;
}
