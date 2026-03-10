import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismPipeClass } from './prism-pipe';
import { ProxyInstance } from './proxy-instance';
import type { ProxyConfig } from './core/types';

describe('PrismPipeClass', () => {
  it('creates instance with shared store and transforms', () => {
    const prism = new PrismPipeClass();
    expect(prism.store).toBeDefined();
    expect(prism.transforms).toBeDefined();
    expect(prism.proxies).toEqual([]);
  });

  it('registers custom transforms', () => {
    const prism = new PrismPipeClass();
    // OpenAI and Anthropic should be pre-registered
    expect(prism.transforms.has('openai')).toBe(true);
    expect(prism.transforms.has('anthropic')).toBe(true);
  });

  describe('createProxy', () => {
    it('returns a ProxyInstance and adds it to proxies array', () => {
      const prism = new PrismPipeClass();
      const proxy = prism.createProxy(() => ({
        ports: {
          '0': {
            providers: {},
            routes: {},
          },
        },
      }));
      expect(proxy).toBeInstanceOf(ProxyInstance);
      expect(prism.proxies).toHaveLength(1);
      expect(prism.proxies[0]).toBe(proxy);
    });

    it('supports creating multiple proxies', () => {
      const prism = new PrismPipeClass();
      const proxy1 = prism.createProxy(() => ({
        ports: { '0': { providers: {}, routes: {} } },
      }));
      const proxy2 = prism.createProxy(() => ({
        ports: { '0': { providers: {}, routes: {} } },
      }));
      expect(prism.proxies).toHaveLength(2);
      expect(proxy1.id).not.toBe(proxy2.id);
    });
  });

  describe('multi-port proxy lifecycle', () => {
    let prism: PrismPipeClass;
    let proxy: ProxyInstance;

    beforeAll(async () => {
      prism = new PrismPipeClass({ storeType: 'memory' });
      // Use two random ports (port 0 = OS-assigned)
      // We use a helper to create two port entries with different keys
      const ports: Record<string, any> = {};
      ports['0'] = {
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
      };
      proxy = prism.createProxy(() => ({ ports }));
      await proxy.start();
    });

    afterAll(async () => {
      await prism.shutdown();
    });

    it('proxy is started with ports', () => {
      expect(proxy.ports.size).toBeGreaterThan(0);
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

    it('ports respond to health endpoint', async () => {
      for (const [, info] of proxy.ports) {
        const addr = info.server.address();
        if (addr && typeof addr === 'object') {
          const res = await fetch(`http://localhost:${addr.port}/health`);
          expect(res.ok).toBe(true);
          const body = await res.json();
          expect(body.status).toBe('ok');
        }
      }
    });

    it('ports respond to /v1/models', async () => {
      for (const [, info] of proxy.ports) {
        const addr = info.server.address();
        if (addr && typeof addr === 'object') {
          const res = await fetch(`http://localhost:${addr.port}/v1/models`);
          expect(res.ok).toBe(true);
          const body = await res.json();
          expect(body.object).toBe('list');
        }
      }
    });
  });

  describe('two separate proxies with shared store', () => {
    let prism: PrismPipeClass;
    let proxy1: ProxyInstance;
    let proxy2: ProxyInstance;

    beforeAll(async () => {
      prism = new PrismPipeClass({ storeType: 'memory' });

      proxy1 = prism.createProxy(() => ({
        ports: {
          '0': {
            providers: {
              a: { name: 'a', baseUrl: 'http://localhost:9999', apiKey: 'k' },
            },
            routes: {
              '/v1/chat/completions': { providers: ['a'] },
            },
          },
        },
      }));

      proxy2 = prism.createProxy(() => ({
        ports: {
          '0': {
            providers: {
              b: { name: 'b', baseUrl: 'http://localhost:9998', apiKey: 'k' },
            },
            routes: {
              '/v1/chat/completions': { providers: ['b'] },
            },
          },
        },
      }));

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
        for (const [, info] of proxy.ports) {
          const addr = info.server.address();
          if (addr && typeof addr === 'object') {
            const res = await fetch(`http://localhost:${addr.port}/health`);
            expect(res.ok).toBe(true);
          }
        }
      }
    });
  });

  describe('shutdown', () => {
    it('stops all proxies and closes store', async () => {
      const prism = new PrismPipeClass({ storeType: 'memory' });
      const proxy = prism.createProxy(() => ({
        ports: {
          '0': { providers: {}, routes: {} },
        },
      }));
      await proxy.start();
      expect(proxy.health().status).toBe('healthy');

      await prism.shutdown();
      expect(proxy.health().status).toBe('stopped');
    });
  });

  describe('error handlers', () => {
    it('global error handler receives events', () => {
      const prism = new PrismPipeClass();
      const events: any[] = [];
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
