import type { Express, Request, Response } from 'express';
import type { StatsTracker } from '../admin/routes';
import { ChainComposer } from '../compose/chain';
import { ToolRouterComposer } from '../compose/tool-router';
import type { CallProviderFn, CompositionStep } from '../core/composer';
import { PipelineContext } from '../core/context';
import type { PipelineEngine } from '../core/pipeline';
import { createTimeoutBudget } from '../core/timeout';
import type {
  CanonicalRequest,
  CanonicalResponse,
  ComposeStepConfig,
  ProviderConfig,
  ProxyErrorEvent,
  ResolvedConfig,
  UsageInfo,
} from '../core/types';
import { PipelineError } from '../core/types';
import { executeFallbackChain } from '../fallback/chain';
import type { AgentFactory } from '../network/agent-factory';
import { withFeatureDegradation } from '../proxy/feature-degradation';
import { callProvider as rawCallProvider } from '../proxy/provider';
import { writeSSEStream } from '../proxy/stream';
import type { ProviderTransformer, TransformRegistry } from '../proxy/transform-registry';
import type { Store, UsageLogEntry } from '../store/interface';

export interface RouterOptions {
  config: ResolvedConfig;
  pipeline: PipelineEngine;
  transformRegistry: TransformRegistry;
  store?: Store;
  stats?: StatsTracker;
  agentFactory?: AgentFactory;
  proxyId?: string;
  port?: string;
  /** Callback to emit error events to the proxy/prism error handler chain */
  emitError?: (event: ProxyErrorEvent) => void;
}

interface RouteExecutionState {
  composeSteps?: number;
  errorClass?: string;
  fallbackUsed?: boolean;
  model: string;
  provider: string;
  responseStatus: number;
  upstreamLatencyMs?: number;
  usageInput: number;
  usageOutput: number;
}

interface RequestScope {
  port?: string;
  proxyId?: string;
  reqId: string;
  tenantId?: string;
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
  const {
    agentFactory,
    config,
    emitError,
    pipeline,
    port,
    proxyId,
    stats,
    store,
    transformRegistry,
  } = opts;

