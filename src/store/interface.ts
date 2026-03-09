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
 * Store interface for rate limit and request logging
 */
export interface Store {
  init(): Promise<void>;
  close(): Promise<void>;
  migrate(): Promise<void>;
  rateLimitGet(key: string): Promise<RateLimitEntry | null>;
  rateLimitSet(key: string, entry: RateLimitEntry, ttlMs?: number): Promise<void>;
  logRequest(entry: RequestLogEntry): Promise<void>;
  queryLogs(filter: LogFilter): Promise<RequestLogEntry[]>;
}
