/**
<<<<<<< HEAD
 * Rate limit entry for token bucket / sliding window state
=======
 * Rate limit entry for token bucket state
>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
 */
export interface RateLimitEntry {
  key: string;
  tokens: number;
<<<<<<< HEAD
  lastRefill: number; // Unix timestamp in ms
  resetAt: number; // Unix timestamp in ms
=======
  lastRefill: number;
  resetAt: number;
>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
}

/**
 * Request log entry
 */
export interface RequestLogEntry {
  request_id: string;
<<<<<<< HEAD
  timestamp: number; // Unix timestamp in ms
=======
  timestamp: number;
>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
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
<<<<<<< HEAD
  since?: number; // Unix timestamp in ms
  until?: number; // Unix timestamp in ms
=======
  since?: number;
  until?: number;
>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
  provider?: string;
  status?: number;
}

/**
 * Store interface for rate limit and request logging
 */
export interface Store {
<<<<<<< HEAD
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
=======
  init(): Promise<void>;
  close(): Promise<void>;
  migrate(): Promise<void>;
  rateLimitGet(key: string): Promise<RateLimitEntry | null>;
  rateLimitSet(key: string, entry: RateLimitEntry, ttlMs?: number): Promise<void>;
  logRequest(entry: RequestLogEntry): Promise<void>;
>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
  queryLogs(filter: LogFilter): Promise<RequestLogEntry[]>;
}
