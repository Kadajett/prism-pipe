import type { NextFunction, Request, Response } from 'express';
import type { Store } from '../store/interface';

export interface RequestLoggingOptions {
  store: Store;
}

/**
 * Request metadata captured during the request lifecycle.
 * Attached to the request object for collection at response finish.
 */
export interface RequestMetadata {
  requestId: string;
  startTime: number;
  port?: string;
  proxyId?: string;
  tenantId?: string;
  model?: string;
  provider?: string;
  routePath?: string;
  inputTokens?: number;
  outputTokens?: number;
  errorClass?: string;
  composeSteps?: number;
  fallbackUsed?: boolean;
  upstreamLatencyMs?: number;
}

declare module 'express-serve-static-core' {
  interface Request {
    logMetadata?: RequestMetadata;
  }
}

/**
 * Middleware that logs requests to the store on response finish.
 *
 * This middleware should be added early in the middleware chain to capture
 * the request start time. It uses the res.on('finish') event to log the
 * request after the response has been sent.
 *
 * Other middleware and route handlers can update req.logMetadata to add
 * additional context (model, provider, tokens, etc.).
 */
export function createRequestLoggingMiddleware(opts: RequestLoggingOptions) {
  const { store } = opts;

  return function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
    const requestState = req as unknown as Record<string, unknown>;
    const startTime = Date.now();

    // Initialize log metadata on the request
    req.logMetadata = {
      requestId: requestState.requestId as string,
      startTime,
      port: requestState.port as string | undefined,
      proxyId: requestState.proxyId as string | undefined,
      tenantId: req.tenant?.tenantId,
    };

    // Log request on response finish
    res.on('finish', () => {
      const metadata = req.logMetadata;
      if (!metadata) {
        return;
      }

      const latencyMs = Date.now() - startTime;

      store
        .logRequest({
          request_id: metadata.requestId,
          timestamp: startTime,
          method: req.method,
          path: req.path,
          provider: metadata.provider ?? 'unknown',
          model: metadata.model ?? 'untracked',
          status: res.statusCode,
          latency_ms: latencyMs,
          input_tokens: metadata.inputTokens ?? 0,
          output_tokens: metadata.outputTokens ?? 0,
          error_class: metadata.errorClass,
          source_ip: req.ip ?? req.socket.remoteAddress ?? 'unknown',
          port: metadata.port,
          proxy_id: metadata.proxyId,
          route_path: metadata.routePath,
          tenant_id: metadata.tenantId,
          compose_steps: metadata.composeSteps,
          fallback_used: metadata.fallbackUsed,
          upstream_latency_ms: metadata.upstreamLatencyMs,
        })
        .catch((error) => {
          console.error('Failed to log request to store:', error);
        });
    });

    next();
  };
}
