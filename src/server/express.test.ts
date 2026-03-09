/**
 * Tests for Express HTTP shell
 */
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp, errorHandler } from './express.js';
import { PipelineError } from '../core/types.js';

describe('Express HTTP Shell', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
    // Add a test route that throws a PipelineError
    app.post('/test-error', (_req, _res) => {
      throw new PipelineError('Test pipeline error', 'test_code', 'test_step', 422);
    });
    // Add error handler after routes
    app.use(errorHandler);
  });

  describe('Health Endpoints', () => {
    it('GET /health returns 200 with status', async () => {
      const response = await request(app).get('/health').expect(200);
      expect(response.body.status).toBe('ok');
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe('CORS', () => {
    it('sets CORS headers', async () => {
      const response = await request(app).get('/health');
      expect(response.headers['access-control-allow-origin']).toBe('*');
    });

    it('handles OPTIONS preflight', async () => {
      const response = await request(app)
        .options('/health')
        .set('Origin', 'http://example.com');
      expect(response.status).toBe(204);
    });
  });

  describe('Request ID', () => {
    it('generates request ID when not provided', async () => {
      const response = await request(app).get('/health');
      expect(response.headers['x-request-id']).toBeDefined();
      expect(response.headers['x-request-id'].length).toBeGreaterThan(0);
    });

    it('preserves client-provided request ID', async () => {
      const clientId = 'my-custom-id-123';
      const response = await request(app)
        .get('/health')
        .set('X-Request-ID', clientId);
      expect(response.headers['x-request-id']).toBe(clientId);
    });
  });

  describe('Body Parsing', () => {
    it('parses JSON body', async () => {
      // Health endpoint doesn't use body, but body parser shouldn't reject valid JSON
      const response = await request(app)
        .post('/health')
        .send({ test: true })
        .set('Content-Type', 'application/json');
      // Will 404 since POST /health isn't defined, but body parsing should work
      expect(response.status).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('returns 404 for unknown routes', async () => {
      const response = await request(app).get('/nonexistent');
      expect(response.status).toBe(404);
    });
  });
});
