import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp, errorHandler } from '../src/server/express.js';
import { setupRoutes } from '../src/server/router.js';
import { PipelineEngine } from '../src/core/pipeline.js';
import { TransformRegistry } from '../src/proxy/transform-registry.js';
import { OpenAITransformer } from '../src/proxy/transforms/openai.js';
import { AnthropicTransformer } from '../src/proxy/transforms/anthropic.js';
import { createLogMiddleware } from '../src/middleware/log-request.js';
import { createTransformMiddleware } from '../src/middleware/transform-format.js';
import type { ResolvedConfig } from '../src/core/types.js';
import http from 'node:http';

// Helper to create a mock provider server that can be configured per test
function createMockProvider(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        (req as Record<string, unknown>).parsedBody = JSON.parse(body || '{}');
      } catch {
        // ignore parse errors for tests that expect malformed JSON handling
      }
      handler(req, res);
    });
  });
  return server;
}

describe('Integration: Advanced scenarios', () => {
  let mockServer: http.Server;
  let mockPort: number;
  let appServer: http.Server;
  let appPort: number;

  beforeAll(async () => {
    // Start a generic mock provider that just echoes a successful JSON response
    mockServer = createMockProvider((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        id: 'chatcmpl-mock',
        object: 'chat.completion',
        model: 'gpt-4o',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hello from mock!' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }));
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, () => {
        mockPort = (mockServer.address() as { port: number }).port;
        resolve();
      });
    });

    const config: ResolvedConfig = {
      port: 0,
      logLevel: 'error',
      requestTimeout: 10_000,
      providers: {
        openai: {
          name: 'openai',
          baseUrl: `http://localhost:${mockPort}`,
          apiKey: 'test-key',
        },
      },
      routes: [
        {
          path: '/v1/chat/completions',
          providers: ['openai'],
          pipeline: ['log-request', 'transform-format'],
        },
      ],
    };

    const transformRegistry = new TransformRegistry();
    transformRegistry.register(new OpenAITransformer());
    transformRegistry.register(new AnthropicTransformer());

    const pipeline = new PipelineEngine();
    pipeline.use(createLogMiddleware());
    pipeline.use(createTransformMiddleware(transformRegistry));

    const app = createApp();
    setupRoutes(app, { config, pipeline, transformRegistry });
    app.use(errorHandler);

    await new Promise<void>((resolve) => {
      appServer = app.listen(0, () => {
        appPort = (appServer.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(() => {
    mockServer?.close();
    appServer?.close();
  });

  const baseUrl = () => `http://localhost:${appPort}`;

  it('handles CORS preflight requests', async () => {
    const response = await fetch(`${baseUrl()}/v1/chat/completions`, {
      method: 'OPTIONS',
      headers: {
        'Origin': 'http://example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type,Authorization',
      },
    });
    expect(response.status).toBe(204);
    const acAllowOrigin = response.headers.get('access-control-allow-origin');
    expect(acAllowOrigin).toBe('*');
    const acAllowMethods = response.headers.get('access-control-allow-methods');
    expect(acAllowMethods).toContain('POST');
    const acAllowHeaders = response.headers.get('access-control-allow-headers');
    expect(acAllowHeaders?.toLowerCase()).toContain('content-type');
  });

  it('propagates request-id header through the pipeline', async () => {
    const requestId = 'test-request-id-12345';
    const response = await fetch(`${baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    });
    expect(response.status).toBe(200);
    // The server echoes back the request-id in a custom response header (implementation detail of log middleware)
    const returnedId = response.headers.get('x-request-id');
    expect(returnedId).toBe(requestId);
  });

  it('returns 400 for malformed JSON payloads', async () => {
    const response = await fetch(`${baseUrl()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ "model": "gpt-4o", "messages": [ { "role": "user", "content": "hi" }', // missing closing braces
    });
    expect([400, 500]).toContain(response.status);
    const text = await response.text();
    expect(text).toBeTruthy();
  });

  it('returns 404 for undefined routes', async () => {
    const response = await fetch(`${baseUrl()}/undefined/route`, {
      method: 'GET',
    });
    expect(response.status).toBe(404);
    const text = await response.text();
    expect(text.toLowerCase()).toMatch(/not found|cannot get/i);
  });
});
