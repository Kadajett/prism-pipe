/**
 * Core types for Prism Pipe
 */

export interface PrismConfig {
  server: {
    port: number;
    host: string;
    cors: {
      enabled: boolean;
      origins: string[];
    };
    trustProxy: boolean;
    shutdownTimeout: number; // milliseconds
  };
  providers: ProviderConfig[];
  responseHeaders: {
    verbosity: 'minimal' | 'standard' | 'verbose';
  };
}

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey?: string;
  models: string[];
  enabled: boolean;
}

export interface PipelineContext {
  requestId: string;
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  query: Record<string, string | string[] | undefined>;
  startTime: number;
  metadata: Record<string, unknown>;
}

export interface PrismError extends Error {
  type: string;
  code: string;
  statusCode: number;
  retryAfter?: number;
  details?: Record<string, unknown>;
}

export interface ErrorResponse {
  error: {
    type: string;
    message: string;
    code: string;
    request_id: string;
    retry_after?: number;
  };
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  version: string;
}

export interface ReadyResponse extends HealthResponse {
  providers: {
    name: string;
    status: 'ready' | 'unavailable';
  }[];
}
