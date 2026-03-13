import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProxyErrorEvent } from './core/types';
import { PrismPipe } from './prism-pipe';
import { ProxyInstance } from './proxy-instance';

describe('PrismPipe', () => {
  it('creates instance with shared store and transforms', () => {
    const prism = new PrismPipe();
    expect(prism.store).toBeDefined();
    expect(prism.transforms).toBeDefined();
    expect(prism.proxies).toEqual([]);
  });

  it('registers custom transforms', () => {
    const prism = new PrismPipe();
    // OpenAI and Anthropic should be pre-registered
    expect(prism.transforms.has('openai')).toBe(true);
    expect(prism.transforms.has('anthropic')).toBe(true);
  });

  describe('createProxy', () => {
    it('returns a ProxyInstance and adds it to proxies array', () => {
      const prism = new PrismPipe();
      const proxy = prism.createProxy({
        port: 0,
        routes: {},
      });
      expect(proxy).toBeInstanceOf(ProxyInstance);
      expect(prism.proxies).toHaveLength(1);
      expect(prism.proxies[0]).toBe(proxy);
    });

    it('supports creating multiple proxies', () => {
      const prism = new PrismPipe();
      const proxy1 = prism.createProxy({ port: 0, routes: {} });
      const proxy2 = prism.createProxy({ port: 0, routes: {} });
      expect(prism.proxies).toHaveLength(2);
      expect(proxy1.id).not.toBe(proxy2.id);
    });
  });

  describe('proxy lifecycle', () => {
    let prism: PrismPipe;
    let proxy: ProxyInstance;

    beforeAll(async () => {
      prism = new PrismPipe({ storeType: 'memory' });
      proxy = prism.createProxy({
        port: 0,
        providers: {
          test: {
            name: 'test',
            baseUrl: 'http://localhost:9999',
            apiKey: 'test-key',
          },
        },
        routes: {
          '/v1/chat/completions': {
            providers: ['test'],
          },
        },
      });
      await proxy.start();
    });

    afterAll(async () => {
      await prism.shutdown();
    });

    it('proxy is started on an assigned port', () => {
      expect(proxy.status().port).toBeGreaterThan(0);
    });

    it('health returns healthy status', () => {
      const h = proxy.health();
      expect(h.status).toBe('healthy');
    });

    it('stats are available', () => {
      const stats = proxy.stats.getStats();
      expect(stats).toHaveProperty('requests');
      expect(stats).toHaveProperty('tokens');
      expect(stats).toHaveProperty('latency');
    });

    it('circuit breakers are available', () => {
      expect(proxy.circuitBreakers).toBeDefined();
      const cb = proxy.circuitBreakers.get('test');
      expect(cb.getState()).toBe('closed');
    });

    it('proxy responds to health endpoint', async () => {
      const res = await fetch(`http://localhost:${proxy.status().port}/health`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });

    it('proxy responds to /v1/models', async () => {
      const res = await fetch(`http://localhost:${proxy.status().port}/v1/models`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.object).toBe('list');
    });
  });

  describe('two separate proxies with shared store', () => {
    let prism: PrismPipe;
    let proxy1: ProxyInstance;
    let proxy2: ProxyInstance;

    beforeAll(async () => {
      prism = new PrismPipe({ storeType: 'memory' });

      proxy1 = prism.createProxy({
        port: 0,
        providers: {
          a: { name: 'a', baseUrl: 'http://localhost:9999', apiKey: 'k' },
        },
        routes: {
          '/v1/chat/completions': { providers: ['a'] },
        },
      });

      proxy2 = prism.createProxy({
        port: 0,
        providers: {
          b: { name: 'b', baseUrl: 'http://localhost:9998', apiKey: 'k' },
        },
        routes: {
          '/v1/chat/completions': { providers: ['b'] },
        },
      });

      await Promise.all([proxy1.start(), proxy2.start()]);
    });

    afterAll(async () => {
      await prism.shutdown();
    });

    it('both proxies share the same store', () => {
      // They reference the same parent store
      expect(prism.proxies).toHaveLength(2);
    });

    it('both proxies are healthy independently', () => {
      expect(proxy1.health().status).toBe('healthy');
      expect(proxy2.health().status).toBe('healthy');
    });

    it('both respond to health checks', async () => {
      for (const proxy of [proxy1, proxy2]) {
        const res = await fetch(`http://localhost:${proxy.status().port}/health`);
        expect(res.ok).toBe(true);
      }
    });
  });

  describe('shutdown', () => {
    it('stops all proxies and closes store', async () => {
      const prism = new PrismPipe({ storeType: 'memory' });
      const proxy = prism.createProxy({
        port: 0,
        routes: {},
      });
      await proxy.start();
      expect(proxy.health().status).toBe('healthy');

      await prism.shutdown();
      expect(proxy.health().status).toBe('stopped');
    });
  });

  describe('error handlers', () => {
    it('global error handler receives events', () => {
      const prism = new PrismPipe();
      const events: ProxyErrorEvent[] = [];
      prism.onError((e) => events.push(e));

      // Simulate error emission
      // Access private method via type cast for testing
      // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
      (prism as any).emitError({
        error: new Error('test'),
        errorClass: 'unknown',
        context: { port: '3100' },
      });

      expect(events).toHaveLength(1);
      expect(events[0].error.message).toBe('test');
    });

    it('proxy-level error handler receives events before global', () => {
      const prism = new PrismPipe();
      const order: string[] = [];

      const proxy = prism.createProxy({ port: 0, routes: {} });

      proxy.onError(() => order.push('proxy'));
      prism.onError(() => order.push('global'));

      // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
      (proxy as any).emitError({
        error: new Error('test'),
        errorClass: 'unknown',
        context: {},
      });

      expect(order).toEqual(['proxy', 'global']);
    });

    it('error handler exceptions do not crash the proxy', () => {
      const prism = new PrismPipe();
      const proxy = prism.createProxy({ port: 0, routes: {} });

      proxy.onError(() => {
        throw new Error('handler crash');
      });

      const received: ProxyErrorEvent[] = [];
      prism.onError((e) => received.push(e));

      // Should not throw
      // biome-ignore lint/suspicious/noExplicitAny: accessing private method for testing
      (proxy as any).emitError({
        error: new Error('original'),
        errorClass: 'unknown',
        context: {},
      });

      // Global handler still called despite proxy handler crash
      expect(received).toHaveLength(1);
      expect(received[0].error.message).toBe('original');
    });
  });

  describe('error bubbling via live request', () => {
    let prism: PrismPipe;
    let proxy: ProxyInstance;

    afterAll(async () => {
      await prism.shutdown();
    });

    it('errors from route requests bubble to proxy and global handlers', async () => {
      prism = new PrismPipe({ storeType: 'memory' });
      const proxyEvents: ProxyErrorEvent[] = [];
      const globalEvents: ProxyErrorEvent[] = [];

      proxy = prism.createProxy({
        port: 0,
        providers: {
          broken: {
            name: 'broken',
            baseUrl: 'http://localhost:1', // unreachable
            apiKey: 'test-key',
          },
        },
        routes: {
          '/v1/chat/completions': {
            providers: ['broken'],
          },
        },
      });

      proxy.onError((e) => proxyEvents.push(e));
      prism.onError((e) => globalEvents.push(e));

      await proxy.start();

      const res = await fetch(`http://localhost:${proxy.status().port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });

      // Request should fail
      expect(res.ok).toBe(false);

      // Error should have bubbled to both handlers
      expect(proxyEvents.length).toBeGreaterThanOrEqual(1);
      expect(globalEvents.length).toBeGreaterThanOrEqual(1);
      expect(proxyEvents[0].context.route).toBe('/v1/chat/completions');
      expect(proxyEvents[0].context.requestId).toBeDefined();
    });
  });

  describe('queryable logs', () => {
    let prism: PrismPipe;
    let proxy: ProxyInstance;

    afterAll(async () => {
      await prism.shutdown();
    });

    it('getLogs returns filtered entries at both prism and proxy level', async () => {
      prism = new PrismPipe({ storeType: 'memory' });
      proxy = prism.createProxy({
        port: 0,
        providers: {
          test: {
            name: 'test',
            baseUrl: 'http://localhost:1',
            apiKey: 'key',
          },
        },
        routes: {
          '/v1/chat/completions': { providers: ['test'] },
        },
      });
      await proxy.start();

      // Make a request (will fail, but gets logged)
      await fetch(`http://localhost:${proxy.status().port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
      });

      // Wait for async log write
      await new Promise((r) => setTimeout(r, 100));

      const proxyLogs = await proxy.getLogs();
      const globalLogs = await prism.getLogs();

      expect(proxyLogs.length).toBeGreaterThanOrEqual(1);
      expect(globalLogs.length).toBeGreaterThanOrEqual(1);
      // Proxy logs should be scoped
      expect(proxyLogs[0].proxy_id).toBe(proxy.id);
    });
  });

  describe('usage aggregation', () => {
    it('getUsage returns correct structure', async () => {
      const prism = new PrismPipe({ storeType: 'memory' });
      await prism.initStore();

      // Seed usage data directly
      await prism.store.recordUsage([
        {
          request_id: 'r1',
          timestamp: Date.now(),
          model: 'gpt-4',
          provider: 'openai',
          input_tokens: 100,
          output_tokens: 50,
          thinking_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          proxy_id: 'p1',
          route_path: '/v1/chat/completions',
        },
        {
          request_id: 'r2',
          timestamp: Date.now(),
          model: 'claude-3',
          provider: 'anthropic',
          input_tokens: 200,
          output_tokens: 100,
          thinking_tokens: 10,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          proxy_id: 'p1',
          route_path: '/v1/chat/completions',
        },
      ]);

      const usage = await prism.getUsage();
      expect(usage.inputTokens).toBe(300);
      expect(usage.outputTokens).toBe(150);
      expect(usage.requests).toBe(2);

      const byModel = await prism.getUsageByModel();
      expect(byModel['gpt-4']).toBeDefined();
      expect(byModel['gpt-4'].inputTokens).toBe(100);
      expect(byModel['claude-3']).toBeDefined();
      expect(byModel['claude-3'].inputTokens).toBe(200);

      const byRoute = await prism.getUsageByRoute();
      expect(byRoute['/v1/chat/completions']).toBeDefined();

      await prism.shutdown();
    });

    it('getUsage respects date range filters', async () => {
      const prism = new PrismPipe({ storeType: 'memory' });
      await prism.initStore();

      const now = Date.now();
      const oneHourAgo = now - 3600_000;
      const twoHoursAgo = now - 7200_000;

      await prism.store.recordUsage([
        {
          request_id: 'old',
          timestamp: twoHoursAgo,
          model: 'gpt-4',
          provider: 'openai',
          input_tokens: 100,
          output_tokens: 50,
          thinking_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          proxy_id: 'p1',
          route_path: '/v1/chat/completions',
        },
        {
          request_id: 'recent',
          timestamp: now,
          model: 'gpt-4',
          provider: 'openai',
          input_tokens: 200,
          output_tokens: 100,
          thinking_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          proxy_id: 'p1',
          route_path: '/v1/chat/completions',
        },
      ]);

      // Filter to only recent entries
      const usage = await prism.getUsage({ since: oneHourAgo });
      expect(usage.inputTokens).toBe(200);
      expect(usage.outputTokens).toBe(100);
      expect(usage.requests).toBe(1);

      await prism.shutdown();
    });

    it('getUsage filters by provider', async () => {
      const prism = new PrismPipe({ storeType: 'memory' });
      await prism.initStore();

      await prism.store.recordUsage([
        {
          request_id: 'r1',
          timestamp: Date.now(),
          model: 'gpt-4',
          provider: 'openai',
          input_tokens: 100,
          output_tokens: 50,
          thinking_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          proxy_id: 'p1',
          route_path: '/v1/chat/completions',
        },
        {
          request_id: 'r2',
          timestamp: Date.now(),
          model: 'claude-3',
          provider: 'anthropic',
          input_tokens: 200,
          output_tokens: 100,
          thinking_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          proxy_id: 'p1',
          route_path: '/v1/chat/completions',
        },
      ]);

      const usage = await prism.getUsage({ provider: 'openai' });
      expect(usage.inputTokens).toBe(100);
      expect(usage.requests).toBe(1);

      await prism.shutdown();
    });

    it('getUsage filters by model', async () => {
      const prism = new PrismPipe({ storeType: 'memory' });
      await prism.initStore();

      await prism.store.recordUsage([
        {
          request_id: 'r1',
          timestamp: Date.now(),
          model: 'gpt-4',
          provider: 'openai',
          input_tokens: 100,
          output_tokens: 50,
          thinking_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          proxy_id: 'p1',
          route_path: '/v1/chat/completions',
        },
        {
          request_id: 'r2',
          timestamp: Date.now(),
          model: 'claude-3',
          provider: 'anthropic',
          input_tokens: 200,
          output_tokens: 100,
          thinking_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          proxy_id: 'p1',
          route_path: '/v1/chat/completions',
        },
      ]);

      const usage = await prism.getUsage({ model: 'claude-3' });
      expect(usage.inputTokens).toBe(200);
      expect(usage.requests).toBe(1);

      await prism.shutdown();
    });
  });

  describe('queryable logs — filters and pagination', () => {
    let prism: PrismPipe;

    beforeEach(async () => {
      prism = new PrismPipe({ storeType: 'memory' });
      await prism.initStore();

      // Seed log entries
      const baseEntry = {
        method: 'POST',
        source_ip: '127.0.0.1',
        input_tokens: 10,
        output_tokens: 5,
        proxy_id: 'proxy-1',
      };

      await prism.store.logRequest({
        ...baseEntry,
        request_id: 'log-1',
        timestamp: Date.now() - 7200_000,
        path: '/v1/chat/completions',
        route_path: '/v1/chat/completions',
        provider: 'openai',
        model: 'gpt-4',
        status: 200,
        latency_ms: 100,
      });

      await prism.store.logRequest({
        ...baseEntry,
        request_id: 'log-2',
        timestamp: Date.now() - 3600_000,
        path: '/v1/chat/completions',
        route_path: '/v1/chat/completions',
        provider: 'anthropic',
        model: 'claude-3',
        status: 500,
        latency_ms: 200,
        error_class: 'upstream_error',
      });

      await prism.store.logRequest({
        ...baseEntry,
        request_id: 'log-3',
        timestamp: Date.now(),
        path: '/v1/embeddings',
        route_path: '/v1/embeddings',
        provider: 'openai',
        model: 'text-embedding-3',
        status: 200,
        latency_ms: 50,
      });
    });

    afterEach(async () => {
      await prism.shutdown();
    });

    it('filters logs by time range', async () => {
      const logs = await prism.getLogs({ since: Date.now() - 5400_000 });
      // Should get log-2 and log-3, not log-1
      expect(logs.length).toBe(2);
      expect(logs.every((l) => l.request_id !== 'log-1')).toBe(true);
    });

    it('filters logs by status', async () => {
      const logs = await prism.getLogs({ status: 500 });
      expect(logs.length).toBe(1);
      expect(logs[0].request_id).toBe('log-2');
    });

    it('filters logs by provider', async () => {
      const logs = await prism.getLogs({ provider: 'anthropic' });
      expect(logs.length).toBe(1);
      expect(logs[0].provider).toBe('anthropic');
    });

    it('filters logs by model', async () => {
      const logs = await prism.getLogs({ model: 'text-embedding-3' });
      expect(logs.length).toBe(1);
      expect(logs[0].model).toBe('text-embedding-3');
    });

    it('filters logs by error class', async () => {
      const logs = await prism.getLogs({ errorClass: 'upstream_error' });
      expect(logs.length).toBe(1);
      expect(logs[0].error_class).toBe('upstream_error');
    });

    it('supports text search across path and model', async () => {
      const logs = await prism.getLogs({ search: 'embedding' });
      expect(logs.length).toBe(1);
      expect(logs[0].path).toContain('embeddings');
    });

    it('supports pagination with limit and offset', async () => {
      const page1 = await prism.getLogs({ limit: 2, offset: 0 });
      expect(page1.length).toBe(2);

      const page2 = await prism.getLogs({ limit: 2, offset: 2 });
      expect(page2.length).toBe(1);

      // No overlap
      const page1Ids = page1.map((l) => l.request_id);
      const page2Ids = page2.map((l) => l.request_id);
      expect(page1Ids.some((id) => page2Ids.includes(id))).toBe(false);
    });
  });

  describe('unhandled errors fall through to Express', () => {
    it('errors without handlers still return error response', async () => {
      const prism = new PrismPipe({ storeType: 'memory' });
      // No .onError() registered — errors should fall through

      const proxy = prism.createProxy({
        port: 0,
        providers: {
          broken: {
            name: 'broken',
            baseUrl: 'http://localhost:1',
            apiKey: 'test-key',
          },
        },
        routes: {
          '/v1/chat/completions': {
            providers: ['broken'],
          },
        },
      });

      await proxy.start();

      const res = await fetch(`http://localhost:${proxy.status().port}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'test-model',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      });

      // Express error handler should still produce a proper error response
      expect(res.ok).toBe(false);
      const body = await res.json();
      expect(body.error).toBeDefined();

      await prism.shutdown();
    });
  });
});
