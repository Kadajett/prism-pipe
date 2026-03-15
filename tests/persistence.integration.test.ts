import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PrismPipe } from '../src/prism-pipe';
import type { ProxyDefinition } from '../src/core/types';
import * as fs from 'node:fs';
import * as path from 'node:path';

const TEST_DB_PATH = './data/test-persistence.db';

describe('SQLite Persistence Integration', () => {
  // Clean up test database before and after each test
  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it('persists tenant cost tracking across restart', async () => {
    // Phase 1: Create prism with SQLite, record some costs
    const prism1 = new PrismPipe({ storeType: 'sqlite', storePath: TEST_DB_PATH });
    await prism1.initStore();

    const proxyDef: ProxyDefinition = {
      id: 'test-proxy',
      port: 9999,
      providers: {
        openai: { name: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' },
      },
      routes: { '/v1/chat/completions': { providers: ['openai'] } },
    };

    const proxy1 = prism1.createProxy(proxyDef);
    
    // Simulate some tenant costs being recorded
    const tenantId = 'tenant-1';
    const costAmount = 25.50;
    await prism1.store.recordCost({
      tenantId,
      month: '2024-03',
      costUsd: costAmount,
      provider: 'openai',
      model: 'gpt-4',
    });

    // Verify cost was recorded in memory
    let costs = await prism1.store.queryCosts({ tenantId });
    expect(costs).toHaveLength(1);
    expect(costs[0].costUsd).toBe(costAmount);

    await prism1.shutdown();

    // Phase 2: Create a new prism instance with the same database
    const prism2 = new PrismPipe({ storeType: 'sqlite', storePath: TEST_DB_PATH });
    await prism2.initStore();

    // Verify cost was persisted and recovered
    costs = await prism2.store.queryCosts({ tenantId });
    expect(costs).toHaveLength(1);
    expect(costs[0].costUsd).toBe(costAmount);
    expect(costs[0].tenantId).toBe(tenantId);
    expect(costs[0].month).toBe('2024-03');

    await prism2.shutdown();
  });

  it('persists circuit breaker state across restart', async () => {
    // Phase 1: Create prism with SQLite and circuit breaker
    const prism1 = new PrismPipe({ storeType: 'sqlite', storePath: TEST_DB_PATH });
    await prism1.initStore();

    const proxyDef: ProxyDefinition = {
      id: 'test-proxy',
      port: 9998,
      providers: {
        openai: { name: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' },
      },
      routes: { '/v1/chat/completions': { providers: ['openai'] } },
    };

    const proxy1 = prism1.createProxy(proxyDef);
    
    // Manually persist circuit breaker state to test hydration
    const provider = 'openai';
    const now = Date.now();
    await prism1.store.circuitBreakerSet(provider, {
      provider,
      state: 'open',
      consecutiveFailures: 5,
      openedAt: now,
    });

    // Give persistence time
    await new Promise((resolve) => setTimeout(resolve, 100));

    await prism1.shutdown();

    // Phase 2: Create a new prism instance with the same database
    const prism2 = new PrismPipe({ storeType: 'sqlite', storePath: TEST_DB_PATH });
    await prism2.initStore();

    const proxy2 = prism2.createProxy(proxyDef);
    
    // Give hydration time - get the breaker which will trigger async hydration
    const recoveredBreaker = proxy2.circuitBreakers.get(provider);
    
    // Wait for async hydration to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify circuit breaker state was restored
    expect(recoveredBreaker.getState()).toBe('open');
    expect(recoveredBreaker.allowRequest()).toBe(false);

    await prism2.shutdown();
  });

  it('preserves backward compatibility with memory store', async () => {
    // Create prism with memory store (old default)
    const prism = new PrismPipe({ storeType: 'memory' });
    await prism.initStore();

    const proxyDef: ProxyDefinition = {
      id: 'test-proxy',
      port: 9997,
      providers: {
        openai: { name: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' },
      },
      routes: { '/v1/chat/completions': { providers: ['openai'] } },
    };

    const proxy = prism.createProxy(proxyDef);
    
    // Record cost
    const tenantId = 'tenant-memory';
    await prism.store.recordCost({
      tenantId,
      month: '2024-03',
      costUsd: 10,
    });

    // Verify it works
    let costs = await prism.store.queryCosts({ tenantId });
    expect(costs).toHaveLength(1);

    // Circuit breaker works (trips after 5 failures by default)
    const breaker = proxy.circuitBreakers.get('test-provider');
    breaker.recordFailure();
    expect(breaker.getState()).toBe('closed');
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordFailure(); // 5th failure = trip
    expect(breaker.getState()).toBe('open');

    await prism.shutdown();
  });
});
