import { describe, it, expect } from 'vitest';
import { diffConfig } from './hot-reload';
import type { ResolvedConfig } from '../core/types';

const baseConfig: ResolvedConfig = {
  port: 3000,
  logLevel: 'info',
  requestTimeout: 30000,
  providers: {
    openai: { name: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' },
  },
  routes: [{ path: '/v1/chat/completions', providers: ['openai'] }],
};

describe('diffConfig', () => {
  it('detects no changes', () => {
    const changes = diffConfig(baseConfig, { ...baseConfig });
    expect(changes).toHaveLength(0);
  });

  it('detects safe changes (logLevel)', () => {
    const newConfig = { ...baseConfig, logLevel: 'debug' };
    const changes = diffConfig(baseConfig, newConfig);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('logLevel');
    expect(changes[0].safe).toBe(true);
    expect(changes[0].newValue).toBe('debug');
  });

  it('detects restart-required changes (port)', () => {
    const newConfig = { ...baseConfig, port: 4000 };
    const changes = diffConfig(baseConfig, newConfig);
    expect(changes).toHaveLength(1);
    expect(changes[0].field).toBe('port');
    expect(changes[0].safe).toBe(false);
  });

  it('detects provider changes as safe', () => {
    const newConfig = {
      ...baseConfig,
      providers: {
        openai: { name: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-new' },
        anthropic: { name: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKey: 'ant-test' },
      },
    };
    const changes = diffConfig(baseConfig, newConfig);
    const providerChange = changes.find((c) => c.field === 'providers');
    expect(providerChange).toBeDefined();
    expect(providerChange!.safe).toBe(true);
  });

  it('detects multiple changes', () => {
    const newConfig = { ...baseConfig, port: 4000, logLevel: 'debug', requestTimeout: 60000 };
    const changes = diffConfig(baseConfig, newConfig);
    expect(changes).toHaveLength(3);
    expect(changes.filter((c) => c.safe)).toHaveLength(2); // logLevel + requestTimeout
    expect(changes.filter((c) => !c.safe)).toHaveLength(1); // port
  });
});
