/**
 * Multi-tenant authentication: API key management, JWT validation, OAuth2 client credentials.
 * Each tenant (API key) has per-key rate limits, allowed providers, and budget.
 */

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Store } from '../store/interface';

// ─── Types ───

export interface TenantConfig {
  /** Unique tenant identifier */
  id: string;
  /** Display name */
  name: string;
  /** API key for this tenant */
  apiKey: string;
  /** Per-tenant rate limit (requests per minute). Undefined = use global. */
  rateLimitRpm?: number;
  /** Allowed provider names. Empty/undefined = all providers. */
  allowedProviders?: string[];
  /** Monthly budget in USD. Undefined = unlimited. */
  budgetUsd?: number;
  /** Admin role — can access /admin endpoints */
  admin?: boolean;
}

export interface JwtConfig {
  /** HMAC secret (HS256) or RSA/EC public key (RS256/ES256) */
  secret: string;
  /** Algorithm. Default: HS256 */
  algorithm?: jwt.Algorithm;
  /** Expected issuer */
  issuer?: string;
  /** Expected audience */
  audience?: string;
}

export interface OAuth2Config {
  /** Token introspection endpoint */
  introspectionUrl?: string;
  /** Client ID for introspection auth */
  clientId?: string;
  /** Client secret for introspection auth */
  clientSecret?: string;
  /** JWKS URI for local JWT validation */
  jwksUri?: string;
}

export interface TenantContext {
  tenantId: string;
  tenantName: string;
  admin: boolean;
  allowedProviders?: string[];
  rateLimitRpm?: number;
  budgetUsd?: number;
  authMethod: 'api-key' | 'jwt' | 'oauth2';
}

// ─── Cost Tracking ───

export class TenantCostTracker {
  /** tenantId → { month → costUsd } */
  private costs = new Map<string, Map<string, number>>();
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  private monthKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Initialize the tracker by hydrating in-memory costs from the store.
   * Call this after the store is initialized.
   */
  async hydrate(): Promise<void> {
    const records = await this.store.queryCosts({});
    for (const record of records) {
      let tenantCosts = this.costs.get(record.tenantId);
      if (!tenantCosts) {
        tenantCosts = new Map();
        this.costs.set(record.tenantId, tenantCosts);
      }
      tenantCosts.set(record.month, (tenantCosts.get(record.month) ?? 0) + record.costUsd);
    }
  }

  record(tenantId: string, costUsd: number): void {
    const month = this.monthKey();
    let tenantCosts = this.costs.get(tenantId);
    if (!tenantCosts) {
      tenantCosts = new Map();
      this.costs.set(tenantId, tenantCosts);
    }
    tenantCosts.set(month, (tenantCosts.get(month) ?? 0) + costUsd);

    // Persist to store (fire and forget to avoid blocking)
    this.store.recordCost({ tenantId, month, costUsd }).catch((err) => {
      console.error(`Failed to record cost for tenant ${tenantId}:`, err);
    });
  }

  getCurrentMonthCost(tenantId: string): number {
    return this.costs.get(tenantId)?.get(this.monthKey()) ?? 0;
  }

  getCosts(tenantId: string): Record<string, number> {
    const tenantCosts = this.costs.get(tenantId);
    if (!tenantCosts) return {};
    return Object.fromEntries(tenantCosts);
  }

  getAllCosts(): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    for (const [tenantId, months] of this.costs) {
      result[tenantId] = Object.fromEntries(months);
    }
    return result;
  }

  isOverBudget(tenantId: string, budgetUsd?: number): boolean {
    if (budgetUsd === undefined) return false;
    return this.getCurrentMonthCost(tenantId) >= budgetUsd;
  }
}

// ─── Tenant Manager ───

export class TenantManager {
  private tenants = new Map<string, TenantConfig>();
  /** apiKey → tenantId for fast lookup */
  private keyIndex = new Map<string, string>();
  private jwtConfig?: JwtConfig;
  private oauth2Config?: OAuth2Config;
  readonly costs: TenantCostTracker;

