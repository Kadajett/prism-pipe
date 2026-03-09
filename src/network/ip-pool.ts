/**
 * Multi-IP egress pool: manages available egress IPs with selection strategies,
 * per-provider assignment, and health tracking.
 */

export interface IpEntry {
  address: string;
  weight?: number;
  /** Restrict this IP to specific providers */
  providers?: string[];
}

export interface ProxyEntry {
  url: string;
  /** Restrict this proxy to specific providers */
  providers?: string[];
}

export type SelectionStrategy = 'round-robin' | 'random' | 'least-recently-used' | 'weighted-round-robin';

export interface IpPoolConfig {
  ips?: IpEntry[];
  proxies?: ProxyEntry[];
  strategy?: SelectionStrategy;
}

interface IpState {
  entry: IpEntry;
  lastUsedAt: number;
  rateLimited: boolean;
  rateLimitedUntil: number;
  usageCount: number;
}

/**
 * Manages a pool of egress IPs with configurable selection strategies.
 */
export class IpPool {
  private readonly ips: IpState[];
  private readonly proxies: ProxyEntry[];
  private readonly strategy: SelectionStrategy;
  private roundRobinIndex = 0;
  private weightedIndex = 0;
  private weightedCounter = 0;

  constructor(config: IpPoolConfig = {}) {
    this.ips = (config.ips ?? []).map((entry) => ({
      entry,
      lastUsedAt: 0,
      rateLimited: false,
      rateLimitedUntil: 0,
      usageCount: 0,
    }));
    this.proxies = config.proxies ?? [];
    this.strategy = config.strategy ?? 'round-robin';
  }

  /** Total number of IPs in the pool */
  get size(): number {
    return this.ips.length;
  }

  /**
   * Select an egress IP for the given provider.
   * Returns undefined if no IPs are configured or available.
   */
  selectIp(provider?: string): IpEntry | undefined {
    const candidates = this.getCandidates(provider);
    if (candidates.length === 0) return undefined;

    const now = Date.now();
    // Clear expired rate limits
    for (const c of candidates) {
      if (c.rateLimited && now >= c.rateLimitedUntil) {
        c.rateLimited = false;
      }
    }

    const healthy = candidates.filter((c) => !c.rateLimited);
    const pool = healthy.length > 0 ? healthy : candidates; // fallback to all if all rate-limited

    const selected = this.selectByStrategy(pool);
    if (!selected) return undefined;

    selected.lastUsedAt = now;
    selected.usageCount++;
    return selected.entry;
  }

  /**
   * Get proxy URL for a given provider, if configured.
   */
  selectProxy(provider?: string): string | undefined {
    if (this.proxies.length === 0) return undefined;
    const candidates = provider
      ? this.proxies.filter((p) => !p.providers || p.providers.includes(provider))
      : this.proxies;
    if (candidates.length === 0) return undefined;
    // Simple round-robin for proxies
    return candidates[Date.now() % candidates.length]?.url;
  }

  /**
   * Mark an IP as rate-limited. It will be deprioritized for `durationMs`.
   */
  markRateLimited(address: string, durationMs = 60_000): void {
    const state = this.ips.find((s) => s.entry.address === address);
    if (state) {
      state.rateLimited = true;
      state.rateLimitedUntil = Date.now() + durationMs;
    }
  }

  /**
   * Clear rate-limit status for an IP.
   */
  clearRateLimit(address: string): void {
    const state = this.ips.find((s) => s.entry.address === address);
    if (state) {
      state.rateLimited = false;
      state.rateLimitedUntil = 0;
    }
  }

  /** Get all IP entries (for inspection/testing) */
  getAll(): ReadonlyArray<IpEntry> {
    return this.ips.map((s) => s.entry);
  }

  private getCandidates(provider?: string): IpState[] {
    if (!provider) return [...this.ips];
    return this.ips.filter(
      (s) => !s.entry.providers || s.entry.providers.length === 0 || s.entry.providers.includes(provider)
    );
  }

  private selectByStrategy(pool: IpState[]): IpState | undefined {
    if (pool.length === 0) return undefined;
    if (pool.length === 1) return pool[0];

    switch (this.strategy) {
      case 'round-robin': {
        const idx = this.roundRobinIndex % pool.length;
        this.roundRobinIndex = (this.roundRobinIndex + 1) % pool.length;
        return pool[idx];
      }

      case 'random':
        return pool[Math.floor(Math.random() * pool.length)];

      case 'least-recently-used': {
        let oldest = pool[0]!;
        for (let i = 1; i < pool.length; i++) {
          if (pool[i]!.lastUsedAt < oldest.lastUsedAt) {
            oldest = pool[i]!;
          }
        }
        return oldest;
      }

      case 'weighted-round-robin': {
        // Weighted round-robin: each IP gets turns proportional to its weight
        const totalWeight = pool.reduce((sum, s) => sum + (s.entry.weight ?? 1), 0);
        if (totalWeight === 0) return pool[0];

        let remaining = this.weightedCounter % totalWeight;
        for (const s of pool) {
          const w = s.entry.weight ?? 1;
          if (remaining < w) {
            this.weightedCounter++;
            return s;
          }
          remaining -= w;
        }
        this.weightedCounter++;
        return pool[0];
      }

      default:
        return pool[0];
    }
  }
}
