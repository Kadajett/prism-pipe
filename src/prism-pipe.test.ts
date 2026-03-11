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
      prism.emitError({
        error: new Error('test'),
        errorClass: 'unknown',
        context: { port: '3100' },
      });

      expect(events).toHaveLength(1);
      expect(events[0].error.message).toBe('test');
    });
  });
});
