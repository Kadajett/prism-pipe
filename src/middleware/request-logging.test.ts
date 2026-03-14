import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../store/memory';
import { createRequestLoggingMiddleware } from './request-logging';

describe('Request Logging Middleware', () => {
  let app: Express;
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.init();

    app = express();
    app.use(express.json());

    // Simulate the request ID middleware
    app.use((req, _res, next) => {
      const requestState = req as unknown as Record<string, unknown>;
      requestState.requestId = 'test-request-id';
      requestState.port = '8080';
      requestState.proxyId = 'proxy-1';
      next();
    });

    // Add the request logging middleware
    app.use(createRequestLoggingMiddleware({ store }));
  });

  afterEach(async () => {
    await store.close();
  });

  it('should log successful requests', async () => {
    app.get('/test', (req, res) => {
      if (req.logMetadata) {
        req.logMetadata.model = 'gpt-4';
        req.logMetadata.provider = 'openai';
        req.logMetadata.inputTokens = 100;
        req.logMetadata.outputTokens = 200;
      }
      res.json({ message: 'success' });
    });

    await request(app).get('/test').expect(200);

    // Wait a bit for async logging
    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await store.queryLogs({});
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      request_id: 'test-request-id',
      method: 'GET',
      path: '/test',
      provider: 'openai',
      model: 'gpt-4',
      status: 200,
      input_tokens: 100,
      output_tokens: 200,
      port: '8080',
      proxy_id: 'proxy-1',
    });
    expect(logs[0].latency_ms).toBeGreaterThan(0);
  });

  it('should log error responses', async () => {
    app.get('/error', (req, res) => {
      if (req.logMetadata) {
        req.logMetadata.model = 'gpt-4';
        req.logMetadata.provider = 'openai';
        req.logMetadata.errorClass = 'rate_limit';
      }
      res.status(429).json({ error: 'Rate limit exceeded' });
    });

    await request(app).get('/error').expect(429);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await store.queryLogs({});
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      request_id: 'test-request-id',
      method: 'GET',
      path: '/error',
      provider: 'openai',
      model: 'gpt-4',
      status: 429,
      error_class: 'rate_limit',
    });
  });

  it('should handle requests with missing metadata gracefully', async () => {
    app.get('/minimal', (_req, res) => {
      res.json({ message: 'ok' });
    });

    await request(app).get('/minimal').expect(200);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await store.queryLogs({});
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      request_id: 'test-request-id',
      method: 'GET',
      path: '/minimal',
      provider: 'unknown',
      model: 'untracked',
      status: 200,
      input_tokens: 0,
      output_tokens: 0,
    });
  });

  it('should log requests with tenant context', async () => {
    app.get('/tenant', (req, res) => {
      // Simulate tenant middleware
      (req as unknown as Record<string, unknown>).tenant = { tenantId: 'tenant-123' };

      if (req.logMetadata) {
        req.logMetadata.tenantId = 'tenant-123';
        req.logMetadata.model = 'gpt-4';
        req.logMetadata.provider = 'openai';
      }
      res.json({ message: 'success' });
    });

    await request(app).get('/tenant').expect(200);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await store.queryLogs({});
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      tenant_id: 'tenant-123',
    });
  });

  it('should log compose metadata', async () => {
    app.post('/compose', (req, res) => {
      if (req.logMetadata) {
        req.logMetadata.model = 'compose';
        req.logMetadata.provider = 'compose';
        req.logMetadata.composeSteps = 3;
        req.logMetadata.inputTokens = 150;
        req.logMetadata.outputTokens = 250;
      }
      res.json({ result: 'composed' });
    });

    await request(app).post('/compose').send({ data: 'test' }).expect(200);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await store.queryLogs({});
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      compose_steps: 3,
      model: 'compose',
      provider: 'compose',
    });
  });

  it('should log fallback usage', async () => {
    app.get('/fallback', (req, res) => {
      if (req.logMetadata) {
        req.logMetadata.model = 'gpt-4';
        req.logMetadata.provider = 'anthropic';
        req.logMetadata.fallbackUsed = true;
        req.logMetadata.upstreamLatencyMs = 1500;
      }
      res.json({ message: 'success' });
    });

    await request(app).get('/fallback').expect(200);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await store.queryLogs({});
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      fallback_used: true,
      upstream_latency_ms: 1500,
    });
  });

  it('should handle multiple requests correctly', async () => {
    app.get('/multi/:id', (req, res) => {
      if (req.logMetadata) {
        req.logMetadata.model = `model-${req.params.id}`;
        req.logMetadata.provider = 'openai';
      }
      res.json({ id: req.params.id });
    });

    // Make 3 concurrent requests
    await Promise.all([
      request(app).get('/multi/1').expect(200),
      request(app).get('/multi/2').expect(200),
      request(app).get('/multi/3').expect(200),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await store.queryLogs({});
    expect(logs).toHaveLength(3);
  });

  it('should handle route path metadata', async () => {
    app.post('/v1/chat/completions', (req, res) => {
      if (req.logMetadata) {
        req.logMetadata.model = 'gpt-4';
        req.logMetadata.provider = 'openai';
        req.logMetadata.routePath = '/v1/chat/completions';
      }
      res.json({ response: 'ok' });
    });

    await request(app).post('/v1/chat/completions').send({ message: 'test' }).expect(200);

    await new Promise((resolve) => setTimeout(resolve, 100));

    const logs = await store.queryLogs({});
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      route_path: '/v1/chat/completions',
    });
  });

  it('should handle store logging errors gracefully', async () => {
    // Mock store to throw an error
    // Suppress pino output during test
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failingStore = {
      ...store,
      logRequest: vi.fn().mockRejectedValue(new Error('Store error')),
    };

    const failingApp = express();
    failingApp.use(express.json());
    failingApp.use((req, _res, next) => {
      const requestState = req as unknown as Record<string, unknown>;
      requestState.requestId = 'test-request-id';
      next();
    });
    failingApp.use(
      createRequestLoggingMiddleware({ store: failingStore as unknown as MemoryStore })
    );
    failingApp.get('/test', (_req, res) => res.json({ ok: true }));

    await request(failingApp).get('/test').expect(200);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify error was handled gracefully: no crash and the store was still called
    expect(failingStore.logRequest).toHaveBeenCalled();
  });
});
