/**
 * Metrics middleware — emits built-in metrics on every request.
 * Plugs into the pipeline engine as a Koa-style middleware.
 */

import type { PipelineContext } from '../core/context.js';

export function metricsMiddleware() {
  return async function metrics(ctx: PipelineContext, next: () => Promise<void>): Promise<void> {
    const start = Date.now();
    const provider = (ctx.metadata.get('provider') as string) ?? 'unknown';

    ctx.metrics.counter('requests_total', 1, { provider });

    try {
      await next();

      const latency = Date.now() - start;
      ctx.metrics.histogram('request_duration_ms', latency, { provider });

      if (ctx.response?.usage) {
        const { inputTokens, outputTokens, totalTokens } = ctx.response.usage;
        ctx.metrics.counter('tokens_input_total', inputTokens, { provider });
        ctx.metrics.counter('tokens_output_total', outputTokens, { provider });
        ctx.metrics.counter('tokens_total', totalTokens, { provider });
      }
    } catch (err) {
      ctx.metrics.counter('errors_total', 1, {
        provider,
        error_class: (err as { code?: string }).code ?? 'unknown',
      });
      throw err;
    }
  };
}
