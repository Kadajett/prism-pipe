import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismPipe, type ProxyInstance } from './lib';

describe('PrismPipe public API', () => {
  it('creates a proxy with the expected lifecycle surface', () => {
    const prism = new PrismPipe();
    const proxy = prism.createProxy({
      port: 0,
      routes: {},
    });

    expect(proxy).toHaveProperty('start');
    expect(proxy).toHaveProperty('stop');
    expect(proxy).toHaveProperty('reload');
    expect(proxy).toHaveProperty('status');
    expect(proxy).toHaveProperty('health');
    expect(typeof proxy.start).toBe('function');
    expect(typeof proxy.stop).toBe('function');
    expect(typeof proxy.reload).toBe('function');
    expect(typeof proxy.status).toBe('function');
  });

  it('reports stopped status before start', () => {
    const prism = new PrismPipe();
    const proxy = prism.createProxy({
      port: 0,
      routes: {},
    });

    expect(proxy.status().state).toBe('stopped');
  });

  describe('running proxy instance', () => {
    let prism: PrismPipe;
    let proxy: ProxyInstance;

    beforeAll(async () => {
      prism = new PrismPipe({
        logLevel: 'silent',
        storeType: 'memory',
      });
      proxy = prism.createProxy({
        port: 0,
        providers: {
          test: {
            name: 'test',
            baseUrl: 'http://localhost:9999',
            apiKey: 'test-key',
          },
        },
        routes: {},
      });

      await proxy.start();
    });

    afterAll(async () => {
      await prism.shutdown();
    });

    it('listens on an assigned port', () => {
      expect(proxy.status().port).toBeGreaterThan(0);
    });

    it('reports healthy status', () => {
      const health = proxy.health();
      expect(health.status).toBe('healthy');
    });

    it('responds to /health', async () => {
      const response = await fetch(`http://localhost:${proxy.status().port}/health`);
      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.status).toBe('ok');
    });

    it('responds to /v1/models', async () => {
      const response = await fetch(`http://localhost:${proxy.status().port}/v1/models`);
      expect(response.ok).toBe(true);
      const body = await response.json();
      expect(body.object).toBe('list');
      expect(body.data).toBeInstanceOf(Array);
    });
  });

  describe('multiple proxies', () => {
    let prism: PrismPipe;
    let proxy1: ProxyInstance;
    let proxy2: ProxyInstance;

    beforeAll(async () => {
      prism = new PrismPipe({
        logLevel: 'silent',
        storeType: 'memory',
      });
      proxy1 = prism.createProxy({
        port: 0,
        routes: {},
      });
      proxy2 = prism.createProxy({
        port: 0,
        routes: {},
      });

      await Promise.all([proxy1.start(), proxy2.start()]);
    });

    afterAll(async () => {
      await prism.shutdown();
    });

    it('runs on different ports', () => {
      expect(proxy1.status().port).not.toBe(proxy2.status().port);
      expect(proxy1.status().port).toBeGreaterThan(0);
      expect(proxy2.status().port).toBeGreaterThan(0);
    });

    it('both respond independently', async () => {
      const [response1, response2] = await Promise.all([
        fetch(`http://localhost:${proxy1.status().port}/health`),
        fetch(`http://localhost:${proxy2.status().port}/health`),
      ]);

      expect(response1.ok).toBe(true);
      expect(response2.ok).toBe(true);
    });
  });
});
