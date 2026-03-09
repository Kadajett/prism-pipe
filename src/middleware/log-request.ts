import type { Middleware } from '../core/pipeline';

/**
 * Log request start and pipeline timing. The full request completion log
 * (including upstream provider latency) is handled by the router after
 * the provider call returns, since this middleware only wraps the
 * pre-flight pipeline — not the upstream HTTP call.
 */
export function createLogMiddleware(): Middleware {
  return async function logRequest(ctx, next) {
    const start = Date.now();
    ctx.log.info('request started', {
      model: ctx.request.model,
      stream: ctx.request.stream ?? false,
      messageCount: ctx.request.messages.length,
    });

    try {
      await next();

      const pipelineMs = Date.now() - start;
      ctx.metadata.set('pipelineMs', pipelineMs);

      // If the pipeline itself produced a response (e.g. cache hit),
      // log completion here since the router won't make a provider call.
      if (ctx.response) {
        ctx.log.info('request completed', {
          model: ctx.response.model ?? ctx.request.model,
          provider: ctx.metadata.get('provider') as string,
          latency: pipelineMs,
          latency_total_ms: pipelineMs,
          inputTokens: ctx.response.usage?.inputTokens,
          outputTokens: ctx.response.usage?.outputTokens,
          stopReason: ctx.response.stopReason,
          source: 'pipeline',
        });

        ctx.metrics.histogram('request.latency_ms', pipelineMs);
      }

      if (ctx.response?.usage) {
        ctx.metrics.counter('request.input_tokens', ctx.response.usage.inputTokens);
        ctx.metrics.counter('request.output_tokens', ctx.response.usage.outputTokens);
      }
    } catch (err) {
      const latency = Date.now() - start;
      ctx.log.error('request failed', {
        latency,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  };
}
