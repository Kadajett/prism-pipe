import type { Express, Request, Response } from 'express';
import { PipelineContext } from '../core/context.js';
import type { PipelineEngine } from '../core/pipeline.js';
import { createTimeoutBudget } from '../core/timeout.js';
import type { CanonicalRequest, ProviderConfig, ResolvedConfig } from '../core/types.js';
import { PipelineError } from '../core/types.js';
import { executeFallbackChain } from '../fallback/chain.js';
import { writeSSEStream } from '../proxy/stream.js';
import type { TransformRegistry } from '../proxy/transform-registry.js';

/**
 * Resolve the API format for a provider config.
 * Uses explicit `format` field, falls back to baseUrl detection, then defaults to 'openai'.
 */
function resolveProviderFormat(provider: ProviderConfig): string {
  if (provider.format) return provider.format;
  if (provider.baseUrl.includes('anthropic')) return 'anthropic';
  if (provider.baseUrl.includes('openai')) return 'openai';
  // Default to openai-compatible format (most providers use it)
  return 'openai';
}

export interface RouterOptions {
  config: ResolvedConfig;
  pipeline: PipelineEngine;
  transformRegistry: TransformRegistry;
}

/**
 * Detect what format the client is sending (openai or anthropic).
 * Checks explicit header first, then structural cues.
 */
function detectClientFormat(body: Record<string, unknown>, headers?: Record<string, string | string[] | undefined>): string {
  // Explicit header takes priority
  const explicitFormat = headers?.['x-prism-format'];
  if (typeof explicitFormat === 'string' && (explicitFormat === 'openai' || explicitFormat === 'anthropic')) {
    return explicitFormat;
  }

  // Anthropic structural cues: top-level `system` string, or content blocks with Anthropic-specific types
  if (typeof body.system === 'string') return 'anthropic';

  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (messages?.some(
    (m) =>
      Array.isArray(m.content) &&
      (m.content as Array<Record<string, unknown>>).some(
        (b) => b.type === 'tool_use' || b.type === 'tool_result'
      )
  )) {
    return 'anthropic';
  }

  // Default to OpenAI format
  return 'openai';
}

export function setupRoutes(app: Express, opts: RouterOptions) {
  const { config, pipeline, transformRegistry } = opts;

  for (const route of config.routes) {
    app.post(route.path, async (req: Request, res: Response) => {
      const startTime = Date.now();
      const reqId = (req as unknown as Record<string, unknown>).requestId as string;

      try {
        const body = req.body as Record<string, unknown>;
        const clientFormat = detectClientFormat(body, req.headers as Record<string, string | string[] | undefined>);
        const clientTransformer = transformRegistry.get(clientFormat);

        // Convert client request to canonical
        const canonicalRequest: CanonicalRequest = clientTransformer.toCanonical(body);

        // Resolve provider chain
        const providerNames =
          route.providers.length > 0 ? route.providers : Object.keys(config.providers);

        if (providerNames.length === 0) {
          throw new PipelineError('No providers configured', 'invalid_request', 'router', 400);
        }

        const providers = providerNames
          .filter((name) => config.providers[name])
          .map((name) => {
            const providerCfg = config.providers[name];
            // Resolve transformer by provider format, not provider name
            const format = resolveProviderFormat(providerCfg);
            return {
              config: providerCfg,
              transformer: transformRegistry.has(format)
                ? transformRegistry.get(format)
                : clientTransformer,
            };
          });

        // Determine target provider format
        const primaryProvider = providers[0];
        const providerFormat = primaryProvider.transformer.provider;

        // Create pipeline context
        const timeout = createTimeoutBudget(config.requestTimeout);
        const ctx = new PipelineContext({
          request: canonicalRequest,
          config,
          timeout,
        });

        ctx.metadata.set('clientFormat', clientFormat);
        ctx.metadata.set('providerFormat', providerFormat);
        ctx.metadata.set('provider', primaryProvider.config.name);
        ctx.metadata.set('routePath', route.path);

        // Inject system prompt from route config
        if (route.systemPrompt && !ctx.request.systemPrompt) {
          ctx.request.systemPrompt = route.systemPrompt;
        }

        // Run pre-flight pipeline
        await pipeline.execute(ctx);

        // If pipeline set a response (e.g., cache hit), return it
        if (ctx.response) {
          const serialized = clientTransformer.responseFromCanonical(ctx.response);
          setResponseHeaders(res, reqId, primaryProvider.config.name, Date.now() - startTime);
          res.json(serialized);
          return;
        }

        // Convert canonical to provider format for the call
        const providerBody = primaryProvider.transformer.fromCanonical(ctx.request);

        // Call provider (with fallback chain)
        if (ctx.request.stream) {
          const result = await executeFallbackChain({
            providers,
            body: providerBody,
            stream: true,
            timeout,
            log: ctx.log,
          });

          if ('chunks' in result) {
            setResponseHeaders(res, reqId, result.provider, result.latencyMs);
            await writeSSEStream(res, result.chunks, clientTransformer);
            return;
          }
        }

        const result = await executeFallbackChain({
          providers,
          body: providerBody,
          stream: false,
          timeout,
          log: ctx.log,
        });

        if ('response' in result) {
          ctx.response = result.response;
          ctx.metadata.set('provider', result.provider);

          const serialized = clientTransformer.responseFromCanonical(result.response);
          setResponseHeaders(res, reqId, result.provider, Date.now() - startTime);
          if (providers.length > 1 && result.provider !== primaryProvider.config.name) {
            res.setHeader('X-Prism-Fallback-Used', 'true');
          }
          res.json(serialized);
        }
      } catch (err) {
        if (err instanceof PipelineError) {
          res.status(err.statusCode).json({
            error: { message: err.message, code: err.code, step: err.step },
          });
        } else {
          console.error('Unhandled route error:', err);
          res.status(500).json({
            error: { message: 'Internal server error', code: 'unknown' },
          });
        }
      }
    });
  }
}

function setResponseHeaders(res: Response, reqId: string, provider: string, latencyMs: number) {
  res.setHeader('X-Request-ID', reqId);
  res.setHeader('X-Prism-Provider', provider);
  res.setHeader('X-Prism-Latency', String(Math.round(latencyMs)));
}