  for (const route of config.routes) {
    app.post(route.path, async (req: Request, res: Response) => {
      const startTime = Date.now();
      const requestScope = createRequestScope(req, port, proxyId);
      const reqId = requestScope.reqId;
      const execution = createExecutionState('unknown', resolveRequestedModel(req));
      let usageEntries: UsageLogEntry[] = [];

      try {
        const body = req.body as Record<string, unknown>;
        const clientFormat = detectClientFormat(body);
        const clientTransformer = transformRegistry.get(clientFormat);
        const serializer = clientTransformer.responseFromCanonical.bind(clientTransformer);

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

        const providers = providerNames.map((name) =>
          resolveProvider({
            clientFormat,
            clientTransformer,
            errorStep: 'router',
            providerRef: name,
            providers: config.providers,
            transformRegistry,
            log: ctx.log,
          })
        );

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
          usageEntries = respondWithCanonicalResponse({
            canonicalResponse: ctx.response,
            composeSteps: undefined,
            execution,
            fallbackUsed: false,
            port: requestScope.port,
            provider: primaryProvider.config.name,
            proxyId: requestScope.proxyId,
            reqId,
            res,
            routePath: route.path,
            serializer,
            tenantId: requestScope.tenantId,
            totalMs: Date.now() - startTime,
            timestamp: startTime,
            upstreamLatencyMs: 0,
          });
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
              const resolvedProvider = resolveProvider({
                clientFormat,
                clientTransformer,
                errorStep: 'tool_router',
                providerRef: provider,
                providers: config.providers,
                transformRegistry,
                log: ctx.log,
              });

              const providerBody = resolvedProvider.transformer.fromCanonical(request);
              const result = await rawCallProvider({
                providerConfig: resolvedProvider.config,
                transformer: resolvedProvider.transformer,
                body: providerBody,
                timeout,
                agent: agentFactory?.getAgent(resolvedProvider.agentName),
              });
              return result.response;
            };

            const result = await toolRouter.execute(canonicalRequest, providerCall);
            const totalMs = Date.now() - startTime;
            usageEntries = respondWithCanonicalResponse({
              canonicalResponse: result,
              composeSteps: undefined,
              execution,
              fallbackUsed: false,
              port: requestScope.port,
              provider: 'tool-router',
              proxyId: requestScope.proxyId,
              reqId,
              res,
              routePath: route.path,
              serializer,
              tenantId: requestScope.tenantId,
              totalMs: Date.now() - startTime,
              timestamp: startTime,
              upstreamLatencyMs: 0,
            });

            ctx.log.info('tool-router request completed', { totalMs });
            return;
          }

          // Chain composition (existing)
          const composer = new ChainComposer();

          // Build CallProviderFn that resolves provider by name
          const callProviderFn: CallProviderFn = async (request, providerName, timeout) => {
            const resolvedProvider = resolveProvider({
              clientFormat,
              clientTransformer,
              errorStep: 'compose_router',
              providerRef: providerName,
              providers: config.providers,
              transformRegistry,
              log: ctx.log,
            });

            const providerBody = resolvedProvider.transformer.fromCanonical(request);
            const result = await rawCallProvider({
              providerConfig: resolvedProvider.config,
              transformer: resolvedProvider.transformer,
              body: providerBody,
              timeout,
              agent: agentFactory?.getAgent(resolvedProvider.agentName),
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
          execution.composeSteps = result.steps.length;
          execution.provider = 'compose';
          if (result.finalResponse) {
            usageEntries = respondWithCanonicalResponse({
              canonicalResponse: result.finalResponse,
              composeSteps: result.steps.length,
              execution,
              fallbackUsed: false,
              port: requestScope.port,
              provider: 'compose',
              proxyId: requestScope.proxyId,
              reqId,
              res,
              routePath: route.path,
              serializer,
              tenantId: requestScope.tenantId,
              totalMs,
              timestamp: startTime,
              upstreamLatencyMs: 0,
            });
            res.setHeader('X-Prism-Compose-Steps', String(result.steps.length));
          } else {
            // Partial/errored — still normalize through the canonical response path.
            const lastSuccess = [...result.steps]
              .reverse()
              .find((s) => s.status === 'success' || s.status === 'defaulted');
            const fallbackResponse: CanonicalResponse = {
              id: `compose-${reqId}`,
              model: 'compose',
              content: [{ type: 'text', text: lastSuccess?.content ?? '' }],
              stopReason: 'end',
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            };

            usageEntries = respondWithCanonicalResponse({
              canonicalResponse: fallbackResponse,
              composeSteps: result.steps.length,
              execution,
              fallbackUsed: false,
              port: requestScope.port,
              provider: 'compose',
              proxyId: requestScope.proxyId,
              reqId,
              res,
              routePath: route.path,
              serializer,
              tenantId: requestScope.tenantId,
              totalMs,
              timestamp: startTime,
              upstreamLatencyMs: 0,
            });
            res.setHeader('X-Prism-Compose-Steps', String(result.steps.length));
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
            const fallbackUsed =
              providers.length > 1 && result.provider !== primaryProvider.config.name;
            execution.provider = result.provider;
            execution.model = ctx.request.model;
            execution.responseStatus = 200;
            execution.fallbackUsed = fallbackUsed;
            execution.upstreamLatencyMs = Math.round(result.latencyMs);
            setResponseHeaders(res, reqId, result.provider, preStreamMs);
            if (fallbackUsed) {
              res.setHeader('X-Prism-Fallback-Used', 'true');
            }
            res.setHeader('X-Prism-Upstream-Latency', String(Math.round(result.latencyMs)));

            const streamUsage = await writeSSEStream(res, result.chunks, clientTransformer);
            if (streamUsage) {
              execution.usageInput = streamUsage.inputTokens;
              execution.usageOutput = streamUsage.outputTokens;
              usageEntries = buildUsageEntries({
                model: ctx.request.model,
                usage: streamUsage,
                port: requestScope.port,
                provider: result.provider,
                proxyId: requestScope.proxyId,
                requestId: reqId,
                routePath: route.path,
                tenantId: requestScope.tenantId,
                timestamp: startTime,
              });
            }

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
          const fallbackUsed =
            providers.length > 1 && result.provider !== primaryProvider.config.name;
          usageEntries = respondWithCanonicalResponse({
            canonicalResponse: result.response,
            composeSteps: undefined,
            execution,
            fallbackUsed,
            port: requestScope.port,
            provider: result.provider,
            proxyId: requestScope.proxyId,
            reqId,
            res,
            routePath: route.path,
            serializer,
            tenantId: requestScope.tenantId,
            totalMs: Date.now() - startTime,
            timestamp: startTime,
            upstreamLatencyMs: Math.round(result.latencyMs),
          });

          ctx.log.info('request completed', {
            model: ctx.response.model ?? ctx.request.model,
            provider: result.provider,
            latency: Date.now() - startTime,
            latency_upstream_ms: Math.round(result.latencyMs),
            latency_total_ms: Date.now() - startTime,
            inputTokens: ctx.response.usage?.inputTokens,
            outputTokens: ctx.response.usage?.outputTokens,
            stopReason: ctx.response.stopReason,
          });
          ctx.metrics.histogram('request.latency_ms', Date.now() - startTime);
          ctx.metrics.histogram('request.upstream_latency_ms', result.latencyMs);
        }
      } catch (err) {
        if (err instanceof PipelineError) {
          execution.responseStatus = err.statusCode;
          execution.errorClass = err.code;
          stats?.recordError();

          emitError?.({
            error: err,
            errorClass: err.code,
            context: {
              port: requestScope.port,
              route: route.path,
              requestId: requestScope.reqId,
              provider: execution.provider !== 'unknown' ? execution.provider : undefined,
              tenantId: requestScope.tenantId,
            },
          });

          res.status(err.statusCode).json({
            error: { message: err.message, code: err.code, step: err.step },
          });
        } else {
          execution.responseStatus = 500;
          execution.errorClass = 'unknown';
          stats?.recordError();

          const errorObj = err instanceof Error ? err : new Error(String(err));
          emitError?.({
            error: errorObj,
            errorClass: 'unknown',
            context: {
              port: requestScope.port,
              route: route.path,
              requestId: requestScope.reqId,
              provider: execution.provider !== 'unknown' ? execution.provider : undefined,
              tenantId: requestScope.tenantId,
            },
          });

          console.error('Unhandled route error:', err);
          res.status(500).json({
            error: { message: 'Internal server error', code: 'unknown' },
          });
        }
      } finally {
        const latencyMs = Date.now() - startTime;

        // Record stats
        if (stats) {
          stats.recordRequest(execution.provider, latencyMs, req.tenant?.tenantId);
          if (execution.usageInput > 0 || execution.usageOutput > 0) {
            stats.recordTokens(execution.usageInput, execution.usageOutput);
          }
        }

        // Log request to store
        if (store) {
          store
            .logRequest({
              request_id: reqId,
              timestamp: startTime,
              method: req.method,
              path: req.path,
              provider: execution.provider,
              model: execution.model,
              status: execution.responseStatus,
              latency_ms: latencyMs,
              input_tokens: execution.usageInput,
              output_tokens: execution.usageOutput,
              error_class: execution.errorClass,
              source_ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
              port: requestScope.port,
              proxy_id: requestScope.proxyId,
              route_path: route.path,
              tenant_id: requestScope.tenantId,
              compose_steps: execution.composeSteps,
              fallback_used: execution.fallbackUsed,
              upstream_latency_ms: execution.upstreamLatencyMs,
            })
            .catch((logErr) => {
              console.error('Failed to log request to store:', logErr);
            });

          store.recordUsage(usageEntries).catch((logErr) => {
            console.error('Failed to log usage entries to store:', logErr);
          });
        }
      }
    });
  }
}

function createRequestScope(req: Request, port?: string, proxyId?: string): RequestScope {
  const requestState = req as unknown as Record<string, unknown>;
  return {
    port: port ?? (requestState.port as string | undefined),
    proxyId: proxyId ?? (requestState.proxyId as string | undefined),
    reqId: requestState.requestId as string,
    tenantId: req.tenant?.tenantId,
  };
}

function setResponseHeaders(res: Response, reqId: string, provider: string, latencyMs: number) {
  res.setHeader('X-Request-ID', reqId);
  res.setHeader('X-Prism-Provider', provider);
  res.setHeader('X-Prism-Latency', String(Math.round(latencyMs)));
}

function applyCanonicalResponse(opts: {
  canonicalResponse: CanonicalResponse;
  composeSteps?: number;
  execution: RouteExecutionState;
  fallbackUsed: boolean;
  provider: string;
  reqId: string;
  res: Response;
  serializer: (response: CanonicalResponse) => unknown;
  totalMs: number;
  upstreamLatencyMs: number;
}): void {
  const {
    canonicalResponse,
    composeSteps,
    execution,
    fallbackUsed,
    provider,
    reqId,
    res,
    serializer,
    totalMs,
    upstreamLatencyMs,
  } = opts;

  execution.composeSteps = composeSteps;
  execution.fallbackUsed = fallbackUsed;
  execution.model = canonicalResponse.model;
  execution.provider = provider;
  execution.responseStatus = 200;
  execution.upstreamLatencyMs = upstreamLatencyMs > 0 ? upstreamLatencyMs : undefined;
  execution.usageInput = canonicalResponse.usage?.inputTokens ?? 0;
  execution.usageOutput = canonicalResponse.usage?.outputTokens ?? 0;

  setResponseHeaders(res, reqId, provider, totalMs);
  if (upstreamLatencyMs > 0) {
    res.setHeader('X-Prism-Upstream-Latency', String(upstreamLatencyMs));
  }
  if (fallbackUsed) {
    res.setHeader('X-Prism-Fallback-Used', 'true');
  }

  res.json(serializer(canonicalResponse));
}

function respondWithCanonicalResponse(opts: {
  canonicalResponse: CanonicalResponse;
  composeSteps?: number;
  execution: RouteExecutionState;
  fallbackUsed: boolean;
  port?: string;
  provider: string;
  proxyId?: string;
  reqId: string;
  res: Response;
  routePath: string;
  serializer: (response: CanonicalResponse) => unknown;
  tenantId?: string;
  timestamp: number;
  totalMs: number;
  upstreamLatencyMs: number;
}): UsageLogEntry[] {
  const {
    canonicalResponse,
    composeSteps,
    execution,
    fallbackUsed,
    port,
    provider,
    proxyId,
    reqId,
    res,
    routePath,
    serializer,
    tenantId,
    timestamp,
    totalMs,
    upstreamLatencyMs,
  } = opts;

  const usageEntries = buildUsageEntries({
    model: canonicalResponse.model,
    usage: canonicalResponse.usage,
    port,
    provider,
    proxyId,
    requestId: reqId,
    routePath,
    tenantId,
    timestamp,
  });

  applyCanonicalResponse({
    canonicalResponse,
    composeSteps,
    execution,
    fallbackUsed,
    provider,
    reqId,
    res,
    serializer,
    totalMs,
    upstreamLatencyMs,
  });

  return usageEntries;
}

function createExecutionState(provider: string, model: string): RouteExecutionState {
  return {
    model,
    provider,
    responseStatus: 200,
    usageInput: 0,
    usageOutput: 0,
  };
}

function resolveProvider(opts: {
  clientFormat: string;
  clientTransformer: ProviderTransformer;
  errorStep: string;
  providerRef: string;
  providers: Record<string, ProviderConfig>;
  transformRegistry: TransformRegistry;
  log: PipelineContext['log'];
}): {
  agentName: string;
  config: ProviderConfig;
  transformer: ProviderTransformer;
} {
  const {
    clientFormat,
    clientTransformer,
    errorStep,
    providerRef,
    providers,
    transformRegistry,
    log,
  } = opts;
  const [agentName] = providerRef.split('/');
  const providerName = agentName ?? providerRef;
  const providerConfig = providers[providerName];
  if (!providerConfig) {
    throw new PipelineError(`Unknown provider "${providerRef}"`, 'invalid_request', errorStep, 400);
  }

  const format =
    providerConfig.format ??
    (providerConfig.baseUrl.includes('anthropic') ? 'anthropic' : undefined) ??
    (providerConfig.baseUrl.includes('openai') ? 'openai' : undefined) ??
    clientFormat;
  const rawTransformer = transformRegistry.has(format)
    ? transformRegistry.get(format)
    : clientTransformer;

  return {
    agentName: providerName,
    config: providerConfig,
    transformer: withFeatureDegradation(rawTransformer, log),
  };
}

function resolveRequestedModel(req: Request): string {
  const body = req.body as Record<string, unknown> | undefined;
  if (typeof body?.model === 'string' && body.model.length > 0) {
    return body.model;
  }

  return 'untracked';
}

function buildUsageEntries(opts: {
  model: string;
  port?: string;
  provider: string;
  proxyId?: string;
  requestId: string;
  routePath: string;
  tenantId?: string;
  timestamp: number;
  usage?: UsageInfo;
}): UsageLogEntry[] {
  const { model, port, provider, proxyId, requestId, routePath, tenantId, timestamp, usage } = opts;
  if (!usage) {
    return [];
  }

  return [
    {
      request_id: requestId,
      timestamp,
      model,
      provider,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      thinking_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
      port,
      proxy_id: proxyId,
      route_path: routePath,
      tenant_id: tenantId,
    },
  ];
}
