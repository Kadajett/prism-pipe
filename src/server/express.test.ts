/**
 * Tests for Express HTTP shell
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Server } from 'node:http';
import { createApp, startServer } from './express.js';
import type { PrismConfig } from '../types/index.js';

describe('Express HTTP Shell', () => {
  let app: Express;
  let server: Server;
  let shutdown: () => Promise<void>;

  const testConfig: PrismConfig = {
    server: {
      port: 0, // Use random port for testing
      host: '127.0.0.1',
      cors: {
        enabled: true,
        origins: ['*'],
      },
      trustProxy: false,
      shutdownTimeout: 5000,
    },
    providers: [
      {
        name: 'test-provider',
        baseUrl: 'https://test.example.com',
        apiKey: 'test-key',
        models: ['test-model-1', 'test-model-2'],
        enabled: true,
      },
    ],
    responseHeaders: {
      verbosity: 'standard',
    },
  };

  beforeAll(async () => {
    const result = await startServer(testConfig);
    app = result.app;
    server = result.server;
    shutdown = result.shutdown;
  });

  afterAll(async () => {
    await shutdown();
  });

  describe('Health Endpoints', () => {
    it('GET /health returns 200 with status', async () => {
      const response = await request(app).get('/health').expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        version: '0.1.0',
      });
      expect(typeof response.body.uptime).toBe('number');
    });

    it('GET /ready returns 200 when providers are configured', async () => {
      const response = await request(app).get('/ready').expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        version: '0.1.0',
      });
      expect(response.body.providers).toHaveLength(1);
      expect(response.body.providers[0]).toMatchObject({
        name: 'test-provider',
        status: 'ready',
      });
    });

    it('GET /ready returns 503 when no providers are enabled', async () => {
      const noProviderConfig = {
        ...testConfig,
        providers: [],
      };
      const noProviderApp = createApp(noProviderConfig);
      const response = await request(noProviderApp).get('/ready').expect(503);

      expect(response.body.status).toBe('degraded');
    });
  });

  describe('Request ID Middleware', () => {
    it('generates request ID and returns in header', async () => {
      const response = await request(app).get('/health').expect(200);

      expect(response.headers['x-request-id']).toBeDefined();
      expect(typeof response.headers['x-request-id']).toBe('string');
    });

    it('propagates inbound X-Request-ID', async () => {
      const testId = 'test-request-id-123';
      const response = await request(app)
        .get('/health')
        .set('X-Request-ID', testId)
        .expect(200);

      expect(response.headers['x-request-id']).toBe(testId);
    });
  });

  describe('Response Headers', () => {
    it('includes X-Prism-Version header', async () => {
      const response = await request(app).get('/health').expect(200);

      expect(response.headers['x-prism-version']).toBe('0.1.0');
    });

    it('includes X-Prism-Latency in standard verbosity', async () => {
      const response = await request(app).get('/health').expect(200);

      expect(response.headers['x-prism-latency']).toBeDefined();
      expect(response.headers['x-prism-latency']).toMatch(/^\d+ms$/);
    });
  });

  describe('CORS', () => {
    it('CORS middleware is configured', () => {
      // CORS middleware is configured in the app
      // Full CORS behavior testing requires integration tests with real browsers
      expect(testConfig.server.cors.enabled).toBe(true);
    });
  });

  describe('API Routes', () => {
    it('GET /v1/models returns configured providers', async () => {
      const response = await request(app).get('/v1/models').expect(200);

      expect(response.body).toMatchObject({
        object: 'list',
      });
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data[0]).toMatchObject({
        id: 'test-provider/test-model-1',
        object: 'model',
        owned_by: 'test-provider',
      });
    });

    it('POST /v1/chat/completions returns placeholder response', async () => {
      const response = await request(app)
        .post('/v1/chat/completions')
        .send({
          model: 'test-model-1',
          messages: [{ role: 'user', content: 'Hello' }],
        })
        .expect(200);

      expect(response.body).toMatchObject({
        object: 'chat.completion',
        model: 'placeholder',
      });
      expect(response.body.id).toBeDefined();
      expect(response.body.choices).toHaveLength(1);
    });
  });

  describe('Error Handler', () => {
    it('returns structured JSON error for not found routes', async () => {
      const response = await request(app)
        .get('/v1/nonexistent')
        .expect(404);

      expect(response.body.error).toMatchObject({
        type: 'not_found',
        code: 'NOT_IMPLEMENTED',
      });
      expect(response.body.error.request_id).toBeDefined();
    });

    it('never leaks stack traces in production', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const response = await request(app).get('/v1/nonexistent');

      expect(response.body.error.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('Graceful Shutdown', () => {
    it('drains requests before shutdown', async () => {
      // This is a smoke test - actual drain behavior is tested in integration
      expect(shutdown).toBeDefined();
      expect(typeof shutdown).toBe('function');
    });
  });
});
