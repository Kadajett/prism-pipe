/**
 * Config hot-reload: file watcher, diff, safe apply.
 */
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { ResolvedConfig } from '../core/types.js';
import type { ConfigDiff, ReloadResult } from './types.js';

// Fields that can be changed without restart
const SAFE_FIELDS = new Set([
  'logLevel',
  'requestTimeout',
  'providers',
  'routes',
]);

// Fields that require a full restart
const RESTART_REQUIRED_FIELDS = new Set(['port']);

export function diffConfig(oldConfig: ResolvedConfig, newConfig: ResolvedConfig): ConfigDiff[] {
  const diffs: ConfigDiff[] = [];

  // Compare top-level scalar fields
  for (const field of ['port', 'logLevel', 'requestTimeout'] as const) {
    if (JSON.stringify(oldConfig[field]) !== JSON.stringify(newConfig[field])) {
      diffs.push({
        field,
        oldValue: oldConfig[field],
        newValue: newConfig[field],
        safeToApply: SAFE_FIELDS.has(field),
      });
    }
  }

  // Compare providers
  const oldProviders = JSON.stringify(oldConfig.providers);
  const newProviders = JSON.stringify(newConfig.providers);
  if (oldProviders !== newProviders) {
    diffs.push({
      field: 'providers',
      oldValue: Object.keys(oldConfig.providers),
      newValue: Object.keys(newConfig.providers),
      safeToApply: true,
    });
  }

  // Compare routes
  const oldRoutes = JSON.stringify(oldConfig.routes);
  const newRoutes = JSON.stringify(newConfig.routes);
  if (oldRoutes !== newRoutes) {
    diffs.push({
      field: 'routes',
      oldValue: oldConfig.routes.map((r) => r.path),
      newValue: newConfig.routes.map((r) => r.path),
      safeToApply: true,
    });
  }

  return diffs;
}

export type ConfigApplier = (newConfig: ResolvedConfig, diffs: ConfigDiff[]) => void;

export class ConfigWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private configPath: string;
  private currentConfig: ResolvedConfig;
  private loadFn: (path: string) => ResolvedConfig;
  private onReload: ConfigApplier;
  private onLog: (msg: string, data?: Record<string, unknown>) => void;

  constructor(opts: {
    configPath: string;
    currentConfig: ResolvedConfig;
    loadFn: (path: string) => ResolvedConfig;
    onReload: ConfigApplier;
    onLog?: (msg: string, data?: Record<string, unknown>) => void;
  }) {
    this.configPath = opts.configPath;
    this.currentConfig = opts.currentConfig;
    this.loadFn = opts.loadFn;
    this.onReload = opts.onReload;
    this.onLog = opts.onLog ?? (() => {});
  }

  start(): void {
    if (!existsSync(this.configPath)) {
      this.onLog('Config file not found, hot-reload disabled', { path: this.configPath });
      return;
    }

    this.watcher = watch(this.configPath, (eventType) => {
      if (eventType !== 'change') return;

      // Debounce: wait 500ms for writes to settle
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.handleChange(), 500);
    });

    this.onLog('Config hot-reload watching', { path: this.configPath });
  }

  private handleChange(): void {
    try {
      const newConfig = this.loadFn(this.configPath);
      const diffs = diffConfig(this.currentConfig, newConfig);

      if (diffs.length === 0) {
        this.onLog('Config file changed but no effective differences');
        return;
      }

      const restartRequired = diffs.filter((d) => !d.safeToApply).map((d) => d.field);
      const safeChanges = diffs.filter((d) => d.safeToApply);

      if (restartRequired.length > 0) {
        this.onLog('Config changes require restart', { fields: restartRequired });
      }

      if (safeChanges.length > 0) {
        this.onReload(newConfig, safeChanges);
        // Update our reference to the new config (only safe fields)
        for (const diff of safeChanges) {
          (this.currentConfig as Record<string, unknown>)[diff.field] = diff.newValue;
        }
        this.onLog('Config hot-reloaded', {
          applied: safeChanges.map((d) => d.field),
          restartRequired,
        });
      }
    } catch (err) {
      this.onLog('Config reload failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  reload(): ReloadResult {
    try {
      const newConfig = this.loadFn(this.configPath);
      const diffs = diffConfig(this.currentConfig, newConfig);

      if (diffs.length === 0) {
        return { status: 'applied', changes: [] };
      }

      const restartRequired = diffs.filter((d) => !d.safeToApply).map((d) => d.field);
      const safeChanges = diffs.filter((d) => d.safeToApply);

      if (safeChanges.length > 0) {
        this.onReload(newConfig, safeChanges);
        for (const diff of safeChanges) {
          (this.currentConfig as Record<string, unknown>)[diff.field] = diff.newValue;
        }
      }

      if (restartRequired.length > 0) {
        return { status: 'warnings', changes: diffs, restartRequired };
      }

      return { status: 'applied', changes: safeChanges };
    } catch (err) {
      return { status: 'error', message: err instanceof Error ? err.message : String(err) };
    }
  }

  stop(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.watcher?.close();
    this.watcher = null;
  }
}
