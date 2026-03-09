/**
 * In-memory stats collector for admin /stats, /costs endpoints.
 */
import type { AdminStats, CostEntry, ProviderStats } from './types.js';

const START_TIME = Date.now();

interface RequestRecord {
  timestamp: number;
  latencyMs: number;
  provider: string;
  error: boolean;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  tenantId?: string;
  model?: string;
}

export class StatsCollector {
  private records: RequestRecord[] = [];
  private activeRequests = 0;
  private maxRecords = 100_000;

  recordRequest(record: RequestRecord): void {
    this.records.push(record);
    if (this.records.length > this.maxRecords) {
      // Drop oldest 10%
      this.records = this.records.slice(Math.floor(this.maxRecords * 0.1));
    }
  }

  incrementActive(): void {
    this.activeRequests++;
  }

  decrementActive(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
  }

  getStats(): AdminStats {
    const now = Date.now();
    const uptime = Math.floor((now - START_TIME) / 1000);
    const oneMinuteAgo = now - 60_000;
    const recentRecords = this.records.filter((r) => r.timestamp >= oneMinuteAgo);

    const totalLatency = this.records.reduce((sum, r) => sum + r.latencyMs, 0);

    // Per-provider stats
    const providerMap = new Map<string, RequestRecord[]>();
    for (const r of this.records) {
      const arr = providerMap.get(r.provider) ?? [];
      arr.push(r);
      providerMap.set(r.provider, arr);
    }

    const providerStats: Record<string, ProviderStats> = {};
    for (const [name, records] of providerMap) {
      const errors = records.filter((r) => r.error);
      const avgLatency = records.reduce((s, r) => s + r.latencyMs, 0) / (records.length || 1);
      const inputTokens = records.reduce((s, r) => s + r.inputTokens, 0);
      const outputTokens = records.reduce((s, r) => s + r.outputTokens, 0);
      const errorRate = errors.length / (records.length || 1);

      providerStats[name] = {
        name,
        status: errorRate > 0.5 ? 'down' : errorRate > 0.1 ? 'degraded' : 'healthy',
        requestsTotal: records.length,
        errorsTotal: errors.length,
        averageLatencyMs: Math.round(avgLatency),
        tokensUsed: { input: inputTokens, output: outputTokens },
      };
    }

    return {
      uptime,
      requestsTotal: this.records.length,
      requestsPerSecond: recentRecords.length / 60,
      averageLatencyMs: Math.round(totalLatency / (this.records.length || 1)),
      activeRequests: this.activeRequests,
      providerStats,
    };
  }

  getCosts(opts?: {
    from?: number;
    to?: number;
    groupBy?: 'tenant' | 'provider' | 'model';
  }): CostEntry[] {
    let filtered = this.records;
    if (opts?.from) filtered = filtered.filter((r) => r.timestamp >= opts.from!);
    if (opts?.to) filtered = filtered.filter((r) => r.timestamp <= opts.to!);

    return filtered.map((r) => ({
      tenantId: r.tenantId ?? 'default',
      provider: r.provider,
      model: r.model ?? 'unknown',
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      estimatedCostUsd: r.estimatedCostUsd,
      timestamp: r.timestamp,
    }));
  }

  getTenantCosts(tenantId: string): { totalCostUsd: number; periodStart: number } {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const tenantRecords = this.records.filter(
      (r) => r.tenantId === tenantId && r.timestamp >= thirtyDaysAgo,
    );
    const totalCostUsd = tenantRecords.reduce((s, r) => s + r.estimatedCostUsd, 0);
    return { totalCostUsd, periodStart: thirtyDaysAgo };
  }
}

/** Singleton stats collector */
export const statsCollector = new StatsCollector();
