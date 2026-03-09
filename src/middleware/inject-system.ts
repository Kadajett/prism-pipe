import type { Middleware } from '../core/pipeline.js';

/**
 * Prepend/append system prompts from route config to ctx.request.systemPrompt.
 */
export function createInjectSystemMiddleware(options?: {
  prepend?: string;
  append?: string;
}): Middleware {
  return async function injectSystem(ctx, next) {
    if (options?.prepend || options?.append) {
      const parts: string[] = [];
      if (options.prepend) parts.push(options.prepend);
      if (ctx.request.systemPrompt) parts.push(ctx.request.systemPrompt);
      if (options.append) parts.push(options.append);
      ctx.request.systemPrompt = parts.join('\n\n');
    }
    await next();
  };
}
