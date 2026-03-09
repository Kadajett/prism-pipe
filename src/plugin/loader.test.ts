import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadPlugins } from './loader';
import { PluginRegistry } from './registry';

const TMP_DIR = resolve(import.meta.dirname ?? '.', '__test_plugins__');

function writeTmpPlugin(filename: string, content: string): string {
  const filePath = resolve(TMP_DIR, filename);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

beforeEach(() => {
  mkdirSync(TMP_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('loadPlugins', () => {
  it('loads a plugin from a local file (object export)', async () => {
    writeTmpPlugin(
      'my-plugin.mjs',
      `
      export default {
        name: 'local-plugin',
        version: '0.1.0',
        middleware: [{
          name: 'local-mw',
          middleware: async (ctx, next) => { await next(); },
        }],
      };
    `,
    );

    const registry = await loadPlugins(
      [{ source: './__test_plugins__/my-plugin.mjs' }],
      import.meta.dirname ?? '.',
    );

    expect(registry.getPlugin('local-plugin')).toBeDefined();
    expect(registry.getMiddleware('local-mw')).toBeDefined();
  });

  it('loads a plugin from a factory function', async () => {
    writeTmpPlugin(
      'factory-plugin.mjs',
      `
      export default function createPlugin(config) {
        return {
          name: 'factory-' + (config.suffix || 'default'),
          version: '1.0.0',
        };
      }
    `,
    );

    const registry = await loadPlugins(
      [{ source: './__test_plugins__/factory-plugin.mjs', config: { suffix: 'custom' } }],
      import.meta.dirname ?? '.',
    );

    expect(registry.getPlugin('factory-custom')).toBeDefined();
  });

  it('skips disabled plugins', async () => {
    writeTmpPlugin(
      'disabled.mjs',
      `export default { name: 'disabled', version: '1.0.0' };`,
    );

    const registry = await loadPlugins(
      [{ source: './__test_plugins__/disabled.mjs', enabled: false }],
      import.meta.dirname ?? '.',
    );

    expect(registry.getPlugin('disabled')).toBeUndefined();
    expect(registry.allPlugins()).toHaveLength(0);
  });

  it('calls onInit lifecycle hook', async () => {
    writeTmpPlugin(
      'init-plugin.mjs',
      `
      let initialized = false;
      export default {
        name: 'init-plugin',
        version: '1.0.0',
        onInit() { initialized = true; },
        middleware: [{
          name: 'init-check',
          middleware: async (ctx, next) => { await next(); },
        }],
      };
    `,
    );

    const registry = await loadPlugins(
      [{ source: './__test_plugins__/init-plugin.mjs' }],
      import.meta.dirname ?? '.',
    );

    expect(registry.getPlugin('init-plugin')).toBeDefined();
  });

  it('throws on invalid plugin (missing name)', async () => {
    writeTmpPlugin(
      'bad-plugin.mjs',
      `export default { version: '1.0.0' };`,
    );

    await expect(
      loadPlugins(
        [{ source: './__test_plugins__/bad-plugin.mjs' }],
        import.meta.dirname ?? '.',
      ),
    ).rejects.toThrow('missing a "name"');
  });

  it('uses existing registry when provided', async () => {
    writeTmpPlugin(
      'addon.mjs',
      `export default { name: 'addon', version: '1.0.0' };`,
    );

    const existing = new PluginRegistry();
    existing.register({ name: 'pre-existing', version: '1.0.0' });

    const registry = await loadPlugins(
      [{ source: './__test_plugins__/addon.mjs' }],
      import.meta.dirname ?? '.',
      existing,
    );

    expect(registry.getPlugin('pre-existing')).toBeDefined();
    expect(registry.getPlugin('addon')).toBeDefined();
  });
});
