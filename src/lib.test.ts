import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismPipe, type PrismPipe } from './lib';

describe('createPrismPipe', () => {
  it('returns an instance with expected interface', () => {
    const proxy = createPrismPipe({ port: 0 });
    expect(proxy).toHaveProperty('start');
    expect(proxy).toHaveProperty('stop');
    expect(proxy).toHaveProperty('port');
    expect(proxy).toHaveProperty('app');
    expect(proxy).toHaveProperty('health');
    expect(typeof proxy.start).toBe('function');
    expect(typeof proxy.stop).toBe('function');
    expect(typeof proxy.health).toBe('function');
  });

  it('health() returns stopped status before start', () => {
    const proxy = createPrismPipe({ port: 0 });
    const h = proxy.health();
    expect(h.status).toBe('stopped');
    expect(h.providers).toEqual([]);
  });

  describe('running instance', () => {
    let proxy: PrismPipe;

    beforeAll(async () => {
      proxy = await createPrismPipe({
        port: 0, // random port
        logLevel: 'silent',
        storeType: 'memory',
        providers: {
          test: {
            baseUrl: 'http://localhost:9999',
            apiKey: 'test-key',
          },
        },
        routes: [
          {
            path: '/v1/chat/completions',
            providers: ['test'],
          },
        ],
      }).start();
    });

    afterAll(async () => {
      await proxy.stop();
    });

    it('listens on assigned port', () => {
      expect(proxy.port).toBeGreaterThan(0);
    });

    it('health() returns healthy status', () => {
      const h = proxy.health();
      expect(h.status).toBe('healthy');
      expect(h.providers).toEqual(['test']);
    });

    it('responds to /health', async () => {
      const res = await fetch(`http://localhost:${proxy.port}/health`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.status).toBe('ok');
    });

    it('responds to /v1/models', async () => {
      const res = await fetch(`http://localhost:${proxy.port}/v1/models`);
      expect(res.ok).toBe(true);
      const body = await res.json();
      expect(body.object).toBe('list');
      expect(body.data).toBeInstanceOf(Array);
    });
  });

  describe('multiple instances', () => {
    let proxy1: PrismPipe;
    let proxy2: PrismPipe;

    beforeAll(async () => {
      [proxy1, proxy2] = await Promise.all([
        createPrismPipe({
          port: 0,
          logLevel: 'silent',
          storeType: 'memory',
        }).start(),
        createPrismPipe({
          port: 0,
          logLevel: 'silent',
          storeType: 'memory',
        }).start(),
      ]);
    });

    afterAll(async () => {
      await Promise.all([proxy1.stop(), proxy2.stop()]);
    });

    it('run on different ports', () => {
      expect(proxy1.port).not.toBe(proxy2.port);
      expect(proxy1.port).toBeGreaterThan(0);
      expect(proxy2.port).toBeGreaterThan(0);
    });

    it('both respond independently', async () => {
      const [r1, r2] = await Promise.all([
        fetch(`http://localhost:${proxy1.port}/health`),
        fetch(`http://localhost:${proxy2.port}/health`),
      ]);
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
    });
  });
});
