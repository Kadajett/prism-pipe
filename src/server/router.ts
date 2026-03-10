import type { Express, Request, Response } from 'express';
import type http from 'node:http';
import type https from 'node:https';
import { ChainComposer } from '../compose/chain';
import { ToolRouterComposer } from '../compose/tool-router';
import type { CallProviderFn, CompositionStep } from '../core/composer';
import { PipelineContext } from '../core/context';
import type { PipelineEngine } from '../core/pipeline';
import { createTimeoutBudget } from '../core/timeout';
import type { CanonicalRequest, ComposeStepConfig, ResolvedConfig } from '../core/types';
import { PipelineError } from '../core/types';
import { executeFallbackChain } from '../fallback/chain';
import { callProvider as rawCallProvider } from '../proxy/provider';
import { withFeatureDegradation } from '../proxy/feature-degradation';
import { writeSSEStream } from '../proxy/stream';
import type { TransformRegistry } from '../proxy/transform-registry';
import type { Store } from '../store/interface';
import type { StatsTracker } from '../admin/routes';
import type { AgentFactory } from '../network/agent-factory';

export interface RouterOptions {
  config: ResolvedConfig;
  pipeline: PipelineEngine;
  transformRegistry: TransformRegistry;
  store?: Store;
  stats?: StatsTracker;
  agentFactory?: AgentFactory;
}

/**
 * Detect what format the client is sending (openai or anthropic).
 */
function detectClientFormat(body: Record<string, unknown>): string {
  // Anthropic requests have top-level 'system' and content blocks
  if (body.system !== undefined || (body.messages && !body.model?.toString().startsWith('gpt'))) {
    // Check for Anthropic-style content blocks
    const messages = body.messages as Array<Record<string, unknown>> | undefined;
    if (
      messages?.some(
        (m) =>
          Array.isArray(m.content) &&
          (m.content as Array<Record<string, unknown>>).some(
            (b) => b.type === 'tool_use' || b.type === 'tool_result'
          )
      )
    ) {
      return 'anthropic';
    }
  }
  // Default to OpenAI format
  return 'openai';
}

