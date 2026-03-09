import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadMiddlewareFromDir } from './custom-loader.js';

const TMP_DIR = resolve(import.meta.dirname ?? '.', '__test_middleware__');

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('loadMiddlewareFromDir', () => {
  it('returns empty array for non-existent directory', async () => {
    const result = await loadMiddlewareFromDir('/tmp/nonexistent-dir-12345');
    expect(result).toEqual([]);
  });

  it('loads a named middleware export', async () => {
    writeFileSync(
      resolve(TMP_DIR, 'my-mw.mjs'),
      `export default {
        name: 'custom-logger',
        middleware: async (ctx, next) => { await next(); },
        priority: 50,
      };`,
    );

    const result = await loadMiddlewareFromDir(TMP_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('custom-logger');
    expect(result[0].priority).toBe(50);
  });

  it('wraps bare function exports with filename as name', async () => {
    writeFileSync(
      resolve(TMP_DIR, 'trace-requests.mjs'),
      `export default async function(ctx, next) { await next(); };`,
    );

    const result = await loadMiddlewareFromDir(TMP_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('trace-requests');
  });

  it('ignores test files', async () => {
    writeFileSync(
      resolve(TMP_DIR, 'real.mjs'),
      `export default { name: 'real', middleware: async (ctx, next) => { await next(); } };`,
    );
    writeFileSync(
      resolve(TMP_DIR, 'real.test.ts'),
      `// test file, should be ignored`,
    );

    const result = await loadMiddlewareFromDir(TMP_DIR);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('real');
  });
});
