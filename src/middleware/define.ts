/**
 * Helper for defining typed middleware with a clean API.
 *
 * Usage:
 *   export default defineMiddleware('my-logger', async (ctx, next) => {
 *     ctx.log.info('Request started');
 *     await next();
 *     ctx.log.info('Request completed');
 *   });
 */

import type { PipelineContext } from '../core/context';
import type { NamedMiddleware } from '../plugin/types';

export type MiddlewareHandler = (ctx: PipelineContext, next: () => Promise<void>) => Promise<void>;

export interface DefineMiddlewareOptions {
  /** Lower = earlier in the pipeline. Default: 100 */
  priority?: number;
}

/**
 * Define a named middleware with typed context and next pattern.
 */
export function defineMiddleware(
  name: string,
  handler: MiddlewareHandler,
  options?: DefineMiddlewareOptions,
): NamedMiddleware {
  // Assign the name to the function for debug/profiling
  Object.defineProperty(handler, 'name', { value: name, configurable: true });

  return {
    name,
    middleware: handler,
    priority: options?.priority,
  };
}