export function setupRoutes(app: Express, opts: RouterOptions) {
  const { config, pipeline, transformRegistry, store, stats, agentFactory } = opts;

  for (const route of config.routes) {
    app.post(route.path, async (req: Request, res: Response) => {
      const startTime = Date.now();
      const reqId = (req as unknown as Record<string, unknown>).requestId as string;
      let responseProvider = 'unknown';
      let responseStatus = 200;
      let usageInput = 0;
      let usageOutput = 0;
      let errorClass: string | undefined;

      try {
        const body = req.body as Record<string, unknown>;
        const clientFormat = detectClientFormat(body);
        const clientTransformer = transformRegistry.get(clientFormat);

        // Convert client request to canonical
        const canonicalRequest: CanonicalRequest = clientTransformer.toCanonical(body);

        // Create pipeline context early so ctx.log is available for feature degradation
        const timeout = createTimeoutBudget(config.requestTimeout);
        const ctx = new PipelineContext({
          request: canonicalRequest,
          config,
          timeout,
        });

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
            // Resolve transformer by explicit format, then infer from baseUrl, then fall back to client format
            const format =
              providerCfg.format ??
              (providerCfg.baseUrl.includes('anthropic') ? 'anthropic' : undefined) ??
              (providerCfg.baseUrl.includes('openai') ? 'openai' : undefined) ??
              clientFormat;
            const rawTransformer = transformRegistry.has(format)
              ? transformRegistry.get(format)
              : clientTransformer;
            // Wrap with feature degradation
            const transformer = withFeatureDegradation(rawTransformer, ctx.log);
            return {
              config: providerCfg,
              transformer,
            };
          });

        // Determine target provider format
        const primaryProvider = providers[0];
        const providerFormat = primaryProvider.transformer.provider;

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
          usageInput = ctx.response.usage?.inputTokens ?? 0;
          usageOutput = ctx.response.usage?.outputTokens ?? 0;
          responseProvider = primaryProvider.config.name;
          res.json(serialized);
          return;
        }

        // ─── Compose route handling ───
        if (route.compose) {
          if (route.compose.type === 'tool-router') {
            // Tool router composition
            const toolRouterCfg = route.compose.toolRouter;
            const toolRouter = new ToolRouterComposer(
              {
                primary: toolRouterCfg.primary,
                maxRounds: toolRouterCfg.maxRounds,
                tools: toolRouterCfg.tools,
              },
              ctx.log
            );

            const providerCall = async (provider: string, request: CanonicalRequest) => {
              const [provName] = provider.split('/');
              const providerCfg = config.providers[provName ?? provider];
              if (!providerCfg) {
                throw new PipelineError(
                  `Unknown provider "${provider}" in tool-router`,
                  'invalid_request',
                  'tool_router',
                  400
                );
              }
              const format =
                providerCfg.format ??
                (providerCfg.baseUrl.includes('anthropic') ? 'anthropic' : undefined) ??
                (providerCfg.baseUrl.includes('openai') ? 'openai' : undefined) ??
                clientFormat;
              const rawTransformer = transformRegistry.has(format)
                ? transformRegistry.get(format)
                : clientTransformer;
              // Wrap with feature degradation so providers without tool/vision support degrade gracefully
              const transformer = withFeatureDegradation(rawTransformer, ctx.log);

              const providerBody = transformer.fromCanonical(request);
              const result = await rawCallProvider({
                providerConfig: providerCfg,
                transformer,
                body: providerBody,
                timeout,
                agent: agentFactory?.getAgent(provName ?? provider),
              });
              return result.response;
            };

            const result = await toolRouter.execute(canonicalRequest, providerCall);
            const totalMs = Date.now() - startTime;
            const serialized = clientTransformer.responseFromCanonical(result);
            setResponseHeaders(res, reqId, 'tool-router', totalMs);
            responseProvider = 'tool-router';
            usageInput = result.usage?.inputTokens ?? 0;
            usageOutput = result.usage?.outputTokens ?? 0;
            res.json(serialized);

            ctx.log.info('tool-router request completed', { totalMs });
            return;
          }

          // Chain composition (existing)
          const composer = new ChainComposer();

          // Build CallProviderFn that resolves provider by name
          const callProviderFn: CallProviderFn = async (request, providerName, timeout) => {
            const providerCfg = config.providers[providerName];
            if (!providerCfg) {
              throw new PipelineError(
                `Unknown provider "${providerName}" in compose step`,
                'invalid_request',
                'compose_router',
                400,
              );
            }
            const format =
              providerCfg.format ??
              (providerCfg.baseUrl.includes('anthropic') ? 'anthropic' : undefined) ??
              (providerCfg.baseUrl.includes('openai') ? 'openai' : undefined) ??
              clientFormat;
            const transformer = transformRegistry.has(format)
              ? transformRegistry.get(format)
              : clientTransformer;

            const providerBody = transformer.fromCanonical(request);
            const result = await rawCallProvider({
              providerConfig: providerCfg,
              transformer,
              body: providerBody,
              timeout,
              agent: agentFactory?.getAgent(providerName),
            });
            return result.response;
          };

          // Map config steps to CompositionStep[]
          const steps: CompositionStep[] = route.compose.steps.map((s: ComposeStepConfig) => ({
            name: s.name,
            provider: s.provider,
            model: s.model,
            systemPrompt: s.systemPrompt,
            inputTransform: s.inputTransform,
            timeout: s.timeout,
            onError: s.onError,
            defaultContent: s.defaultContent,
          }));

          const result = await composer.execute(ctx, steps, callProviderFn);

          const totalMs = Date.now() - startTime;
          responseProvider = 'compose';
          if (result.finalResponse) {
            const serialized = clientTransformer.responseFromCanonical(result.finalResponse);
            setResponseHeaders(res, reqId, 'compose', totalMs);
            res.setHeader('X-Prism-Compose-Steps', String(result.steps.length));
            usageInput = result.finalResponse.usage?.inputTokens ?? 0;
            usageOutput = result.finalResponse.usage?.outputTokens ?? 0;
            res.json(serialized);
          } else {
            // Partial/errored — build a text response from last successful step
            const lastSuccess = [...result.steps].reverse().find((s) => s.status === 'success' || s.status === 'defaulted');
            setResponseHeaders(res, reqId, 'compose', totalMs);
            res.setHeader('X-Prism-Compose-Steps', String(result.steps.length));
            res.json({
              id: `compose-${reqId}`,
              model: 'compose',
              content: [{ type: 'text', text: lastSuccess?.content ?? '' }],
              stop_reason: 'end',
              usage: { input_tokens: 0, output_tokens: 0 },
            });
          }

          ctx.log.info('compose request completed', {
            steps: result.steps.map((s) => ({ name: s.name, status: s.status, ms: s.durationMs })),
            totalMs,
          });
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
            agent: agentFactory?.getAgent(primaryProvider.config.name),
          });

          if ('chunks' in result) {
            const preStreamMs = Date.now() - startTime;
            responseProvider = result.provider;
            setResponseHeaders(res, reqId, result.provider, preStreamMs);
            res.setHeader('X-Prism-Upstream-Latency', String(Math.round(result.latencyMs)));

            await writeSSEStream(res, result.chunks, clientTransformer);

            const totalMs = Date.now() - startTime;
            ctx.log.info('request completed', {
              model: ctx.request.model,
              provider: result.provider,
              latency: totalMs,
              latency_upstream_ms: Math.round(result.latencyMs),
              latency_ttfb_ms: Math.round(result.ttfbMs),
              latency_total_ms: totalMs,
              stream: true,
            });
            ctx.metrics.histogram('request.latency_ms', totalMs);
            ctx.metrics.histogram('request.upstream_latency_ms', result.latencyMs);
            ctx.metrics.histogram('request.ttfb_ms', result.ttfbMs);

            return;
          }
        }

        const result = await executeFallbackChain({
          providers,
          body: providerBody,
          stream: false,
          timeout,
          log: ctx.log,
          agent: agentFactory?.getAgent(primaryProvider.config.name),
        });

        if ('response' in result) {
          ctx.response = result.response;
          ctx.metadata.set('provider', result.provider);
          responseProvider = result.provider;

          const totalMs = Date.now() - startTime;
          const serialized = clientTransformer.responseFromCanonical(result.response);
          setResponseHeaders(res, reqId, result.provider, totalMs);
          res.setHeader('X-Prism-Upstream-Latency', String(Math.round(result.latencyMs)));
          if (providers.length > 1 && result.provider !== primaryProvider.config.name) {
            res.setHeader('X-Prism-Fallback-Used', 'true');
          }

          usageInput = ctx.response.usage?.inputTokens ?? 0;
          usageOutput = ctx.response.usage?.outputTokens ?? 0;

          ctx.log.info('request completed', {
            model: ctx.response.model ?? ctx.request.model,
            provider: result.provider,
            latency: totalMs,
            latency_upstream_ms: Math.round(result.latencyMs),
            latency_total_ms: totalMs,
            inputTokens: ctx.response.usage?.inputTokens,
            outputTokens: ctx.response.usage?.outputTokens,
            stopReason: ctx.response.stopReason,
          });
          ctx.metrics.histogram('request.latency_ms', totalMs);
          ctx.metrics.histogram('request.upstream_latency_ms', result.latencyMs);

          res.json(serialized);
        }
      } catch (err) {
        if (err instanceof PipelineError) {
          responseStatus = err.statusCode;
          errorClass = err.code;
          stats?.recordError();
          res.status(err.statusCode).json({
            error: { message: err.message, code: err.code, step: err.step },
          });
        } else {
          responseStatus = 500;
          errorClass = 'unknown';
          stats?.recordError();
          console.error('Unhandled route error:', err);
          res.status(500).json({
            error: { message: 'Internal server error', code: 'unknown' },
          });
        }
      } finally {
        const latencyMs = Date.now() - startTime;

        // Record stats
        if (stats) {
          stats.recordRequest(responseProvider, latencyMs);
          if (usageInput > 0 || usageOutput > 0) {
            stats.recordTokens(usageInput, usageOutput);
          }
        }

        // Log request to store
        if (store) {
          const body = req.body as Record<string, unknown>;
          store.logRequest({
            request_id: reqId,
            timestamp: startTime,
            method: req.method,
            path: req.path,
            provider: responseProvider,
            model: (body?.model as string) ?? 'unknown',
            status: responseStatus,
            latency_ms: latencyMs,
            input_tokens: usageInput,
            output_tokens: usageOutput,
            error_class: errorClass,
            source_ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
          }).catch((logErr) => {
            console.error('Failed to log request to store:', logErr);
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
