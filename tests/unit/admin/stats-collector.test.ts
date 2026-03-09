import { describe, it, expect, beforeEach } from 'vitest';
import { StatsCollector } from '../../../src/admin/stats-collector.js';

describe('StatsCollector', () => {
  let collector: StatsCollector;

  beforeEach(() => {
    collector = new StatsCollector();
  });

  it('returns zero stats when empty', () => {
    const stats = collector.getStats();
    expect(stats.requestsTotal).toBe(0);
    expect(stats.requestsPerSecond).toBe(0);
    expect(stats.activeRequests).toBe(0);
  });

  it('records requests and reflects in stats', () => {
    collector.recordRequest({
      timestamp: Date.now(),
      latencyMs: 100,
      provider: 'openai',
      error: false,
      inputTokens: 50,
      outputTokens: 100,
      estimatedCostUsd: 0.01,
      tenantId: 'tenant-1',
      model: 'gpt-4',
    });

    const stats = collector.getStats();
    expect(stats.requestsTotal).toBe(1);
    expect(stats.providerStats.openai).toBeDefined();
    expect(stats.providerStats.openai.requestsTotal).toBe(1);
    expect(stats.providerStats.openai.status).toBe('healthy');
  });

  it('tracks active requests', () => {
    collector.incrementActive();
    collector.incrementActive();
    expect(collector.getStats().activeRequests).toBe(2);
    collector.decrementActive();
    expect(collector.getStats().activeRequests).toBe(1);
  });

  it('does not go below zero active', () => {
    collector.decrementActive();
    expect(collector.getStats().activeRequests).toBe(0);
  });

  it('marks provider as degraded/down based on error rate', () => {
    for (let i = 0; i < 10; i++) {
      collector.recordRequest({
        timestamp: Date.now(),
        latencyMs: 100,
        provider: 'bad-provider',
        error: true,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
      });
    }
    const stats = collector.getStats();
    expect(stats.providerStats['bad-provider'].status).toBe('down');
  });

  it('getCosts returns filtered entries', () => {
    const now = Date.now();
    collector.recordRequest({
      timestamp: now - 10000,
      latencyMs: 50,
      provider: 'openai',
      error: false,
      inputTokens: 10,
      outputTokens: 20,
      estimatedCostUsd: 0.005,
      tenantId: 'tenant-1',
      model: 'gpt-4',
    });
    collector.recordRequest({
      timestamp: now,
      latencyMs: 50,
      provider: 'anthropic',
      error: false,
      inputTokens: 10,
      outputTokens: 20,
      estimatedCostUsd: 0.003,
      tenantId: 'tenant-2',
      model: 'claude-3',
    });

    const all = collector.getCosts();
    expect(all).toHaveLength(2);

    const filtered = collector.getCosts({ from: now - 5000 });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].provider).toBe('anthropic');
  });

  it('getTenantCosts sums for a tenant', () => {
    collector.recordRequest({
      timestamp: Date.now(),
      latencyMs: 50,
      provider: 'openai',
      error: false,
      inputTokens: 100,
      outputTokens: 200,
      estimatedCostUsd: 0.05,
      tenantId: 'tenant-1',
    });
    collector.recordRequest({
      timestamp: Date.now(),
      latencyMs: 50,
      provider: 'openai',
      error: false,
      inputTokens: 100,
      outputTokens: 200,
      estimatedCostUsd: 0.03,
      tenantId: 'tenant-1',
    });

    const result = collector.getTenantCosts('tenant-1');
    expect(result.totalCostUsd).toBeCloseTo(0.08);
  });
});
