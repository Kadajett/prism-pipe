import { describe, it, expect, beforeEach } from 'vitest';
import { TenantManager, TenantCostTracker } from './tenant';
import type { TenantConfig } from './tenant';
import { MemoryStore } from '../store/memory';

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
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
    manager = new TenantManager({ tenants: [TENANT_A, TENANT_ADMIN], store });
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
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
    tracker = new TenantCostTracker(store);
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

  it('persists costs to store', async () => {
    tracker.record('t1', 25);
    // Give the fire-and-forget operation time to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const recorded = await store.queryCosts({ tenantId: 't1' });
    expect(recorded.length).toBeGreaterThan(0);
    const totalCost = recorded.reduce((sum, r) => sum + r.costUsd, 0);
    expect(totalCost).toBe(25);
  });

  it('hydrates costs from store on initialization', async () => {
    // Manually add costs to the store
    await store.recordCost({ tenantId: 't1', month: '2024-01', costUsd: 10 });
    await store.recordCost({ tenantId: 't1', month: '2024-01', costUsd: 15 });
    await store.recordCost({ tenantId: 't2', month: '2024-01', costUsd: 20 });

    // Create a new tracker and hydrate it
    const newTracker = new TenantCostTracker(store);
    await newTracker.hydrate();

    expect(newTracker.getAllCosts()['t1']['2024-01']).toBe(25);
    expect(newTracker.getAllCosts()['t2']['2024-01']).toBe(20);
  });
});

describe('TenantManager budget enforcement', () => {
  it('detects over budget tenants', async () => {
    const store = new MemoryStore();
    const manager = new TenantManager({ tenants: [TENANT_A], store });
    manager.costs.record('tenant-a', 50);

    const ctx = await manager.authenticate('a'.repeat(32));
    expect(manager.isOverBudget(ctx!)).toBe(true);
  });
});
