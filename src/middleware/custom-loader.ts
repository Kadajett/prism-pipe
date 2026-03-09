/**
 * Custom middleware loader: discovers and loads .ts/.js middleware
 * from a local directory (default: ./middleware/).
 *
 * Supports hot-reload via fs.watch with graceful drain.
 */

import { existsSync, readdirSync, watch, type FSWatcher } from 'node:fs';
import { resolve, extname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NamedMiddleware } from '../plugin/types.js';

const VALID_EXTENSIONS = new Set(['.ts', '.js', '.mts', '.mjs']);

/**
 * Scan a directory for middleware files and load them.
 * Each file should export a NamedMiddleware (via defineMiddleware) as default.
 */
export async function loadMiddlewareFromDir(dirPath: string): Promise<NamedMiddleware[]> {
  const absDir = resolve(dirPath);

  if (!existsSync(absDir)) {
    return [];
  }

  const files = readdirSync(absDir).filter((f) => {
    const ext = extname(f);
    return VALID_EXTENSIONS.has(ext) && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(f);
  });

  const middlewares: NamedMiddleware[] = [];

  for (const file of files) {
    const filePath = resolve(absDir, file);
    const fileUrl = pathToFileURL(filePath).href;

    // Use cache-busting query param for hot-reload support
    const mod = await import(`${fileUrl}?t=${Date.now()}`);
    const exported = mod.default ?? mod;

    if (exported && typeof exported === 'object' && 'name' in exported && 'middleware' in exported) {
      middlewares.push(exported as NamedMiddleware);
    } else if (typeof exported === 'function') {
      // Bare middleware function — wrap with filename as name
      const name = basename(file, extname(file));
      middlewares.push({ name, middleware: exported });
    }
  }

  return middlewares;
}

/**
 * Watch a middleware directory for changes and call the reload callback.
 * Returns a cleanup function to stop watching.
 */
export function watchMiddlewareDir(
  dirPath: string,
  onReload: (middlewares: NamedMiddleware[]) => void | Promise<void>,
  options?: { debounceMs?: number },
): () => void {
  const absDir = resolve(dirPath);

  if (!existsSync(absDir)) {
    return () => {};
  }

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = options?.debounceMs ?? 500;

  const watcher: FSWatcher = watch(absDir, { recursive: false }, (_event, filename) => {
    if (!filename) return;
    const ext = extname(filename);
    if (!VALID_EXTENSIONS.has(ext)) return;

    // Debounce rapid changes
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      try {
        const middlewares = await loadMiddlewareFromDir(absDir);
        await onReload(middlewares);
      } catch (err) {
        // Keep existing middleware on reload failure, but warn so users can debug
        console.warn(`[custom-loader] hot-reload failed for ${absDir}:`, err);
      }
    }, debounceMs);
  });

  return () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close();
  };
}
