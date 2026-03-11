import type { Request, Response } from 'express';
import type { StatsTracker } from '../admin/routes';
import { PipelineContext } from '../core/context';
import type {
  CanonicalMessage,
  ModelDefinition,
  ResolvedConfig,
  RouteHandler,
  RouteResult,
  ScopedLogger,
} from '../core/types';
import { RouteResultSchema } from '../core/types';
import type { Store, UsageLogEntry } from '../store/interface';

interface FunctionRouteUsageTotals {
  inputTokens: number;
  outputTokens: number;
}

interface FunctionRouteRuntime {
  logger: ScopedLogger;
  proxyId: string;
  resolveModel: (name: string) => ModelDefinition | undefined;
  stats: StatsTracker;
  store: Store;
}

export async function executeFunctionRoute(opts: {
  config: ResolvedConfig;
  handler: RouteHandler;
  port: string;
  req: Request;
  res: Response;
  routePath: string;
  runtime: FunctionRouteRuntime;
}): Promise<void> {
  const { config, handler, port, req, res, routePath, runtime } = opts;
  const startTime = Date.now();
  const requestState = req as unknown as Record<string, unknown>;
  const reqId = requestState.requestId as string;
  let inputTokens = 0;
  let model = resolveRequestedModel(req);
  let provider = 'route-handler';
  let responseStatus = 200;
  let outputTokens = 0;
  let errorClass: string | undefined;
  let usageEntries: UsageLogEntry[] = [];

  try {
    const ctx = new PipelineContext({
      request: buildRouteCanonicalRequest(req),
      config,
    });
    ctx.metadata.set('port', port);
    ctx.metadata.set('proxyId', runtime.proxyId);
    ctx.metadata.set('routePath', routePath);

    const result = await handler(req, res, ctx);
    if (res.headersSent) {
      responseStatus = res.statusCode;
      if (result === undefined) {
        return;
      }

      const normalized = normalizeRouteResult(result);
      const usageTotals = summarizeRouteUsage(normalized.usage);
      const usageModels = Object.keys(normalized.usage ?? {});
      usageEntries = buildRouteUsageEntries({
        port,
        proxyId: runtime.proxyId,
        requestId: reqId,
        resolveModel: runtime.resolveModel,
        routePath,
        tenantId: req.tenant?.tenantId,
        timestamp: startTime,
        usage: normalized.usage,
      });

      inputTokens = usageTotals.inputTokens;
      outputTokens = usageTotals.outputTokens;
      model = resolveUsageModel(usageModels, model);
      provider = resolveUsageProvider(usageModels, provider, runtime.resolveModel);
      return;
    }

    if (result === undefined) {
      responseStatus = 204;
      res.status(204).end();
      return;
    }

    const normalized = normalizeRouteResult(result);
    const usageTotals = summarizeRouteUsage(normalized.usage);
    const usageModels = Object.keys(normalized.usage ?? {});
    usageEntries = buildRouteUsageEntries({
      port,
      proxyId: runtime.proxyId,
      requestId: reqId,
      resolveModel: runtime.resolveModel,
      routePath,
      tenantId: req.tenant?.tenantId,
      timestamp: startTime,
      usage: normalized.usage,
    });

    inputTokens = usageTotals.inputTokens;
    outputTokens = usageTotals.outputTokens;
    model = resolveUsageModel(usageModels, model);
    provider = resolveUsageProvider(usageModels, provider, runtime.resolveModel);

    if (normalized.meta?.headers) {
      for (const [header, value] of Object.entries(normalized.meta.headers)) {
        res.setHeader(header, value);
      }
    }

    responseStatus = normalized.meta?.status ?? 200;
    res.setHeader('X-Prism-Route-Type', 'function');
    res.status(responseStatus).json(normalized.data);
  } catch (error) {
    if (error instanceof Error) {
      errorClass = error.name;
    }

    if (error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number') {
      responseStatus = error.statusCode;
    } else {
      responseStatus = 500;
    }

    runtime.stats.recordError();
    res.status(responseStatus).json({
      error: {
        message: error instanceof Error ? error.message : 'Internal server error',
        code: errorClass ?? 'unknown',
      },
    });
  } finally {
    const latencyMs = Date.now() - startTime;

    runtime.stats.recordRequest(provider, latencyMs, req.tenant?.tenantId);
    if (inputTokens > 0 || outputTokens > 0) {
      runtime.stats.recordTokens(inputTokens, outputTokens);
    }

    await runtime.store
      .logRequest({
        request_id: reqId,
        timestamp: startTime,
        method: req.method,
        path: req.path,
        provider,
        model,
        status: responseStatus,
        latency_ms: latencyMs,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        error_class: errorClass,
        source_ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
        port,
        proxy_id: runtime.proxyId,
        route_path: routePath,
        tenant_id: req.tenant?.tenantId,
      })
      .catch((error) => {
        runtime.logger.error('Failed to log function route request', {
          error: error instanceof Error ? error.message : String(error),
          requestId: reqId,
          routePath,
        });
      });

    await runtime.store.recordUsage(usageEntries).catch((error) => {
      runtime.logger.error('Failed to log function route usage', {
        error: error instanceof Error ? error.message : String(error),
        requestId: reqId,
        routePath,
      });
    });
  }
}

