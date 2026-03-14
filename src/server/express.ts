import type { Server } from 'node:http';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ulid } from 'ulid';
import { PipelineError } from '../core/types';
import { appLogger } from '../logging/app-logger';
import type { PrismConfig } from '../types/index';

const logger = appLogger.child({ component: 'server' });

const VERSION = '0.1.0';
const startedAt = Date.now();

export function createApp(config?: PrismConfig) {
  const app = express();

  // Body parser
  app.use(express.json({ limit: '10mb' }));

  // CORS
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-ID');
    if (_req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  // Request ID + timing + version headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqId = (req.headers['x-request-id'] as string) ?? ulid();
    const start = Date.now();
    res.setHeader('X-Request-ID', reqId);
    res.setHeader('X-Prism-Version', VERSION);
    (req as unknown as Record<string, unknown>).requestId = reqId;

    // Log request completion with latency
    res.on('finish', () => {
      const latencyMs = Date.now() - start;
      logger.info(
        { reqId, method: req.method, path: req.path, status: res.statusCode, latencyMs },
        'request_complete'
      );
    });

    // Set latency before response ends
    const origEnd = res.end.bind(res) as (...args: unknown[]) => Response;
    (res as unknown as Record<string, unknown>).end = (...args: unknown[]) => {
      const latency = Date.now() - start;
      if (!res.headersSent) {
        res.setHeader('X-Prism-Latency', `${latency}ms`);
      }
      return origEnd(...args);
    };

    next();
  });

  if (config) {
    // Health endpoint
    app.get('/health', (_req: Request, res: Response) => {
      res.json({
        status: 'healthy',
        version: VERSION,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        timestamp: new Date().toISOString(),
      });
    });

    // Ready endpoint
    app.get('/ready', (_req: Request, res: Response) => {
      const providers = config.providers ?? [];
      const enabledProviders = providers.filter((p) => p.enabled);

      if (enabledProviders.length === 0) {
        res.status(503).json({
          status: 'degraded',
          version: VERSION,
          uptime: Math.floor((Date.now() - startedAt) / 1000),
          providers: [],
        });
        return;
      }

      res.json({
        status: 'healthy',
        version: VERSION,
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        providers: enabledProviders.map((p) => ({
          name: p.name,
          status: 'ready' as const,
        })),
      });
    });

    // Models endpoint
    app.get('/v1/models', (_req: Request, res: Response) => {
      const providers = config.providers ?? [];
      const models = providers.flatMap((p) =>
        p.models.map((m) => ({
          id: `${p.name}/${m}`,
          object: 'model' as const,
          created: Math.floor(startedAt / 1000),
          owned_by: p.name,
        }))
      );

      res.json({ object: 'list', data: models });
    });

    // Chat completions placeholder
    app.post('/v1/chat/completions', (_req: Request, res: Response) => {
      res.json({
        id: ulid(),
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'placeholder',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Placeholder response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    });

    // 404 handler
    app.use((req: Request, res: Response) => {
      const reqId = (req as unknown as Record<string, string>).requestId ?? ulid();
      res.status(404).json({
        error: {
          type: 'not_found',
          message: `${req.method} ${req.path} not found`,
          code: 'NOT_IMPLEMENTED',
          request_id: reqId,
        },
      });
    });

    // Error handler
    app.use(errorHandler);
  } else {
    // Minimal health endpoint for bare createApp()
    app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
  }

  return app;
}

/**
 * Error handler middleware — must be added after all routes.
 */
export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  const reqId = (req as unknown as Record<string, string>).requestId ?? 'unknown';

  if (err instanceof PipelineError) {
    logger.warn(
      { reqId, errorType: err.code, step: err.step, statusCode: err.statusCode },
      'request_error'
    );
    res.status(err.statusCode).json({
      error: {
        message: err.message,
        code: err.code,
        step: err.step,
        request_id: reqId,
      },
    });
    return;
  }

  logger.error(
    {
      reqId,
      errorType: 'unhandled',
      err: err.message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    },
    'request_error'
  );
  res.status(500).json({
    error: {
      message: 'Internal server error',
      code: 'unknown',
      request_id: reqId,
    },
  });
}

/**
 * Start the HTTP server with the given config.
 */
export async function startServer(
  config: PrismConfig
): Promise<{ app: ReturnType<typeof express>; server: Server; shutdown: () => Promise<void> }> {
  const app = createApp(config);

  return new Promise((resolve) => {
    const server = app.listen(config.server.port, config.server.host, () => {
      logger.info({ port: config.server.port, host: config.server.host }, 'server_started');
      const shutdown = () =>
        new Promise<void>((res) => {
          server.close(() => res());
        });
      resolve({ app, server, shutdown });
    });
  });
}
