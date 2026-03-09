/**
 * Config hot-reload: watches config file for changes, validates, diffs, and applies safe changes.
 * Restart-required changes (port, store, threading) emit warnings but don't apply.
 */

import { existsSync, watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import type { ResolvedConfig } from '../core/types';
import type { ScopedLogger } from '../core/types';

// Fields that can be safely hot-reloaded
const SAFE_FIELDS = new Set([
  'logLevel',
  'requestTimeout',
  'providers',
  'routes',
]);

// Fields that require a restart
const RESTART_REQUIRED_FIELDS = new Set([
  'port',
  'store',
]);

export interface ConfigChange {
  field: string;
  safe: boolean;
  oldValue: unknown;
  newValue: unknown;
}

export interface HotReloadOptions {
  /** Path to the config file to watch */
  configPath: string;
  /** Current config getter */
  getConfig: () => ResolvedConfig;
  /** Callback when safe changes are applied */
  onApply: (newConfig: ResolvedConfig, changes: ConfigChange[]) => void;
  /** Logger */
  log?: ScopedLogger;
  /** Config parser/validator function */
  parseConfig?: (raw: Record<string, unknown>) => ResolvedConfig;
  /** Debounce interval in ms. Default: 500 */
  debounceMs?: number;
}

/**
 * Diff two configs and return list of changes.
 */
export function diffConfig(oldConfig: ResolvedConfig, newConfig: ResolvedConfig): ConfigChange[] {
  const changes: ConfigChange[] = [];

  for (const key of Object.keys(newConfig) as (keyof ResolvedConfig)[]) {
    const oldVal = JSON.stringify(oldConfig[key]);
    const newVal = JSON.stringify(newConfig[key]);
    if (oldVal !== newVal) {
      changes.push({
        field: key,
        safe: SAFE_FIELDS.has(key),
        oldValue: oldConfig[key],
        newValue: newConfig[key],
      });
    }
  }

  return changes;
}

/**
 * Start watching a config file for changes.
 * Returns a cleanup function.
 */
export function startConfigWatcher(opts: HotReloadOptions): () => void {
  const { configPath, getConfig, onApply, log, debounceMs = 500 } = opts;

  if (!existsSync(configPath)) {
    log?.warn(`Config file not found: ${configPath}, hot-reload disabled`);
    return () => {};
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: FSWatcher | null = null;

  const handleChange = async () => {
    try {
      const content = await readFile(configPath, 'utf-8');
      const raw = parseYaml(content) as Record<string, unknown>;
      if (!raw || typeof raw !== 'object') {
        log?.warn('Hot-reload: invalid config file (not an object)');
        return;
      }

      // Use custom parser or basic reparse
      let newConfig: ResolvedConfig;
      if (opts.parseConfig) {
        newConfig = opts.parseConfig(raw);
      } else {
        // Basic: just re-import the loader
        const { loadConfig } = await import('./loader.js');
        newConfig = loadConfig(configPath);
      }

      const currentConfig = getConfig();
      const changes = diffConfig(currentConfig, newConfig);

      if (changes.length === 0) {
        log?.debug('Hot-reload: no changes detected');
        return;
      }

      const safeChanges = changes.filter((c) => c.safe);
      const unsafeChanges = changes.filter((c) => !c.safe);

      if (unsafeChanges.length > 0) {
        const fields = unsafeChanges.map((c) => c.field).join(', ');
        log?.warn(`Hot-reload: changes to [${fields}] require restart — not applied`);
      }

      if (safeChanges.length > 0) {
        const fields = safeChanges.map((c) => c.field).join(', ');
        log?.info(`Hot-reload: applying changes to [${fields}]`);

        // Build merged config: keep restart-required fields from old, apply safe from new
        const mergedConfig: ResolvedConfig = { ...currentConfig };
        for (const change of safeChanges) {
          (mergedConfig as unknown as Record<string, unknown>)[change.field] = change.newValue;
        }

        onApply(mergedConfig, safeChanges);
      }
    } catch (err) {
      log?.error(`Hot-reload: failed to reload config: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  try {
    watcher = watch(configPath, () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(handleChange, debounceMs);
    });

    log?.info(`Hot-reload: watching ${configPath}`);
  } catch (err) {
    log?.error(`Hot-reload: failed to watch ${configPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher?.close();
  };
}