function buildRouteCanonicalRequest(req: Request): {
  model: string;
  messages: CanonicalMessage[];
  stream?: boolean;
  systemPrompt?: string;
  extras?: Record<string, unknown>;
} {
  const body = isRecord(req.body) ? req.body : {};
  const messages = Array.isArray(body.messages) ? (body.messages as CanonicalMessage[]) : [];
  const request = {
    model: resolveRequestedModel(req),
    messages,
    stream: typeof body.stream === 'boolean' ? body.stream : undefined,
    systemPrompt: typeof body.system === 'string' ? body.system : undefined,
    extras: body,
  };

  if (!request.stream) {
    delete request.stream;
  }

  if (!request.systemPrompt) {
    delete request.systemPrompt;
  }

  return request;
}

function normalizeRouteResult(result: RouteResult | unknown): RouteResult {
  const parsed = RouteResultSchema.safeParse(result);
  if (parsed.success) {
    return parsed.data;
  }

  return RouteResultSchema.parse({ data: result });
}

function summarizeRouteUsage(usage?: RouteResult['usage']): FunctionRouteUsageTotals {
  if (!usage) {
    return { inputTokens: 0, outputTokens: 0 };
  }

  let inputTokens = 0;
  let outputTokens = 0;

  for (const modelUsage of Object.values(usage)) {
    inputTokens += modelUsage.inputTokens ?? 0;
    outputTokens += modelUsage.outputTokens ?? 0;
  }

  return { inputTokens, outputTokens };
}

function buildRouteUsageEntries(opts: {
  port: string;
  proxyId: string;
  requestId: string;
  resolveModel: (name: string) => ModelDefinition | undefined;
  routePath: string;
  tenantId?: string;
  timestamp: number;
  usage?: RouteResult['usage'];
}): UsageLogEntry[] {
  const { port, proxyId, requestId, resolveModel, routePath, tenantId, timestamp, usage } = opts;
  if (!usage) {
    return [];
  }

  return Object.entries(usage).map(([model, modelUsage]) => ({
    request_id: requestId,
    timestamp,
    model,
    provider: resolveModel(model)?.provider,
    input_tokens: modelUsage.inputTokens ?? 0,
    output_tokens: modelUsage.outputTokens ?? 0,
    thinking_tokens: modelUsage.thinkingTokens ?? 0,
    cache_read_tokens: modelUsage.cacheReadTokens ?? 0,
    cache_write_tokens: modelUsage.cacheWriteTokens ?? 0,
    port,
    proxy_id: proxyId,
    route_path: routePath,
    tenant_id: tenantId,
  }));
}

function resolveRequestedModel(req: Request): string {
  const body = isRecord(req.body) ? req.body : {};
  if (typeof body.model === 'string' && body.model.length > 0) {
    return body.model;
  }

  return 'untracked';
}

function resolveUsageModel(models: string[], fallback: string): string {
  if (models.length === 0) {
    return fallback;
  }

  if (models.length === 1) {
    return models[0] ?? fallback;
  }

  return 'multiple';
}

function resolveUsageProvider(
  models: string[],
  fallback: string,
  resolveModel: (name: string) => ModelDefinition | undefined
): string {
  if (models.length !== 1) {
    return fallback;
  }

  return resolveModel(models[0] ?? '')?.provider ?? fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
