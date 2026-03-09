import type { Middleware } from '../core/pipeline.js';
import type { TransformRegistry } from '../proxy/transform-registry.js';

/**
 * Auto-detect client format and transform to/from canonical.
 * On the way in: detect client format, convert to canonical.
 * On the way out: convert canonical response back to client format.
 */
export function createTransformMiddleware(registry: TransformRegistry): Middleware {
  return async function transformFormat(ctx, next) {
    // Detect client format from metadata (set by router)
    const _clientFormat = ctx.metadata.get('clientFormat') as string | undefined;
    const providerFormat = ctx.metadata.get('providerFormat') as string | undefined;

    // If provider format differs from client format, transform the request
    if (providerFormat && registry.has(providerFormat)) {
      const providerTransformer = registry.get(providerFormat);

      // Check feature degradation
      const caps = providerTransformer.capabilities;

      if (!caps.supportsTools && ctx.request.tools?.length) {
        ctx.log.warn('Provider does not support tools, degrading to system prompt instructions', {
          provider: providerFormat,
        });
        const toolDesc = ctx.request.tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
        ctx.request.systemPrompt =
          (ctx.request.systemPrompt ?? '') +
          `\n\nYou have access to these tools (describe their use in your response):\n${toolDesc}`;
        ctx.request.tools = undefined;
      }

      if (
        !caps.supportsVision &&
        ctx.request.messages.some((m) => {
          if (typeof m.content === 'string') return false;
          return m.content.some((b) => b.type === 'image');
        })
      ) {
        ctx.log.warn('Provider does not support vision, stripping images', {
          provider: providerFormat,
        });
        ctx.request.messages = ctx.request.messages.map((m) => {
          if (typeof m.content === 'string') return m;
          return {
            ...m,
            content: m.content.filter((b) => b.type !== 'image'),
          };
        });
      }

      if (!caps.supportsThinking) {
        // Strip thinking blocks from messages
        ctx.request.messages = ctx.request.messages.map((m) => {
          if (typeof m.content === 'string') return m;
          return {
            ...m,
            content: m.content.filter((b) => b.type !== 'thinking'),
          };
        });
      }
    }

    await next();

    // Post-processing: if we need to convert response format
    // The response is already in canonical format from the provider caller
    // No additional transform needed here — the router handles serialization
  };
}
