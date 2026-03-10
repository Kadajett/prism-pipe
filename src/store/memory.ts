import type { LogFilter, LogQuery, RateLimitEntry, RequestLogEntry, Store, UsageAggregate, CostRecord } from './interface';

export class MemoryStore implements Store {
  private rateLimitMap = new Map<string, { entry: RateLimitEntry; expiresAt: number }>();
  private requestLogs: RequestLogEntry[] = [];
  private costRecords: CostRecord[] = [];

  async init(): Promise<void> {}
  async close(): Promise<void> {
    this.rateLimitMap.clear();
    this.requestLogs = [];
    this.costRecords = [];
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

  private filterLogs(filter: LogFilter | LogQuery): RequestLogEntry[] {
    const q = filter as LogQuery;
    return this.requestLogs.filter((log) => {
      if (filter.since && log.timestamp < filter.since) return false;
      if (filter.until && log.timestamp > filter.until) return false;
      if (filter.provider && log.provider !== filter.provider) return false;
      if (filter.status !== undefined && log.status !== filter.status) return false;
      if (q.model && log.model !== q.model) return false;
      if (q.errorClass && log.error_class !== q.errorClass) return false;
      if (q.search) {
        const term = q.search.toLowerCase();
        const matches = log.path.toLowerCase().includes(term) ||
          log.provider.toLowerCase().includes(term) ||
          log.model.toLowerCase().includes(term);
        if (!matches) return false;
      }
      return true;
    });
  }

  async queryLogs(filter: LogFilter | LogQuery): Promise<RequestLogEntry[]> {
    let results = this.filterLogs(filter);
    // Sort by timestamp descending
    results.sort((a, b) => b.timestamp - a.timestamp);
    const q = filter as LogQuery;
    if (q.offset) results = results.slice(q.offset);
    if (q.limit) results = results.slice(0, q.limit);
    return results;
  }

  async countLogs(filter: LogFilter | LogQuery): Promise<number> {
    return this.filterLogs(filter).length;
  }

  async aggregateUsage(filter: LogFilter | LogQuery): Promise<UsageAggregate> {
    const logs = this.filterLogs(filter);
    const totalRequests = logs.length;
    const totalInputTokens = logs.reduce((s, l) => s + l.input_tokens, 0);
    const totalOutputTokens = logs.reduce((s, l) => s + l.output_tokens, 0);
    const totalLatencyMs = logs.reduce((s, l) => s + l.latency_ms, 0);
    return {
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      totalLatencyMs,
      avgLatencyMs: totalRequests > 0 ? totalLatencyMs / totalRequests : 0,
    };
  }

  async deleteLogs(filter: LogFilter | LogQuery): Promise<number> {
    const before = this.requestLogs.length;
    const toKeep = this.requestLogs.filter((log) => {
      // Invert the filter logic — keep logs that DON'T match
      if (filter.since && log.timestamp < filter.since) return true;
      if (filter.until && log.timestamp > filter.until) return true;
      if (filter.provider && log.provider !== filter.provider) return true;
      if (filter.status !== undefined && log.status !== filter.status) return true;
      const q = filter as LogQuery;
      if (q.model && log.model !== q.model) return true;
      if (q.errorClass && log.error_class !== q.errorClass) return true;
      if (q.search) {
        const term = q.search.toLowerCase();
        const matches = log.path.toLowerCase().includes(term) ||
          log.provider.toLowerCase().includes(term) ||
          log.model.toLowerCase().includes(term);
        if (!matches) return true;
      }
      return false; // matches filter — delete it
    });
    this.requestLogs = toKeep;
    return before - toKeep.length;
  }

  async recordCost(record: CostRecord): Promise<void> {
    this.costRecords.push(record);
  }

  async queryCosts(filter: { tenantId?: string; month?: string }): Promise<CostRecord[]> {
    return this.costRecords.filter((r) => {
      if (filter.tenantId && r.tenantId !== filter.tenantId) return false;
      if (filter.month && r.month !== filter.month) return false;
      return true;
    });
  }
}
