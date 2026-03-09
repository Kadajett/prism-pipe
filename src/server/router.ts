/**
 * Route mounting and pipeline integration
 */
import type { Router, Request, Response, NextFunction } from 'express';
import { Router as createRouter } from 'express';
import type { PrismConfig, PipelineContext } from '../types/index.js';
import { createError } from './middleware/error-handler.js';

/**
 * Create a PipelineContext from Express request
 */
export function createPipelineContext(req: Request): PipelineContext {
  return {
    requestId: req.id,
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.body,
    query: req.query as Record<string, string | string[] | undefined>,
    startTime: Date.now(),
    metadata: {},
  };
}

/**
 * Mount API routes
 */
export function createApiRouter(config: PrismConfig): Router {
  const router = createRouter();

  // POST /v1/chat/completions - Main proxy endpoint
  router.post(
    '/v1/chat/completions',
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const context = createPipelineContext(req);

        // TODO: Pipeline execution will be implemented in future issues
        // For now, return a placeholder response
        res.json({
          id: context.requestId,
          object: 'chat.completion',
          created: Math.floor(context.startTime / 1000),
          model: 'placeholder',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content:
                  'Pipeline not yet implemented. This is a placeholder response.',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        });
      } catch (error) {
        next(error);
      }
    }
  );

  // GET /v1/models - List configured models/providers
  router.get('/v1/models', (req: Request, res: Response) => {
    const models = config.providers
      .filter((p) => p.enabled)
      .flatMap((provider) =>
        provider.models.map((model) => ({
          id: `${provider.name}/${model}`,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: provider.name,
        }))
      );

    res.json({
      object: 'list',
      data: models,
    });
  });

  // Default route: Proxy /v1/* to first provider if no explicit route matches
  router.use('/v1', (req: Request, res: Response, next: NextFunction) => {
    if (config.providers.length === 0) {
      return next(
        createError(
          'not_found',
          'No providers configured',
          'NO_PROVIDERS'
        )
      );
    }

    // TODO: Implement default proxy behavior in future issues
    next(
      createError(
        'not_found',
        `Route ${req.path} not yet implemented`,
        'NOT_IMPLEMENTED'
      )
    );
  });

  return router;
}
