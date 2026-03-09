/**
 * Rate limit entry for token bucket / sliding window state
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
  /**
   * Initialize the store (create tables, etc.)
   */
  init(): Promise<void>;

  /**
   * Close the store connection
   */
  close(): Promise<void>;

  /**
   * Run migrations
   */
  migrate(): Promise<void>;

  /**
   * Get rate limit entry
   */
  rateLimitGet(key: string): Promise<RateLimitEntry | null>;

  /**
   * Set rate limit entry with optional TTL
   */
  rateLimitSet(key: string, entry: RateLimitEntry, ttlMs?: number): Promise<void>;

  /**
   * Log a request
   */
  logRequest(entry: RequestLogEntry): Promise<void>;

  /**
   * Query request logs with filters
   */
  queryLogs(filter: LogFilter): Promise<RequestLogEntry[]>;
}
