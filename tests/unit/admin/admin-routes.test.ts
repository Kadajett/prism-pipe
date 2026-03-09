import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import { createAdminRouter } from '../../../src/admin/routes.js';
import { StatsCollector } from '../../../src/admin/stats-collector.js';
import type { ResolvedConfig } from '../../../src/core/types.js';

// Minimal supertest-like helper using Node fetch
async function request(app: express.Express, method: string, path: string) {
  // We'll use a lightweight approach — mount and call directly
  return new Promise<{ status: number; body: any }>((resolve) => {
    const req = {
      method: method.toUpperCase(),
      path,
      url: path,
      headers: {},
      query: {},
      tenantContext: { tenantId: 'admin', name: 'Admin', permissions: { admin: true, chat: true, models: true } },
    } as any;

    const res = {
      statusCode: 200,
      _headers: {} as Record<string, string>,
      _body: null as any,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        this._body = data;
        resolve({ status: this.statusCode, body: data });
        return this;
      },
      setHeader(k: string, v: string) {
        this._headers[k] = v;
        return this;
      },
    } as any;

    // Find the matching route handler in the router
    const router = createAdminRouter({
      config: testConfig,
      statsCollector: new StatsCollector(),
    });

    // Use Express's handle method
    const handler = router as any;
    handler.handle(req, res, (err: any) => {
      if (err) resolve({ status: 500, body: { error: err.message } });
      else resolve({ status: 404, body: null });
    });
  });
}

const testConfig: ResolvedConfig = {
  port: 3000,
  logLevel: 'info',
  requestTimeout: 120_000,
  providers: {
    openai: { name: 'openai', baseUrl: 'https://api.openai.com', apiKey: 'sk-test' },
  },
  routes: [{ path: '/v1/chat/completions', providers: ['openai'], pipeline: ['log-request'] }],
};

describe('Admin Routes', () => {
  it('/admin/health returns health info', async () => {
    const result = await request(express(), 'GET', '/admin/health');
    expect(result.body.status).toBe('healthy');
    expect(result.body.providers).toBeDefined();
  });

  it('/admin/config redacts API keys', async () => {
    const result = await request(express(), 'GET', '/admin/config');
    expect(result.body.providers.openai.apiKey).toBe('***REDACTED***');
    expect(result.body.port).toBe(3000);
  });

  it('/admin/stats returns stats object', async () => {
    const result = await request(express(), 'GET', '/admin/stats');
    expect(result.body.requestsTotal).toBeDefined();
    expect(result.body.uptime).toBeDefined();
  });

  it('/admin/providers lists configured providers', async () => {
    const result = await request(express(), 'GET', '/admin/providers');
    expect(result.body.providers).toHaveLength(1);
    expect(result.body.providers[0].name).toBe('openai');
  });

  it('/admin/costs returns cost data', async () => {
    const result = await request(express(), 'GET', '/admin/costs');
    expect(result.body.total).toBeDefined();
    expect(result.body.totalCostUsd).toBeDefined();
  });

  it('/admin/plugins lists pipeline steps', async () => {
    const result = await request(express(), 'GET', '/admin/plugins');
    expect(result.body.plugins).toBeDefined();
    expect(result.body.plugins[0].name).toBe('log-request');
  });

  it('rejects non-admin', async () => {
    const router = createAdminRouter({
      config: testConfig,
      statsCollector: new StatsCollector(),
    });

    const result = await new Promise<{ status: number; body: any }>((resolve) => {
      const req = {
        method: 'GET',
        path: '/admin/health',
        url: '/admin/health',
        headers: {},
        query: {},
        tenantContext: { tenantId: 't1', name: 'User', permissions: { admin: false, chat: true, models: true } },
      } as any;
      const res = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json(data: any) { resolve({ status: this.statusCode, body: data }); return this; },
      } as any;

      (router as any).handle(req, res, () => resolve({ status: 404, body: null }));
    });

    expect(result.status).toBe(403);
  });
});
