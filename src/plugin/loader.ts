/**
 * Plugin loader: discovers and loads plugins from config references.
 * Supports local .ts/.js files and npm packages.
 */

import { existsSync } from 'node:fs';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Plugin, PluginReference } from './types.js';
import { PluginRegistry } from './registry.js';

/**
 * Validate that a loaded module is a valid Plugin.
 */
function validatePlugin(mod: unknown, source: string): Plugin {
  const plugin = (mod as Record<string, unknown>)?.default ?? mod;

  if (!plugin || typeof plugin !== 'object') {
    throw new Error(`Plugin from "${source}" did not export a valid object`);
  }

  const p = plugin as Record<string, unknown>;

  if (typeof p.name !== 'string' || !p.name) {
    throw new Error(`Plugin from "${source}" is missing a "name" property`);
  }
  if (typeof p.version !== 'string' || !p.version) {
    throw new Error(`Plugin from "${source}" is missing a "version" property`);
  }

  return plugin as Plugin;
}

/**
 * Resolve a plugin source to an importable specifier.
 * - Local paths (./foo, ../foo, /abs/path) → resolved to file URL
 * - npm packages → used as-is for dynamic import
 */
function resolveSource(source: string, basePath: string): string {
  if (source.startsWith('.') || source.startsWith('/') || isAbsolute(source)) {
    const full = resolve(basePath, source);

    // Try with common extensions if no extension
    const candidates = [full, `${full}.ts`, `${full}.js`, `${full}/index.ts`, `${full}/index.js`];
    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return pathToFileURL(candidate).href;
      }
    }

    throw new Error(
      `Plugin source "${source}" resolved to "${full}" but no file was found. ` +
        `Tried: ${candidates.join(', ')}`,
    );
  }

  // npm package — dynamic import will resolve from node_modules
  return source;
}

/**
 * Load a single plugin from a reference.
 */
async function loadPlugin(ref: PluginReference, basePath: string): Promise<Plugin> {
  const specifier = resolveSource(ref.source, basePath);
  const mod = await import(specifier);

  // If the export is a factory function, call it with config
  const exported = mod.default ?? mod;

  if (typeof exported === 'function') {
    const result = await exported(ref.config ?? {});
    return validatePlugin(result, ref.source);
  }

  return validatePlugin(exported, ref.source);
}

/**
 * Load all plugins from config references, validate, and register them.
 * Returns the populated registry.
 */
export async function loadPlugins(
  refs: PluginReference[],
  basePath: string,
  registry?: PluginRegistry,
): Promise<PluginRegistry> {
  const reg = registry ?? new PluginRegistry();

  for (const ref of refs) {
    if (ref.enabled === false) continue;

    const plugin = await loadPlugin(ref, basePath);
    // Call onInit before register so a failed init doesn't leave
    // a half-registered plugin in the registry with no rollback path.
    if (plugin.onInit) {
      await plugin.onInit();
    }

    reg.register(plugin);
  }

  return reg;
}
