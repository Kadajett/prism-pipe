import { describe, it, expect, vi } from 'vitest';
import { diffConfig, ConfigWatcher } from '../../../src/admin/config-reload.js';
import type { ResolvedConfig } from '../../../src/core/types.js';

const baseConfig: ResolvedConfig = {
  port: 3000,
  logLevel: 'info',
  requestTimeout: 120_000,
  providers: {
    openai: { name: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' },
  },
  routes: [{ path: '/v1/chat/completions', providers: ['openai'] }],
};

describe('diffConfig', () => {
  it('detects no changes', () => {
    const diffs = diffConfig(baseConfig, { ...baseConfig });
    expect(diffs).toHaveLength(0);
  });

  it('detects safe logLevel change', () => {
    const newConfig = { ...baseConfig, logLevel: 'debug' };
    const diffs = diffConfig(baseConfig, newConfig);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe('logLevel');
    expect(diffs[0].safeToApply).toBe(true);
  });

  it('detects unsafe port change', () => {
    const newConfig = { ...baseConfig, port: 8080 };
    const diffs = diffConfig(baseConfig, newConfig);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe('port');
    expect(diffs[0].safeToApply).toBe(false);
  });

  it('detects provider changes', () => {
    const newConfig = {
      ...baseConfig,
      providers: {
        openai: baseConfig.providers.openai,
        anthropic: { name: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'sk-ant' },
      },
    };
    const diffs = diffConfig(baseConfig, newConfig);
    expect(diffs.some((d) => d.field === 'providers')).toBe(true);
  });
});

describe('ConfigWatcher.reload', () => {
  it('applies safe changes via reload()', () => {
    const onReload = vi.fn();
    const newConfig = { ...baseConfig, logLevel: 'debug' };
    const watcher = new ConfigWatcher({
      configPath: '/tmp/nonexistent.yaml',
      currentConfig: { ...baseConfig },
      loadFn: () => newConfig,
      onReload,
    });

    const result = watcher.reload();
    expect(result.status).toBe('applied');
    expect(onReload).toHaveBeenCalled();
  });

  it('warns on restart-required changes', () => {
    const onReload = vi.fn();
    const newConfig = { ...baseConfig, port: 8080, logLevel: 'debug' };
    const watcher = new ConfigWatcher({
      configPath: '/tmp/nonexistent.yaml',
      currentConfig: { ...baseConfig },
      loadFn: () => newConfig,
      onReload,
    });

    const result = watcher.reload();
    expect(result.status).toBe('warnings');
    if (result.status === 'warnings') {
      expect(result.restartRequired).toContain('port');
    }
  });

  it('handles load errors gracefully', () => {
    const watcher = new ConfigWatcher({
      configPath: '/tmp/nonexistent.yaml',
      currentConfig: { ...baseConfig },
      loadFn: () => {
        throw new Error('Parse error');
      },
      onReload: vi.fn(),
    });

    const result = watcher.reload();
    expect(result.status).toBe('error');
  });
});
