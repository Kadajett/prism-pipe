/**
 * Express app factory with graceful shutdown
 */
import express, { type Express } from 'express';
import cors from 'cors';
import type { Server } from 'node:http';
import type { PrismConfig } from '../types/index.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { createResponseHeadersMiddleware } from './middleware/response-headers.js';
import { errorHandler } from './middleware/error-handler.js';
import { createApiRouter } from './router.js';
import { healthCheck, readinessCheck } from './health.js';

/**
 * Create Express application with all middleware configured
 */
export function createApp(config: PrismConfig): Express {
  const app = express();

  // Trust proxy if behind reverse proxy (for correct IP addresses)
  if (config.server.trustProxy) {
    app.set('trust proxy', true);
  }

  // Request ID middleware (must be first to ensure all logging has ID)
  app.use(requestIdMiddleware);

  // Response headers middleware
  app.use(createResponseHeadersMiddleware(config.responseHeaders.verbosity));

  // CORS configuration
  if (config.server.cors.enabled) {
    app.use(
      cors({
        origin: config.server.cors.origins,
        credentials: true,
      })
    );
  }

  // Body parsing
  app.use(express.json({ limit: '10mb' })); // Standard JSON parsing
  app.use(express.raw({ type: 'application/octet-stream', limit: '50mb' })); // Raw mode for streaming

  // Health endpoints (before router to avoid auth/rate limiting)
  app.get('/health', healthCheck);
  app.get('/ready', readinessCheck(config));

  // Mount API routes
  app.use(createApiRouter(config));

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}

/**
 * Start Express server with graceful shutdown
 */
export async function startServer(
  config: PrismConfig
): Promise<{ app: Express; server: Server; shutdown: () => Promise<void> }> {
  const app = createApp(config);

  return new Promise((resolve, reject) => {
    const server = app.listen(
      config.server.port,
      config.server.host,
      () => {
        const providers = config.providers.filter((p) => p.enabled);
        const middlewareCount = app._router?.stack?.length || 0;

        console.log({
          event: 'server_started',
          port: config.server.port,
          host: config.server.host,
          providers: providers.map((p) => p.name),
          middleware_count: middlewareCount,
          cors_enabled: config.server.cors.enabled,
          trust_proxy: config.server.trustProxy,
        });

        // Graceful shutdown handler
        const shutdown = (): Promise<void> => {
          return new Promise((resolveShutdown, rejectShutdown) => {
            console.log({
              event: 'shutdown_initiated',
              timeout: config.server.shutdownTimeout,
            });

            const timeout = setTimeout(() => {
              console.log({
                event: 'shutdown_forced',
                reason: 'timeout',
              });
              rejectShutdown(new Error('Shutdown timeout exceeded'));
            }, config.server.shutdownTimeout);

            server.close((err) => {
              clearTimeout(timeout);
              if (err) {
                console.error({
                  event: 'shutdown_error',
                  error: err.message,
                });
                rejectShutdown(err);
              } else {
                console.log({ event: 'shutdown_complete' });
                resolveShutdown();
              }
            });
          });
        };

        // Register signal handlers
        process.on('SIGTERM', () => {
          shutdown()
            .then(() => process.exit(0))
            .catch(() => process.exit(1));
        });

        process.on('SIGINT', () => {
          shutdown()
            .then(() => process.exit(0))
            .catch(() => process.exit(1));
        });

        resolve({ app, server, shutdown });
      }
    );

    server.on('error', reject);
  });
}
