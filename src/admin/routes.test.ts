import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import { StatsTracker, setupAdminRoutes } from './routes.js';
import type { ResolvedConfig } from '../core/types.js';

// Minimal test config
const TEST_CONFIG: ResolvedConfig = {
  port: 3000,
  logLevel: 'info',
  requestTimeout: 30000,
  providers: {
    openai: {
      name: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-test-key-1234567890abcdef',
    },
  },
  routes: [{ path: '/v1/chat/completions', providers: ['openai'] }],
};

describe('StatsTracker', () => {
  let stats: StatsTracker;

  beforeEach(() => {
    stats = new StatsTracker();
  });

  it('records requests and calculates stats', () => {
    stats.recordRequest('openai', 100, 'tenant-1');
    stats.recordRequest('openai', 200, 'tenant-1');
    stats.recordRequest('anthropic', 150, 'tenant-2');

    const s = stats.getStats();
    expect(s.requests.total).toBe(3);
    expect(s.requests.byProvider.openai).toBe(2);
    expect(s.requests.byProvider.anthropic).toBe(1);
    expect(s.requests.byTenant['tenant-1']).toBe(2);
    expect(s.latency.averageMs).toBe(150);
  });

  it('records tokens', () => {
    stats.recordTokens(100, 50);
    stats.recordTokens(200, 100);

    const s = stats.getStats();
    expect(s.tokens.input).toBe(300);
    expect(s.tokens.output).toBe(150);
    expect(s.tokens.total).toBe(450);
  });

  it('records errors', () => {
    stats.recordError();
    stats.recordError();
    expect(stats.getStats().requests.errors).toBe(2);
  });
});

describe('Admin Routes', () => {
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Mock admin auth — skip requireAdmin for testing
    app.use('/admin', (_req, _res, next) => {
      // Simulate admin tenant
      (_req as any).tenant = { admin: true, tenantId: 'admin' };
      next();
    });

    const stats = new StatsTracker();
    stats.recordRequest('openai', 100);

    setupAdminRoutes(app, { config: TEST_CONFIG, stats });
  });

  it('GET /admin/health returns provider status', async () => {
    const res = await makeRequest(app, '/admin/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.providers).toHaveLength(1);
    expect(res.body.providers[0].name).toBe('openai');
  });

  it('GET /admin/config returns redacted config', async () => {
    const res = await makeRequest(app, '/admin/config');
    expect(res.status).toBe(200);
    // API key should be redacted
    expect(res.body.providers.openai.apiKey).not.toBe('sk-test-key-1234567890abcdef');
    expect(res.body.providers.openai.apiKey).toContain('...');
  });

  it('GET /admin/stats returns request stats', async () => {
    const res = await makeRequest(app, '/admin/stats');
    expect(res.status).toBe(200);
    expect(res.body.requests.total).toBe(1);
  });

  it('GET /admin/providers lists providers', async () => {
    const res = await makeRequest(app, '/admin/providers');
    expect(res.status).toBe(200);
    expect(res.body.providers).toHaveLength(1);
  });

  it('POST /admin/cache/flush with no cache', async () => {
    const res = await makePost(app, '/admin/cache/flush');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no-op');
  });

  it('GET /admin/plugins with no registry', async () => {
    const res = await makeRequest(app, '/admin/plugins');
    expect(res.status).toBe(200);
    expect(res.body.plugins).toEqual([]);
  });
});

// Simple test helpers using Node's built-in fetch (or express test utilities)
async function makeRequest(app: ReturnType<typeof express>, path: string) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      fetch(`http://127.0.0.1:${addr.port}${path}`)
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch(() => {
          server.close();
          resolve({ status: 500, body: {} });
        });
    });
  });
}

async function makePost(app: ReturnType<typeof express>, path: string) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      fetch(`http://127.0.0.1:${addr.port}${path}`, { method: 'POST' })
        .then(async (res) => {
          const body = await res.json();
          server.close();
          resolve({ status: res.status, body });
        })
        .catch(() => {
          server.close();
          resolve({ status: 500, body: {} });
        });
    });
  });
}
