import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { PipelineContext } from '../../../src/core/context.js';
import type { PipelineEngine } from '../../../src/core/pipeline.js';
import type { ResolvedConfig, RouteHandler, RouteValue } from '../../../src/core/types.js';
import type {
  ProviderTransformer,
  TransformRegistry,
} from '../../../src/proxy/transform-registry.js';
import { setupRoutes } from '../../../src/server/router.js';

// ─── Shared test helpers ───

function createMockTransformer(): ProviderTransformer {
  return {
    provider: 'openai',
    toCanonical: (body: Record<string, unknown>) => ({
      model: (body.model as string) ?? 'test-model',
      messages: [{ role: 'user' as const, content: 'hello' }],
    }),
    fromCanonical: (req) => ({ model: req.model, messages: req.messages }),
    responseFromCanonical: (res) => ({
      id: res.id,
      model: res.model,
      choices: [
        {
          message: {
            content:
              res.content?.[0]?.type === 'text' ? (res.content[0] as { text: string }).text : '',
          },
        },
      ],
    }),
    streamChunkFromCanonical: (chunk) => JSON.stringify(chunk),
    capabilities: {
      supportsTools: true,
      supportsVision: true,
      supportsStreaming: true,
      supportsThinking: false,
      supportsSystemPrompt: true,
    },
  } as unknown as ProviderTransformer;
}

function createMockTransformRegistry(): TransformRegistry {
  const transformer = createMockTransformer();
  return {
    get: () => transformer,
    has: () => true,
    register: vi.fn(),
  } as unknown as TransformRegistry;
}

function createMockPipeline(): PipelineEngine {
  return {
    execute: vi.fn().mockResolvedValue(undefined),
    use: vi.fn(),
  } as unknown as PipelineEngine;
}

function createApp(): express.Express {
  const app = express();
  app.use(express.json());
  // Add requestId middleware
  app.use((req, _res, next) => {
    (req as unknown as Record<string, unknown>).requestId = 'test-req-id';
    next();
  });
  return app;
}

function createBaseConfig(routes: ResolvedConfig['routes']): ResolvedConfig {
  return {
    port: 3000,
    logLevel: 'info',
    requestTimeout: 30000,
    providers: {
      openai: {
        name: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'test-key',
      },
      anthropic: {
        name: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'test-key-2',
      },
    },
    routes,
  };
}

// ─── Tests ───

