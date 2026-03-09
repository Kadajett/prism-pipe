import type { RateLimitEntry, RequestLogEntry, LogFilter, Store } from './interface';

/**
 * In-memory store implementation for testing and edge runtime compatibility
 * Uses Maps for rate limit entries and request logs with TTL-based eviction
 */
export class MemoryStore implements Store {
  private rateLimitMap = new Map<string, { entry: RateLimitEntry; expiresAt: number }>();
  private requestLogs: RequestLogEntry[] = [];
  private cleanupTimer?: NodeJS.Timeout;

  async init(): Promise<void> {
    // Start periodic cleanup of expired rate limit entries
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.rateLimitMap.entries()) {
        if (value.expiresAt < now) {
          this.rateLimitMap.delete(key);
        }
      }

      // Also prune old request logs (older than 30 days by default)
      const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
      this.requestLogs = this.requestLogs.filter(
        (log) => log.timestamp > thirtyDaysAgo
      );
    }, 60000); // Run cleanup every minute
  }

  async close(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.rateLimitMap.clear();
    this.requestLogs = [];
  }

  async migrate(): Promise<void> {
    // No-op for memory store
  }

  async rateLimitGet(key: string): Promise<RateLimitEntry | null> {
    const item = this.rateLimitMap.get(key);
    if (!item) {
      return null;
    }

    // Check if expired
    if (item.expiresAt < Date.now()) {
      this.rateLimitMap.delete(key);
      return null;
    }

    return item.entry;
  }

  async rateLimitSet(
    key: string,
    entry: RateLimitEntry,
    ttlMs: number = 3600000 // 1 hour default
  ): Promise<void> {
    this.rateLimitMap.set(key, {
      entry,
      expiresAt: Date.now() + ttlMs,
    });
  }

  async logRequest(entry: RequestLogEntry): Promise<void> {
    this.requestLogs.push(entry);
  }

  async queryLogs(filter: LogFilter): Promise<RequestLogEntry[]> {
    return this.requestLogs.filter((log) => {
      if (filter.since && log.timestamp < filter.since) {
        return false;
      }
      if (filter.until && log.timestamp > filter.until) {
        return false;
      }
      if (filter.provider && log.provider !== filter.provider) {
        return false;
      }
      if (filter.status && log.status !== filter.status) {
        return false;
      }
      return true;
    });
  }
}
