import type { Middleware } from '../core/pipeline';

/**
 * Log request/response summary: model, tokens, latency, provider, status.
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

      const latency = Date.now() - start;
      ctx.log.info('request completed', {
        model: ctx.response?.model ?? ctx.request.model,
        provider: ctx.metadata.get('provider') as string,
        latency,
        inputTokens: ctx.response?.usage?.inputTokens,
        outputTokens: ctx.response?.usage?.outputTokens,
        stopReason: ctx.response?.stopReason,
      });

      ctx.metrics.histogram('request.latency_ms', latency);
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
