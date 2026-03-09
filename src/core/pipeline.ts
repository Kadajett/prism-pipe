import type { PipelineContext } from './context.js';
import { PipelineError } from './types.js';

export type Middleware = (ctx: PipelineContext, next: () => Promise<void>) => Promise<void>;

/**
 * Koa-style pipeline engine. Middleware are composed into an onion:
 * each middleware calls `next()` to pass control downstream,
 * and code after `next()` runs on the way back up (post-processing).
 */
export class PipelineEngine {
  private readonly middlewares: Middleware[] = [];

  use(middleware: Middleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  async execute(ctx: PipelineContext): Promise<void> {
    const startTime = Date.now();

    const dispatch = async (index: number): Promise<void> => {
      if (!ctx.timeout.hasTime()) {
        throw new PipelineError(
          'Pipeline timeout expired',
          'timeout',
          `middleware[${index}]`,
          504,
          true
        );
      }

      if (index >= this.middlewares.length) return;

      const mw = this.middlewares[index];
      const stepName = mw.name || `middleware[${index}]`;
      const stepStart = Date.now();

      try {
        let nextCalled = false;
        await mw(ctx, async () => {
          if (nextCalled) {
            throw new PipelineError(
              'next() called multiple times',
              'invalid_request',
              stepName,
              500
            );
          }
          nextCalled = true;
          await dispatch(index + 1);
        });

        ctx.metrics.histogram('pipeline.middleware_ms', Date.now() - stepStart, {
          step: stepName,
        });
      } catch (err) {
        if (err instanceof PipelineError) throw err;
        throw new PipelineError(
          err instanceof Error ? err.message : String(err),
          'unknown',
          stepName,
          500,
          false,
          err instanceof Error ? err : undefined
        );
      }
    };

    try {
      await dispatch(0);
    } finally {
      ctx.metrics.histogram('pipeline.total_ms', Date.now() - startTime);
    }
  }
}
