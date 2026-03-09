import { describe, it, expect, beforeEach } from 'vitest';
import { TenantManager, TenantCostTracker } from './tenant.js';
import type { TenantConfig } from './tenant.js';

const TENANT_A: TenantConfig = {
  id: 'tenant-a',
  name: 'Tenant A',
  apiKey: 'a'.repeat(32),
  rateLimitRpm: 100,
  allowedProviders: ['openai'],
  budgetUsd: 50,
  admin: false,
};

const TENANT_ADMIN: TenantConfig = {
  id: 'tenant-admin',
  name: 'Admin Tenant',
  apiKey: 'b'.repeat(32),
  admin: true,
};

describe('TenantManager', () => {
  let manager: TenantManager;

  beforeEach(() => {
    manager = new TenantManager({ tenants: [TENANT_A, TENANT_ADMIN] });
  });

  it('authenticates by API key', async () => {
    const ctx = await manager.authenticate('a'.repeat(32));
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe('tenant-a');
    expect(ctx!.authMethod).toBe('api-key');
    expect(ctx!.admin).toBe(false);
  });

  it('authenticates admin tenant', async () => {
    const ctx = await manager.authenticate('b'.repeat(32));
    expect(ctx).not.toBeNull();
    expect(ctx!.admin).toBe(true);
  });

  it('rejects invalid API key', async () => {
    const ctx = await manager.authenticate('x'.repeat(32));
    expect(ctx).toBeNull();
  });

  it('checks provider access', async () => {
    const ctx = await manager.authenticate('a'.repeat(32));
    expect(manager.canUseProvider(ctx!, 'openai')).toBe(true);
    expect(manager.canUseProvider(ctx!, 'anthropic')).toBe(false);
  });

  it('authenticates by JWT (HS256)', async () => {
    const jwt = await import('jsonwebtoken');
    const secret = 'test-secret-key-for-jwt-signing';
    const jwtManager = new TenantManager({
      jwt: { secret, algorithm: 'HS256' },
    });

    const token = jwt.default.sign(
      { sub: 'jwt-tenant', name: 'JWT Tenant', admin: true },
      secret,
      { algorithm: 'HS256' },
    );

    const ctx = await jwtManager.authenticate(token);
    expect(ctx).not.toBeNull();
    expect(ctx!.tenantId).toBe('jwt-tenant');
    expect(ctx!.authMethod).toBe('jwt');
    expect(ctx!.admin).toBe(true);
  });

  it('rejects invalid JWT', async () => {
    const jwtManager = new TenantManager({
      jwt: { secret: 'correct-secret', algorithm: 'HS256' },
    });
    const ctx = await jwtManager.authenticate('invalid.jwt.token');
    expect(ctx).toBeNull();
  });
});

describe('TenantCostTracker', () => {
  let tracker: TenantCostTracker;

  beforeEach(() => {
    tracker = new TenantCostTracker();
  });

  it('tracks costs per tenant', () => {
    tracker.record('t1', 10);
    tracker.record('t1', 5);
    tracker.record('t2', 20);

    expect(tracker.getCurrentMonthCost('t1')).toBe(15);
    expect(tracker.getCurrentMonthCost('t2')).toBe(20);
    expect(tracker.getCurrentMonthCost('t3')).toBe(0);
  });

  it('detects over budget', () => {
    tracker.record('t1', 50);
    expect(tracker.isOverBudget('t1', 50)).toBe(true);
    expect(tracker.isOverBudget('t1', 100)).toBe(false);
    expect(tracker.isOverBudget('t1', undefined)).toBe(false);
  });

  it('returns all costs', () => {
    tracker.record('t1', 10);
    tracker.record('t2', 20);
    const all = tracker.getAllCosts();
    expect(Object.keys(all)).toContain('t1');
    expect(Object.keys(all)).toContain('t2');
  });
});

describe('TenantManager budget enforcement', () => {
  it('detects over budget tenants', async () => {
    const manager = new TenantManager({ tenants: [TENANT_A] });
    manager.costs.record('tenant-a', 50);

    const ctx = await manager.authenticate('a'.repeat(32));
    expect(manager.isOverBudget(ctx!)).toBe(true);
  });
});