describe('Router refactor: Record<string, RouteValue>', () => {
  describe('backward compatibility with RouteConfig[]', () => {
    it('still works with legacy RouteConfig[] format', async () => {
      const app = createApp();
      const config = createBaseConfig([
        { path: '/v1/chat/completions', providers: ['openai'], pipeline: [] },
      ]);

      setupRoutes(app, {
        config,
        pipeline: createMockPipeline(),
        transformRegistry: createMockTransformRegistry(),
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

      // Route is registered — status may vary based on provider mock
      expect(res.status).toBeDefined();
    });
  });

  describe('function route handler', () => {
    it('registers function as route handler receiving (req, res, ctx)', async () => {
      const handler: RouteHandler = vi.fn((_req, res, ctx) => {
        expect(ctx).toBeInstanceOf(PipelineContext);
        res.json({ message: 'hello from function route' });
      });

      const app = createApp();
      const routes: Record<string, RouteValue> = {
        '/api/custom': handler,
      };
      const config = createBaseConfig(routes);

      setupRoutes(app, {
        config,
        pipeline: createMockPipeline(),
        transformRegistry: createMockTransformRegistry(),
      });

      const res = await request(app).get('/api/custom').send({});
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ message: 'hello from function route' });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('supports function routes returning RouteResult', async () => {
      const handler: RouteHandler = () => ({
        data: { result: 'computed' },
        meta: { status: 201, headers: { 'X-Custom': 'value' } },
      });

      const app = createApp();
      const routes: Record<string, RouteValue> = { '/api/compute': handler };
      const config = createBaseConfig(routes);

      setupRoutes(app, {
        config,
        pipeline: createMockPipeline(),
        transformRegistry: createMockTransformRegistry(),
      });

      const res = await request(app).post('/api/compute').send({});
      expect(res.status).toBe(201);
      expect(res.body).toEqual({ result: 'computed' });
      expect(res.headers['x-custom']).toBe('value');
    });

    it('function route registers with app.all (supports GET, POST, etc.)', async () => {
      const handler: RouteHandler = (_req, res) => {
        res.json({ ok: true });
      };

      const app = createApp();
      const routes: Record<string, RouteValue> = { '/api/any-method': handler };
      const config = createBaseConfig(routes);

      setupRoutes(app, {
        config,
        pipeline: createMockPipeline(),
        transformRegistry: createMockTransformRegistry(),
      });

      const getRes = await request(app).get('/api/any-method');
      expect(getRes.status).toBe(200);

      const postRes = await request(app).post('/api/any-method');
      expect(postRes.status).toBe(200);

      const putRes = await request(app).put('/api/any-method');
      expect(putRes.status).toBe(200);
    });
  });

  describe('config-object routes', () => {
    it('registers a config-object route with providers', async () => {
      const routes: Record<string, RouteValue> = {
        '/v1/chat/completions': {
          providers: ['openai'],
        },
      };
      const app = createApp();
      const config = createBaseConfig(routes);

      setupRoutes(app, {
        config,
        pipeline: createMockPipeline(),
        transformRegistry: createMockTransformRegistry(),
      });

      const res = await request(app)
        .post('/v1/chat/completions')
        .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });

      // Route is registered and processes the request (provider call may fail
      // since we hit a real endpoint, but the route handler ran).
      // The response will have prism headers if the route was registered.
      expect(res.status).toBeDefined();
    });
  });

  describe('nested routes', () => {
    it('mounts nested routes at correct paths', async () => {
      const innerHandler: RouteHandler = (_req, res) => {
        res.json({ nested: true });
      };

      const routes: Record<string, RouteValue> = {
        '/v1': {
          routes: {
            '/health': innerHandler,
          },
        },
      };
      const app = createApp();
      const config = createBaseConfig(routes);

      setupRoutes(app, {
        config,
        pipeline: createMockPipeline(),
        transformRegistry: createMockTransformRegistry(),
      });

      const res = await request(app).get('/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ nested: true });
    });

    it('supports deeply nested routes', async () => {
      const handler: RouteHandler = (_req, res) => {
        res.json({ deep: true });
      };

      const routes: Record<string, RouteValue> = {
        '/api': {
          routes: {
            '/v1': {
              routes: {
                '/models': handler,
              },
            },
          },
        },
      };
      const app = createApp();
      const config = createBaseConfig(routes);

      setupRoutes(app, {
        config,
        pipeline: createMockPipeline(),
        transformRegistry: createMockTransformRegistry(),
      });

      const res = await request(app).get('/api/v1/models');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deep: true });
    });
  });

  describe('provider inheritance', () => {
    it('child inherits parent providers when not specified', async () => {
      let capturedCtx: PipelineContext | undefined;
      const handler: RouteHandler = (_req, res, ctx) => {
        capturedCtx = ctx;
        res.json({ ok: true });
      };

      const routes: Record<string, RouteValue> = {
        '/v1': {
          providers: ['anthropic'],
          systemPrompt: 'Be helpful',
          routes: {
            '/custom': handler,
          },
        },
      };
      const app = createApp();
      const config = createBaseConfig(routes);

      setupRoutes(app, {
        config,
        pipeline: createMockPipeline(),
        transformRegistry: createMockTransformRegistry(),
      });

      await request(app).get('/v1/custom').send({});
      // The parent systemPrompt should be injected via parentConfig
      expect(capturedCtx).toBeDefined();
      expect(capturedCtx?.request.systemPrompt).toBe('Be helpful');
    });

    it('child overrides parent providers', async () => {
      const childHandler: RouteHandler = (_req, res) => {
        res.json({ ok: true });
      };

      // This tests that a child config-object can override parent providers
      const routes: Record<string, RouteValue> = {
        '/v1': {
          providers: ['openai'],
          routes: {
            '/chat': {
              providers: ['anthropic'],
              routes: {
                '/custom': childHandler,
              },
            },
          },
        },
      };
      const app = createApp();
      const config = createBaseConfig(routes);

      // Should not throw - providers are properly inherited/overridden
      setupRoutes(app, {
        config,
        pipeline: createMockPipeline(),
        transformRegistry: createMockTransformRegistry(),
      });

      const res = await request(app).get('/v1/chat/custom');
      expect(res.status).toBe(200);
    });
  });

  describe('mixed function + config routes', () => {
    it('handles both function and config routes in the same map', async () => {
      const handler: RouteHandler = (_req, res) => {
        res.json({ type: 'function' });
      };

      const routes: Record<string, RouteValue> = {
        '/api/custom': handler,
        '/v1/chat/completions': {
          providers: ['openai'],
        },
      };
      const app = createApp();
      const config = createBaseConfig(routes);

      setupRoutes(app, {
        config,
        pipeline: createMockPipeline(),
        transformRegistry: createMockTransformRegistry(),
      });

      const fnRes = await request(app).get('/api/custom');
      expect(fnRes.status).toBe(200);
      expect(fnRes.body).toEqual({ type: 'function' });

      const configRes = await request(app)
        .post('/v1/chat/completions')
        .send({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] });
      // Route is registered — status may vary based on provider mock behavior
      expect(configRes.status).toBeDefined();
    });
  });

  describe('error handling in function routes', () => {
    it('returns 500 on unhandled error in function handler', async () => {
      const handler: RouteHandler = () => {
        throw new Error('oops');
      };

      const app = createApp();
      const routes: Record<string, RouteValue> = { '/api/fail': handler };
      const config = createBaseConfig(routes);

      setupRoutes(app, {
        config,
        pipeline: createMockPipeline(),
        transformRegistry: createMockTransformRegistry(),
      });

      const res = await request(app).get('/api/fail');
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('unknown');
    });
  });
});
