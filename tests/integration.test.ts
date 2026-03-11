import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PipelineEngine } from '../src/core/pipeline.js';
import type { ResolvedConfig } from '../src/core/types.js';
import { createLogMiddleware } from '../src/middleware/log-request.js';
import { createTransformMiddleware } from '../src/middleware/transform-format.js';
import { TransformRegistry } from '../src/proxy/transform-registry.js';
import { AnthropicTransformer } from '../src/proxy/transforms/anthropic.js';
import { OpenAITransformer } from '../src/proxy/transforms/openai.js';
import { createApp, errorHandler } from '../src/server/express.js';
import { setupRoutes } from '../src/server/router.js';
import { MemoryStore } from '../src/store/memory.js';

// Mock server to simulate a provider
function createMockProvider(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      (req as Record<string, unknown>).parsedBody = JSON.parse(body || '{}');
      handler(req, res);
    });
  });
  return server;
}

describe('Integration: Full pipeline proxy', () => {
  let mockServer: http.Server;
  let mockPort: number;
  let appServer: http.Server;
  let appPort: number;

  beforeAll(async () => {
    // Start mock provider
    mockServer = createMockProvider((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'chatcmpl-mock',
          object: 'chat.completion',
          model: 'gpt-4o',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Hello from mock!' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      );
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(0, () => {
        mockPort = (mockServer.address() as { port: number }).port;
        resolve();
      });
    });

    // Set up app
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

  it('proxies a request through the full pipeline', async () => {
    const res = await fetch(`http://localhost:${appPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get('X-Request-ID')).toBeTruthy();
    expect(res.headers.get('X-Prism-Provider')).toBe('openai');
    expect(res.headers.get('X-Prism-Latency')).toBeTruthy();

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.object).toBe('chat.completion');
    const choices = body.choices as Array<Record<string, unknown>>;
    expect((choices[0].message as Record<string, unknown>).content).toBe('Hello from mock!');
  });

  it('returns health check', async () => {
    const res = await fetch(`http://localhost:${appPort}/health`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe('ok');
  });
});

describe('Integration: Fallback chain', () => {
  let failServer: http.Server;
  let failPort: number;
  let successServer: http.Server;
  let successPort: number;
  let appServer: http.Server;
  let appPort: number;

  beforeAll(async () => {
    // First provider: always fails with 500
    failServer = createMockProvider((_req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Internal error' } }));
    });
    await new Promise<void>((resolve) => {
      failServer.listen(0, () => {
        failPort = (failServer.address() as { port: number }).port;
        resolve();
      });
    });

    // Second provider: succeeds
    successServer = createMockProvider((_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          id: 'chatcmpl-fallback',
          object: 'chat.completion',
          model: 'gpt-4o-fallback',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Fallback response' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        })
      );
    });
    await new Promise<void>((resolve) => {
      successServer.listen(0, () => {
        successPort = (successServer.address() as { port: number }).port;
        resolve();
      });
    });

    const config: ResolvedConfig = {
      port: 0,
      logLevel: 'error',
      requestTimeout: 10_000,
      providers: {
        primary: {
          name: 'primary',
          baseUrl: `http://localhost:${failPort}`,
          apiKey: 'test-key',
        },
        fallback: {
          name: 'fallback',
          baseUrl: `http://localhost:${successPort}`,
          apiKey: 'test-key',
        },
      },
      routes: [
        {
          path: '/v1/chat/completions',
          providers: ['primary', 'fallback'],
        },
      ],
    };

    const transformRegistry = new TransformRegistry();
    transformRegistry.register(new OpenAITransformer());

    const pipeline = new PipelineEngine();
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
    failServer?.close();
    successServer?.close();
    appServer?.close();
  });

  it('falls back to second provider when first returns 500', async () => {
    const res = await fetch(`http://localhost:${appPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get('X-Prism-Fallback-Used')).toBe('true');

    const body = (await res.json()) as Record<string, unknown>;
    const choices = body.choices as Array<Record<string, unknown>>;
    expect((choices[0].message as Record<string, unknown>).content).toBe('Fallback response');
  });
});

describe('Integration: SSE Streaming', () => {
  let streamServer: http.Server;
  let streamPort: number;
  let appServer: http.Server;
  let appPort: number;
  let store: MemoryStore;

  beforeAll(async () => {
    streamServer = createMockProvider((_req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(
        'data: {"id":"c1","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n'
      );
      res.write(
        'data: {"id":"c2","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":" world"}}]}\n\n'
      );
      res.write(
        'data: {"id":"c3","object":"chat.completion.chunk","usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n'
      );
      res.write('data: [DONE]\n\n');
      res.end();
    });

    await new Promise<void>((resolve) => {
      streamServer.listen(0, () => {
        streamPort = (streamServer.address() as { port: number }).port;
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
          baseUrl: `http://localhost:${streamPort}`,
          apiKey: 'test-key',
        },
      },
      routes: [
        {
          path: '/v1/chat/completions',
          providers: ['openai'],
        },
      ],
    };

    const transformRegistry = new TransformRegistry();
    transformRegistry.register(new OpenAITransformer());

    const pipeline = new PipelineEngine();
    const app = createApp();
    store = new MemoryStore();
    setupRoutes(app, { config, pipeline, store, transformRegistry });
    app.use(errorHandler);

    await new Promise<void>((resolve) => {
      appServer = app.listen(0, () => {
        appPort = (appServer.address() as { port: number }).port;
        resolve();
      });
    });
  });

  afterAll(() => {
    streamServer?.close();
    appServer?.close();
  });

  it('streams SSE chunks from provider to client', async () => {
    const res = await fetch(`http://localhost:${appPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }),
    });

    expect(res.ok).toBe(true);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('Hello');
    expect(text).toContain('world');
    expect(text).toContain('[DONE]');
  });

  it('records streamed usage in the usage ledger when the provider emits usage chunks', async () => {
    const before = await store.queryUsage({ route_path: '/v1/chat/completions' });
    const res = await fetch(`http://localhost:${appPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: true,
      }),
    });

    expect(res.ok).toBe(true);
    await res.text();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const usageLogs = await store.queryUsage({ route_path: '/v1/chat/completions' });
    expect(usageLogs).toHaveLength(before.length + 1);
    expect(usageLogs[0]?.model).toBe('gpt-4o');
    expect(usageLogs[0]?.input_tokens).toBe(10);
    expect(usageLogs[0]?.output_tokens).toBe(5);
  });
});

describe('Integration: Invalid provider configuration', () => {
  let appServer: http.Server;
  let appPort: number;

  beforeAll(async () => {
    const config: ResolvedConfig = {
      port: 0,
      logLevel: 'error',
      requestTimeout: 10_000,
      providers: {
        openai: {
          name: 'openai',
          baseUrl: 'http://localhost:9999',
          apiKey: 'test-key',
        },
      },
      routes: [
        {
          path: '/v1/chat/completions',
          providers: ['missing-provider'],
        },
      ],
    };

    const transformRegistry = new TransformRegistry();
    transformRegistry.register(new OpenAITransformer());

    const pipeline = new PipelineEngine();
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
    appServer?.close();
  });

  it('returns a 400 instead of silently dropping unknown providers', async () => {
    const res = await fetch(`http://localhost:${appPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; step?: string };
    };
    expect(body.error?.code).toBe('invalid_request');
    expect(body.error?.step).toBe('router');
    expect(body.error?.message).toContain('missing-provider');
  });
});
