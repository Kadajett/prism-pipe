/**
 * Admin API routes: health, config, stats, providers, costs, cache flush, plugins.
 */

import type { Express, Request, Response } from 'express';
import type { TenantManager } from '../auth/tenant.js';
import { requireAdmin } from '../auth/middleware.js';
import type { CircuitBreakerRegistry } from '../fallback/circuit-breaker.js';
import type { PluginRegistry } from '../plugin/registry.js';
import type { ResolvedConfig } from '../core/types.js';

// ─── Stats Tracker ───

export class StatsTracker {
  private requestCount = 0;
  private totalLatencyMs = 0;
  private tokenUsage = { input: 0, output: 0 };
  private requestsByProvider = new Map<string, number>();
  private requestsByTenant = new Map<string, number>();
  private errorCount = 0;
  private readonly startTime = Date.now();

  recordRequest(provider: string, latencyMs: number, tenantId?: string): void {
    this.requestCount++;
    this.totalLatencyMs += latencyMs;
    this.requestsByProvider.set(provider, (this.requestsByProvider.get(provider) ?? 0) + 1);
    if (tenantId) {
      this.requestsByTenant.set(tenantId, (this.requestsByTenant.get(tenantId) ?? 0) + 1);
    }
  }

  recordTokens(input: number, output: number): void {
    this.tokenUsage.input += input;
    this.tokenUsage.output += output;
  }

  recordError(): void {
    this.errorCount++;
  }

  getStats() {
    const uptimeMs = Date.now() - this.startTime;
    const uptimeSec = uptimeMs / 1000;
    return {
      uptime: { ms: uptimeMs, human: formatUptime(uptimeMs) },
      requests: {
        total: this.requestCount,
        perSecond: uptimeSec > 0 ? +(this.requestCount / uptimeSec).toFixed(2) : 0,
        errors: this.errorCount,
        byProvider: Object.fromEntries(this.requestsByProvider),
        byTenant: Object.fromEntries(this.requestsByTenant),
      },
      latency: {
        averageMs: this.requestCount > 0 ? Math.round(this.totalLatencyMs / this.requestCount) : 0,
      },
      tokens: {
        input: this.tokenUsage.input,
        output: this.tokenUsage.output,
        total: this.tokenUsage.input + this.tokenUsage.output,
      },
    };
  }
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h ${m % 60}m`;
  if (h > 0) return `${h}h ${m % 60}m ${s % 60}s`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ─── Redact sensitive config values ───

function redactConfig(config: ResolvedConfig): Record<string, unknown> {
  const redacted = JSON.parse(JSON.stringify(config));
  // Redact API keys in providers
  if (redacted.providers) {
    for (const [, provider] of Object.entries(redacted.providers as Record<string, Record<string, unknown>>)) {
      if (provider.apiKey) {
        const key = String(provider.apiKey);
        provider.apiKey = key.length > 8 ? `${key.slice(0, 4)}...${key.slice(-4)}` : '***';
      }
    }
  }
  return redacted;
}

// ─── Setup Admin Routes ───

export interface AdminRouteOptions {
  config: ResolvedConfig;
  stats: StatsTracker;
  tenantManager?: TenantManager;
  circuitBreakers?: CircuitBreakerRegistry;
  pluginRegistry?: PluginRegistry;
  /** Callback to flush any caches */
  onCacheFlush?: () => Promise<void>;
  /** Getter for current live config (for hot-reload) */
  getConfig?: () => ResolvedConfig;
}

export function setupAdminRoutes(app: Express, opts: AdminRouteOptions): void {
  const { stats, tenantManager, circuitBreakers, pluginRegistry, onCacheFlush } = opts;
  const getConfig = opts.getConfig ?? (() => opts.config);

  // All admin routes require admin auth
  app.use('/admin', requireAdmin);

  // GET /admin/health — provider status + circuit breakers
  app.get('/admin/health', (_req: Request, res: Response) => {
    const config = getConfig();
    const allBreakers = circuitBreakers?.all();
    const providers = Object.entries(config.providers).map(([name, p]) => {
      const cb = allBreakers?.get(name);
      return {
        name,
        baseUrl: p.baseUrl,
        circuitBreaker: cb ? cb.getState() : 'n/a',
      };
    });

    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      providers,
    });
  });

  // GET /admin/config — redacted config
  app.get('/admin/config', (_req: Request, res: Response) => {
    res.json(redactConfig(getConfig()));
  });

  // GET /admin/stats — request/latency/token stats
  app.get('/admin/stats', (_req: Request, res: Response) => {
    res.json(stats.getStats());
  });

  // GET /admin/providers — provider list with status
  app.get('/admin/providers', (_req: Request, res: Response) => {
    const config = getConfig();
    const breakers = circuitBreakers?.all();
    const providers = Object.entries(config.providers).map(([name, p]) => {
      const cb = breakers?.get(name);
      return {
        name,
        baseUrl: p.baseUrl,
        format: p.format,
        models: p.models ? Object.keys(p.models) : [],
        defaultModel: p.defaultModel,
        circuitBreaker: cb ? cb.getState() : 'n/a',
      };
    });
    res.json({ providers });
  });

  // GET /admin/costs — per-tenant cost tracking
  app.get('/admin/costs', (req: Request, res: Response) => {
    if (!tenantManager) {
      res.json({ costs: {}, message: 'Multi-tenant auth not configured' });
      return;
    }

    const tenantId = req.query.tenant as string | undefined;
    if (tenantId) {
      res.json({
        tenantId,
        costs: tenantManager.costs.getCosts(tenantId),
        currentMonth: tenantManager.costs.getCurrentMonthCost(tenantId),
      });
    } else {
      res.json({ costs: tenantManager.costs.getAllCosts() });
    }
  });

  // POST /admin/cache/flush — flush caches
  app.post('/admin/cache/flush', async (_req: Request, res: Response) => {
    if (onCacheFlush) {
      await onCacheFlush();
      res.json({ status: 'flushed' });
    } else {
      res.json({ status: 'no-op', message: 'No cache configured' });
    }
  });

  // GET /admin/plugins — loaded plugins
  app.get('/admin/plugins', (_req: Request, res: Response) => {
    if (!pluginRegistry) {
      res.json({ plugins: [], message: 'Plugin system not loaded' });
      return;
    }
    const plugins = pluginRegistry.allPlugins().map((p) => ({
      name: p.name,
      version: p.version,
    }));
    res.json({ plugins, summary: pluginRegistry.summary() });
  });
}
