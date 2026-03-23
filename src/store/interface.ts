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
  /** Filter by port */
  port?: string;
  /** Filter by proxy instance id */
  proxy_id?: string;
  /** Filter by matched route path */
  route_path?: string;
  /** Filter by tenant id */
  tenant_id?: string;
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
 * Model-scoped usage ledger entry.
 */
export interface UsageLogEntry {
  request_id: string;
  timestamp: number;
  model: string;
  provider?: string;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  port?: string;
  proxy_id?: string;
  route_path?: string;
  tenant_id?: string;
}

/**
 * Query filter for usage ledger entries.
 */
export interface UsageLogQuery {
  since?: number;
  until?: number;
  model?: string;
  provider?: string;
  port?: string;
  proxy_id?: string;
  route_path?: string;
  tenant_id?: string;
  request_id?: string;
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
 * Circuit breaker state record for persistence.
 */
export interface CircuitBreakerStateRecord {
  provider: string;
  state: 'closed' | 'open' | 'half-open';
  consecutiveFailures: number;
  openedAt?: number; // Unix timestamp in ms
  updatedAt: number; // Unix timestamp in ms
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
  /** Record model-scoped usage ledger entries */
  recordUsage(entries: UsageLogEntry[]): Promise<void>;
  /** Query model-scoped usage ledger entries */
  queryUsage(filter: UsageLogQuery): Promise<UsageLogEntry[]>;
  /** Delete logs matching a filter (for log rotation/cleanup) */
  deleteLogs(filter: LogFilter | LogQuery): Promise<number>;
  /** Record a cost entry for a tenant */
  recordCost(record: CostRecord): Promise<void>;
  /** Query cost records */
  queryCosts(filter: { tenantId?: string; month?: string }): Promise<CostRecord[]>;
  /** Get circuit breaker state for a provider */
  circuitBreakerGet(provider: string): Promise<CircuitBreakerStateRecord | null>;
  /** Set circuit breaker state for a provider */
  circuitBreakerSet(record: CircuitBreakerStateRecord): Promise<void>;
}
