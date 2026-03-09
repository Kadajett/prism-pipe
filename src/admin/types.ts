/**
 * Admin API types — tenant auth, admin endpoints, config hot-reload.
 */

// ── Tenant / API Key ──

export interface TenantKey {
  id: string;
  key: string;
  name: string;
  permissions: TenantPermissions;
  rateLimit?: { rpm: number };
  allowedProviders?: string[];
  budget?: { maxCostUsd: number; periodDays: number };
  createdAt: number;
}

export interface TenantPermissions {
  admin: boolean;
  chat: boolean;
  models: boolean;
  providers?: string[];
}

export interface TenantContext {
  tenantId: string;
  name: string;
  permissions: TenantPermissions;
  rateLimit?: { rpm: number };
  allowedProviders?: string[];
  budget?: { maxCostUsd: number; periodDays: number };
}

// ── JWT ──

export interface JwtConfig {
  enabled: boolean;
  algorithm: 'RS256' | 'HS256';
  secret?: string; // For HS256
  publicKey?: string; // For RS256
  issuer?: string;
  audience?: string;
}

export interface JwtPayload {
  sub: string;
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  tenantId?: string;
  role?: 'admin' | 'user';
  permissions?: TenantPermissions;
}

// ── Admin Stats ──

export interface AdminStats {
  uptime: number;
  requestsTotal: number;
  requestsPerSecond: number;
  averageLatencyMs: number;
  activeRequests: number;
  providerStats: Record<string, ProviderStats>;
}

export interface ProviderStats {
  name: string;
  status: 'healthy' | 'degraded' | 'down';
  requestsTotal: number;
  errorsTotal: number;
  averageLatencyMs: number;
  tokensUsed: { input: number; output: number };
}

export interface CostEntry {
  tenantId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  timestamp: number;
}

// ── Config Hot-Reload ──

export interface ConfigDiff {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  safeToApply: boolean;
}

export type ReloadResult =
  | { status: 'applied'; changes: ConfigDiff[] }
  | { status: 'warnings'; changes: ConfigDiff[]; restartRequired: string[] }
  | { status: 'error'; message: string };
