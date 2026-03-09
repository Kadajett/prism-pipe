import type { LogFilter, RateLimitEntry, RequestLogEntry, Store } from './interface.js';

export class MemoryStore implements Store {
  private rateLimitMap = new Map<string, { entry: RateLimitEntry; expiresAt: number }>();
  private requestLogs: RequestLogEntry[] = [];

  async init(): Promise<void> {}
  async close(): Promise<void> {
    this.rateLimitMap.clear();
    this.requestLogs = [];
  }
  async migrate(): Promise<void> {}

  async rateLimitGet(key: string): Promise<RateLimitEntry | null> {
    const item = this.rateLimitMap.get(key);
    if (!item || item.expiresAt < Date.now()) {
      this.rateLimitMap.delete(key);
      return null;
    }
    return item.entry;
  }

  async rateLimitSet(key: string, entry: RateLimitEntry, ttlMs = 3600000): Promise<void> {
    this.rateLimitMap.set(key, { entry, expiresAt: Date.now() + ttlMs });
  }

  async logRequest(entry: RequestLogEntry): Promise<void> {
    this.requestLogs.push(entry);
  }

  async queryLogs(filter: LogFilter): Promise<RequestLogEntry[]> {
    return this.requestLogs.filter((log) => {
      if (filter.since && log.timestamp < filter.since) return false;
      if (filter.until && log.timestamp > filter.until) return false;
      if (filter.provider && log.provider !== filter.provider) return false;
      if (filter.status !== undefined && log.status !== filter.status) return false;
      return true;
    });
  }
}
