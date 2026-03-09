/**
 * Central extension registry. Prevents naming conflicts and provides
 * lookup for all registered extensions across plugins.
 */

import type {
  Composer,
  LogSink,
  MetricsExporter,
  NamedMiddleware,
  Plugin,
  StoreBackend,
} from './types.js';

export type ExtensionKind = 'middleware' | 'composer' | 'store' | 'logSink' | 'metricsExporter';

export class NamingConflictError extends Error {
  constructor(
    public readonly kind: ExtensionKind,
    public readonly name: string,
    public readonly existingPlugin: string,
    public readonly conflictingPlugin: string,
  ) {
    super(
      `Naming conflict for ${kind} "${name}": already registered by plugin "${existingPlugin}", ` +
        `cannot register from "${conflictingPlugin}"`,
    );
    this.name = 'NamingConflictError';
  }
}

interface RegistryEntry<T> {
  plugin: string;
  extension: T;
}

export class PluginRegistry {
  private readonly plugins = new Map<string, Plugin>();
  private readonly middlewareMap = new Map<string, RegistryEntry<NamedMiddleware>>();
  private readonly composerMap = new Map<string, RegistryEntry<Composer>>();
  private readonly storeMap = new Map<string, RegistryEntry<StoreBackend>>();
  private readonly logSinkMap = new Map<string, RegistryEntry<LogSink>>();
  private readonly metricsExporterMap = new Map<string, RegistryEntry<MetricsExporter>>();

  /**
   * Register a plugin and all its extensions. Throws on naming conflicts.
   */
  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }

    // Validate all extensions before committing any (atomic registration)
    this.validateNoConflicts(plugin);

    // Commit
    this.plugins.set(plugin.name, plugin);

    for (const mw of plugin.middleware ?? []) {
      this.middlewareMap.set(mw.name, { plugin: plugin.name, extension: mw });
    }
    for (const c of plugin.composers ?? []) {
      this.composerMap.set(c.name, { plugin: plugin.name, extension: c });
    }
    for (const s of plugin.stores ?? []) {
      this.storeMap.set(s.name, { plugin: plugin.name, extension: s });
    }
    for (const l of plugin.logSinks ?? []) {
      this.logSinkMap.set(l.name, { plugin: plugin.name, extension: l });
    }
    for (const m of plugin.metricsExporters ?? []) {
      this.metricsExporterMap.set(m.name, { plugin: plugin.name, extension: m });
    }
  }

  private validateNoConflicts(plugin: Plugin): void {
    for (const mw of plugin.middleware ?? []) {
      this.checkConflict('middleware', mw.name, plugin.name, this.middlewareMap);
    }
    for (const c of plugin.composers ?? []) {
      this.checkConflict('composer', c.name, plugin.name, this.composerMap);
    }
    for (const s of plugin.stores ?? []) {
      this.checkConflict('store', s.name, plugin.name, this.storeMap);
    }
    for (const l of plugin.logSinks ?? []) {
      this.checkConflict('logSink', l.name, plugin.name, this.logSinkMap);
    }
    for (const m of plugin.metricsExporters ?? []) {
      this.checkConflict('metricsExporter', m.name, plugin.name, this.metricsExporterMap);
    }
  }

  private checkConflict<T>(
    kind: ExtensionKind,
    name: string,
    pluginName: string,
    map: Map<string, RegistryEntry<T>>,
  ): void {
    const existing = map.get(name);
    if (existing) {
      throw new NamingConflictError(kind, name, existing.plugin, pluginName);
    }
  }

  // ─── Accessors ───

  getPlugin(name: string): Plugin | undefined {
    return this.plugins.get(name);
  }

  allPlugins(): Plugin[] {
    return [...this.plugins.values()];
  }

  getMiddleware(name: string): NamedMiddleware | undefined {
    return this.middlewareMap.get(name)?.extension;
  }

  /** All middleware sorted by priority (lower first). */
  allMiddleware(): NamedMiddleware[] {
    return [...this.middlewareMap.values()]
      .map((e) => e.extension)
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  getStore(name: string): StoreBackend | undefined {
    return this.storeMap.get(name)?.extension;
  }

  getComposer(name: string): Composer | undefined {
    return this.composerMap.get(name)?.extension;
  }

  getLogSink(name: string): LogSink | undefined {
    return this.logSinkMap.get(name)?.extension;
  }

  getMetricsExporter(name: string): MetricsExporter | undefined {
    return this.metricsExporterMap.get(name)?.extension;
  }

  /** Summary for diagnostics. */
  summary(): Record<ExtensionKind, string[]> {
    return {
      middleware: [...this.middlewareMap.keys()],
      composer: [...this.composerMap.keys()],
      store: [...this.storeMap.keys()],
      logSink: [...this.logSinkMap.keys()],
      metricsExporter: [...this.metricsExporterMap.keys()],
    };
  }
}
