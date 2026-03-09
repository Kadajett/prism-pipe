/**
 * Admin API routes: /admin/health, /admin/config, /admin/stats, /admin/providers,
 * /admin/costs, /admin/cache/flush, /admin/plugins, /admin/config/reload
 */
import { Router, type Request, type Response } from 'express';
import type { ResolvedConfig } from '../core/types.js';
import type { ConfigWatcher } from './config-reload.js';
import type { StatsCollector } from './stats-collector.js';
import { requireAdmin } from './tenant-auth.js';

export interface AdminRouterOptions {
  config: ResolvedConfig;
  statsCollector: StatsCollector;
  configWatcher?: ConfigWatcher;
  version?: string;
}

const START_TIME = Date.now();

export function createAdminRouter(opts: AdminRouterOptions): Router {
  const router = Router();
  const { config, statsCollector, configWatcher, version = '0.1.0' } = opts;

  // All admin routes require admin auth
  router.use(requireAdmin);

  // ── /admin/health ──
  router.get('/admin/health', (_req: Request, res: Response) => {
    const providerStatuses = Object.entries(config.providers).map(([name, p]) => ({
      name,
      baseUrl: p.baseUrl.replace(/\/\/.*:.*@/, '//***:***@'), // redact creds in URL
      status: 'configured',
    }));

    res.json({
      status: 'healthy',
      uptime: Math.floor((Date.now() - START_TIME) / 1000),
      version,
      providers: providerStatuses,
    });
  });

  // ── /admin/config (redacted) ──
  router.get('/admin/config', (_req: Request, res: Response) => {
    const redacted = {
      port: config.port,
      logLevel: config.logLevel,
      requestTimeout: config.requestTimeout,
      providers: Object.fromEntries(
        Object.entries(config.providers).map(([name, p]) => [
          name,
          {
            name: p.name,
            baseUrl: p.baseUrl,
            format: p.format,
            models: p.models,
            defaultModel: p.defaultModel,
            apiKey: '***REDACTED***',
          },
        ]),
      ),
      routes: config.routes.map((r) => ({
        path: r.path,
        providers: r.providers,
        pipeline: r.pipeline,
      })),
    };
    res.json(redacted);
  });

  // ── /admin/stats ──
  router.get('/admin/stats', (_req: Request, res: Response) => {
    res.json(statsCollector.getStats());
  });

  // ── /admin/providers ──
  router.get('/admin/providers', (_req: Request, res: Response) => {
    const stats = statsCollector.getStats();
    const providers = Object.entries(config.providers).map(([name, p]) => ({
      name,
      baseUrl: p.baseUrl,
      format: p.format,
      models: p.models ? Object.keys(p.models) : [],
      defaultModel: p.defaultModel,
      stats: stats.providerStats[name] ?? null,
    }));
    res.json({ providers });
  });

  // ── /admin/costs ──
  router.get('/admin/costs', (req: Request, res: Response) => {
    const from = req.query.from ? Number(req.query.from) : undefined;
    const to = req.query.to ? Number(req.query.to) : undefined;
    const groupBy = req.query.groupBy as 'tenant' | 'provider' | 'model' | undefined;

    const costs = statsCollector.getCosts({ from, to, groupBy });

    if (groupBy) {
      const grouped: Record<string, { count: number; totalCostUsd: number; totalTokens: number }> =
        {};
      for (const c of costs) {
        const key =
          groupBy === 'tenant'
            ? c.tenantId
            : groupBy === 'provider'
              ? c.provider
              : c.model;
        if (!grouped[key]) grouped[key] = { count: 0, totalCostUsd: 0, totalTokens: 0 };
        grouped[key].count++;
        grouped[key].totalCostUsd += c.estimatedCostUsd;
        grouped[key].totalTokens += c.inputTokens + c.outputTokens;
      }
      res.json({ groupBy, data: grouped });
    } else {
      res.json({
        total: costs.length,
        totalCostUsd: costs.reduce((s, c) => s + c.estimatedCostUsd, 0),
        entries: costs.slice(-100), // Last 100 entries
      });
    }
  });

  // ── /admin/cache/flush ──
  router.post('/admin/cache/flush', (_req: Request, res: Response) => {
    // TODO: integrate with cache store when caching is implemented
    res.json({ status: 'ok', message: 'Cache flushed (no-op: caching not yet implemented)' });
  });

  // ── /admin/plugins ──
  router.get('/admin/plugins', (_req: Request, res: Response) => {
    // Pipeline steps act as plugins
    const plugins = config.routes.flatMap((r) =>
      (r.pipeline ?? []).map((step) => ({ name: step, route: r.path })),
    );
    res.json({ plugins });
  });

  // ── /admin/config/reload ──
  router.post('/admin/config/reload', (_req: Request, res: Response) => {
    if (!configWatcher) {
      res.status(400).json({ error: 'Config hot-reload is not enabled' });
      return;
    }
    const result = configWatcher.reload();
    res.json(result);
  });

  return router;
}
