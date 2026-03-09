import { describe, it, expect } from 'vitest';
import { PluginRegistry, NamingConflictError } from './registry.js';
import type { Plugin } from './types.js';

function makePlugin(overrides: Partial<Plugin> & { name: string }): Plugin {
  return { version: '1.0.0', ...overrides };
}

describe('PluginRegistry', () => {
  it('registers a plugin and retrieves it', () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin({ name: 'test-plugin' });
    registry.register(plugin);
    expect(registry.getPlugin('test-plugin')).toBe(plugin);
    expect(registry.allPlugins()).toHaveLength(1);
  });

  it('registers middleware and retrieves by name', () => {
    const registry = new PluginRegistry();
    const mw = { name: 'log-stuff', middleware: async () => {}, priority: 50 };
    registry.register(makePlugin({ name: 'p1', middleware: [mw] }));
    expect(registry.getMiddleware('log-stuff')).toBe(mw);
  });

  it('sorts middleware by priority', () => {
    const registry = new PluginRegistry();
    const mwA = { name: 'a', middleware: async () => {}, priority: 200 };
    const mwB = { name: 'b', middleware: async () => {}, priority: 10 };
    const mwC = { name: 'c', middleware: async () => {} }; // default 100
    registry.register(makePlugin({ name: 'p1', middleware: [mwA, mwB, mwC] }));

    const all = registry.allMiddleware();
    expect(all.map((m) => m.name)).toEqual(['b', 'c', 'a']);
  });

  it('prevents duplicate plugin names', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin({ name: 'dup' }));
    expect(() => registry.register(makePlugin({ name: 'dup' }))).toThrow('already registered');
  });

  it('detects middleware naming conflicts across plugins', () => {
    const registry = new PluginRegistry();
    const mw = { name: 'shared-name', middleware: async () => {} };

    registry.register(makePlugin({ name: 'p1', middleware: [mw] }));

    expect(() =>
      registry.register(makePlugin({ name: 'p2', middleware: [{ ...mw }] })),
    ).toThrow(NamingConflictError);
  });

  it('detects store naming conflicts', () => {
    const registry = new PluginRegistry();
    const store = { name: 'redis', factory: () => ({}) as any };

    registry.register(makePlugin({ name: 'p1', stores: [store] }));

    expect(() =>
      registry.register(makePlugin({ name: 'p2', stores: [{ ...store }] })),
    ).toThrow(NamingConflictError);
  });

  it('atomic registration: no partial state on conflict', () => {
    const registry = new PluginRegistry();
    const mw1 = { name: 'unique-mw', middleware: async () => {} };
    registry.register(makePlugin({ name: 'p1', middleware: [{ name: 'taken', middleware: async () => {} }] }));

    // p2 has a unique middleware and a conflicting one — entire registration should fail
    expect(() =>
      registry.register(
        makePlugin({
          name: 'p2',
          middleware: [mw1, { name: 'taken', middleware: async () => {} }],
        }),
      ),
    ).toThrow(NamingConflictError);

    // unique-mw should NOT have been registered
    expect(registry.getMiddleware('unique-mw')).toBeUndefined();
    expect(registry.getPlugin('p2')).toBeUndefined();
  });

  it('provides a summary', () => {
    const registry = new PluginRegistry();
    registry.register(
      makePlugin({
        name: 'full',
        middleware: [{ name: 'mw1', middleware: async () => {} }],
        stores: [{ name: 's1', factory: () => ({}) as any }],
      }),
    );
    const summary = registry.summary();
    expect(summary.middleware).toEqual(['mw1']);
    expect(summary.store).toEqual(['s1']);
  });
});
