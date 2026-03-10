/**
 * Rate limit entry for token bucket state
 */
export interface RateLimitEntry {
  key: string;
  tokens: number;
  lastRefill: number; // Unix timestamp in ms
  resetAt: number; // Unix timestamp in ms
}

/**
 * Request log entry
 */
export interface RequestLogEntry {
  request_id: string;
  timestamp: number; // Unix timestamp in ms
  method: string;
  path: string;
  provider: string;
  model: string;
  status: number;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  error_class?: string;
  source_ip: string;
  /** Which port handled the request (for multi-port scoping) */
  port?: string;
  /** Which proxy instance handled the request */
  proxy_id?: string;
  /** The matched route pattern (vs path which is the raw URL) */
  route_path?: string;
  /** Tenant ID that made the request */
  tenant_id?: string;
  /** Number of compose steps involved */
  compose_steps?: number;
  /** Whether a fallback provider was used */
  fallback_used?: boolean;
  /** Provider response time separate from total latency */
  upstream_latency_ms?: number;
}

/**
 * Filter for querying request logs
 */
export interface LogFilter {
  since?: number; // Unix timestamp in ms
  until?: number; // Unix timestamp in ms
  provider?: string;
  status?: number;
}

/**
 * Extended query for request logs with search and pagination.
 */
export interface LogQuery extends LogFilter {
  /** Text search across path, provider, and model fields */
  search?: string;
  /** Filter by model name */
  model?: string;
  /** Filter by error classification */
  errorClass?: string;
  /** Max results to return (default: 100) */
  limit?: number;
  /** Offset for pagination (default: 0) */
  offset?: number;
}

/**
 * Aggregated usage data from log entries.
 */
export interface UsageAggregate {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
}

/**
 * Cost record for tenant cost persistence.
 */
export interface CostRecord {
  tenantId: string;
  month: string; // YYYY-MM
  costUsd: number;
  provider?: string;
  model?: string;
}

/**
 * Store interface for rate limit and request logging
 */
export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;
  migrate(): Promise<void>;
  rateLimitGet(key: string): Promise<RateLimitEntry | null>;
  rateLimitSet(key: string, entry: RateLimitEntry, ttlMs?: number): Promise<void>;
  logRequest(entry: RequestLogEntry): Promise<void>;
  queryLogs(filter: LogFilter | LogQuery): Promise<RequestLogEntry[]>;
  /** Count logs matching a filter (for pagination metadata) */
  countLogs(filter: LogFilter | LogQuery): Promise<number>;
  /** Aggregate token usage across matching logs */
  aggregateUsage(filter: LogFilter | LogQuery): Promise<UsageAggregate>;
  /** Delete logs matching a filter (for log rotation/cleanup) */
  deleteLogs(filter: LogFilter | LogQuery): Promise<number>;
  /** Record a cost entry for a tenant */
  recordCost(record: CostRecord): Promise<void>;
  /** Query cost records */
  queryCosts(filter: { tenantId?: string; month?: string }): Promise<CostRecord[]>;
}