  constructor(opts?: { tenants?: TenantConfig[]; jwt?: JwtConfig; oauth2?: OAuth2Config; store?: Store }) {
    this.costs = new TenantCostTracker(opts?.store!);
    if (opts?.tenants) {
      for (const t of opts.tenants) this.addTenant(t);
    }
    this.jwtConfig = opts?.jwt;
    this.oauth2Config = opts?.oauth2;
  }

  addTenant(tenant: TenantConfig): void {
    this.tenants.set(tenant.id, tenant);
    this.keyIndex.set(tenant.apiKey, tenant.id);
  }

  removeTenant(tenantId: string): void {
    const tenant = this.tenants.get(tenantId);
    if (tenant) {
      this.keyIndex.delete(tenant.apiKey);
      this.tenants.delete(tenantId);
    }
  }

  getTenant(tenantId: string): TenantConfig | undefined {
    return this.tenants.get(tenantId);
  }

  allTenants(): TenantConfig[] {
    return [...this.tenants.values()];
  }

  /**
   * Authenticate a request. Tries API key first, then JWT.
   * Returns tenant context or null if unauthorized.
   */
  async authenticate(token: string): Promise<TenantContext | null> {
    // Try API key
    const byKey = this.authenticateByApiKey(token);
    if (byKey) return byKey;

    // Try JWT
    const byJwt = this.authenticateByJwt(token);
    if (byJwt) return byJwt;

    return null;
  }

  private authenticateByApiKey(token: string): TenantContext | null {
    for (const [apiKey, tenantId] of this.keyIndex) {
      if (timingSafeCompare(token, apiKey)) {
        const tenant = this.tenants.get(tenantId)!;
        return {
          tenantId: tenant.id,
          tenantName: tenant.name,
          admin: tenant.admin ?? false,
          allowedProviders: tenant.allowedProviders,
          rateLimitRpm: tenant.rateLimitRpm,
          budgetUsd: tenant.budgetUsd,
          authMethod: 'api-key',
        };
      }
    }
    return null;
  }

  private authenticateByJwt(token: string): TenantContext | null {
    if (!this.jwtConfig) return null;

    try {
      const decoded = jwt.verify(token, this.jwtConfig.secret, {
        algorithms: [this.jwtConfig.algorithm ?? 'HS256'],
        issuer: this.jwtConfig.issuer,
        audience: this.jwtConfig.audience,
      }) as Record<string, unknown>;

      return {
        tenantId: String(decoded.sub ?? decoded.client_id ?? 'jwt-user'),
        tenantName: String(decoded.name ?? decoded.sub ?? 'JWT User'),
        admin: decoded.admin === true || (decoded.role === 'admin'),
        allowedProviders: decoded.providers as string[] | undefined,
        rateLimitRpm: decoded.rate_limit as number | undefined,
        budgetUsd: decoded.budget as number | undefined,
        authMethod: 'jwt',
      };
    } catch {
      return null;
    }
  }

  /** Check if tenant can use the given provider */
  canUseProvider(ctx: TenantContext, provider: string): boolean {
    if (!ctx.allowedProviders || ctx.allowedProviders.length === 0) return true;
    return ctx.allowedProviders.includes(provider);
  }

  /** Check if tenant is over budget */
  isOverBudget(ctx: TenantContext): boolean {
    return this.costs.isOverBudget(ctx.tenantId, ctx.budgetUsd);
  }

  /** Update config (for hot-reload) */
  updateConfig(opts: { tenants?: TenantConfig[]; jwt?: JwtConfig; oauth2?: OAuth2Config }): void {
    if (opts.tenants) {
      this.tenants.clear();
      this.keyIndex.clear();
      for (const t of opts.tenants) this.addTenant(t);
    }
    if (opts.jwt !== undefined) this.jwtConfig = opts.jwt;
    if (opts.oauth2 !== undefined) this.oauth2Config = opts.oauth2;
  }
}

// ─── Helpers ───

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    const buf = Buffer.from(a);
    crypto.timingSafeEqual(buf, buf);
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
