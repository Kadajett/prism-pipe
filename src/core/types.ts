/**
 * Canonical types for Prism Pipe's provider-agnostic AI gateway.
 * All provider-specific formats are converted to/from these types.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AdminRouteOptions } from '../admin/routes';
import type { JwtConfig } from '../auth/tenant';
import type { CircuitBreakerOptions } from '../fallback/circuit-breaker';
import type { PipelineContext } from './context';

// ─── Content Blocks ───

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image';
  source: { type: 'base64'; mediaType: string; data: string } | { type: 'url'; url: string };
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string | ContentBlock[];
  isError?: boolean;
}

export interface ThinkingBlock {
  type: 'thinking';
  text: string;
}

export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock;

// ─── Content Type Guards ───

export function isTextContent(block: ContentBlock): block is TextBlock {
  return block.type === 'text';
}

export function isImageContent(block: ContentBlock): block is ImageBlock {
  return block.type === 'image';
}

export function isToolUseContent(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use';
}

export function isToolResultContent(block: ContentBlock): block is ToolResultBlock {
  return block.type === 'tool_result';
}

export function isThinkingContent(block: ContentBlock): block is ThinkingBlock {
  return block.type === 'thinking';
}

// ─── Messages ───

export interface CanonicalMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | ContentBlock[];
}

// ─── Tool Definitions ───

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ─── Request / Response ───

export interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stopSequences?: string[];
  stream?: boolean;
  providerExtensions?: Record<string, unknown>;
  /**
   * Passthrough fields not explicitly modeled in the canonical schema.
   * Captured from the incoming request and spread back into the outgoing request,
   * ensuring fields like `response_format`, `logprobs`, `seed`, etc. survive
   * the canonical round-trip without requiring explicit support for each one.
   */
  extras?: Record<string, unknown>;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CanonicalResponse {
  id: string;
  model: string;
  content: ContentBlock[];
  stopReason: 'end' | 'max_tokens' | 'tool_use' | 'stop_sequence' | 'content_filter' | 'unknown';
  usage: UsageInfo;
  providerExtensions?: Record<string, unknown>;
}

// ─── Streaming ───

export interface CanonicalStreamChunk {
  type: 'content_delta' | 'tool_use_delta' | 'usage' | 'done' | 'error';
  delta?: {
    text?: string;
    toolUseId?: string;
    toolName?: string;
    inputJson?: string;
  };
  usage?: UsageInfo;
  error?: { message: string; code?: string };
}

// ─── Provider Capabilities ───

export interface ProviderCapabilities {
  supportsTools: boolean;
  supportsVision: boolean;
  supportsStreaming: boolean;
  supportsThinking: boolean;
  supportsSystemPrompt: boolean;
  maxContextTokens?: number;
}

// ─── Error Types ───

export type ErrorClass =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'server_error'
  | 'invalid_request'
  | 'content_filter'
  | 'model_not_found'
  | 'overloaded'
  | 'network'
  | 'unknown';

export class PipelineError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorClass,
    public readonly step?: string,
    public readonly statusCode: number = 500,
    public readonly retryable: boolean = false,
    public readonly cause?: Error
  ) {
    super(message);
    this.name = 'PipelineError';
  }
}

// ─── Config ───

export interface ProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  format?: string; // e.g. 'openai' | 'anthropic' — inferred from baseUrl if omitted
  models?: Record<string, string>;
  defaultModel?: string;
  timeout?: number;
}

export interface ComposeStepConfig {
  name: string;
  provider: string;
  model?: string;
  systemPrompt?: string;
  inputTransform?: string;
  timeout?: number;
  onError?: 'fail' | 'skip' | 'default' | 'partial';
  defaultContent?: string;
}

export interface ToolRouterComposeConfig {
  /** Primary model that handles conversation and initiates tool calls */
  primary: string;
  /** Maximum tool call rounds before stopping (prevents infinite loops) */
  maxRounds?: number;
  /** Map of tool names to their handlers */
  tools: Record<string, { provider?: string; handler?: string }>;
}

export type ComposeConfig =
  | { type: 'chain'; steps: ComposeStepConfig[] }
  | { type: 'tool-router'; toolRouter: ToolRouterComposeConfig; steps?: never };

export interface RouteConfig {
  path: string;
  providers: string[];
  pipeline?: string[];
  systemPrompt?: string;
  compose?: ComposeConfig;
}

export interface ResolvedConfig {
  port: number;
  logLevel: string;
  requestTimeout: number;
  providers: Record<string, ProviderConfig>;
  routes: RouteConfig[] | Record<string, RouteValue>;
}

// ─── Logger / Metrics interfaces ───

export interface ScopedLogger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  debug(msg: string, data?: Record<string, unknown>): void;
}

export interface MetricsEmitter {
  counter(name: string, value?: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
}

// ─── Public API Types (Phase 1) ───

// Re-export auth types for public API consumers
export type { JwtConfig, OAuth2Config, TenantConfig } from '../auth/tenant';

const PositiveIntSchema = z.number().int().positive();
const NonNegativeIntSchema = z.number().int().nonnegative();
const NonNegativeNumberSchema = z.number().finite().nonnegative();
const UnknownRecordSchema = z.record(z.string(), z.unknown());

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PluginReferenceSchema = z.strictObject({
  source: z.string().min(1),
  config: UnknownRecordSchema.optional(),
  enabled: z.boolean().optional(),
});

const TenantConfigSchema = z.strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  apiKey: z.string().min(1),
  rateLimitRpm: PositiveIntSchema.optional(),
  allowedProviders: z.array(z.string().min(1)).optional(),
  budgetUsd: NonNegativeNumberSchema.optional(),
  admin: z.boolean().optional(),
});

const JwtConfigSchema = z.strictObject({
  secret: z.string().min(1),
  algorithm: z.custom<JwtConfig['algorithm']>((value) => typeof value === 'string').optional(),
  issuer: z.string().min(1).optional(),
  audience: z.string().min(1).optional(),
});

const OAuth2ConfigSchema = z.strictObject({
  introspectionUrl: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  jwksUri: z.string().min(1).optional(),
});

const EgressProxyEntrySchema = z.strictObject({
  url: z.string().min(1),
  providers: z.array(z.string().min(1)).optional(),
});

const IpPoolConfigSchema = z.strictObject({
  ips: z
    .array(
      z.strictObject({
        address: z.string().min(1),
        weight: PositiveIntSchema.optional(),
        providers: z.array(z.string().min(1)).optional(),
      })
    )
    .optional(),
  proxies: z.array(EgressProxyEntrySchema).optional(),
  strategy: z
    .enum(['round-robin', 'random', 'least-recently-used', 'weighted-round-robin'])
    .optional(),
});

const CircuitBreakerOptionsSchema: z.ZodType<CircuitBreakerOptions> = z.strictObject({
  failureThreshold: PositiveIntSchema.optional(),
  resetTimeoutMs: NonNegativeIntSchema.optional(),
  halfOpenRequests: PositiveIntSchema.optional(),
  metrics: z.custom<MetricsEmitter>((value) => isPlainObject(value)).optional(),
});

const ProviderConfigSchema = z.strictObject({
  name: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  format: z.string().min(1).optional(),
  models: z.record(z.string(), z.string()).optional(),
  defaultModel: z.string().min(1).optional(),
  timeout: PositiveIntSchema.optional(),
});

/**
 * Route handler function — Express-compatible with PipelineContext.
 */
export type RouteHandler = (
  req: Request,
  res: Response,
  ctx: PipelineContext
) => RouteResult | Promise<RouteResult> | void | Promise<void>;

export const RouteHandlerSchema = z.custom<RouteHandler>((value) => typeof value === 'function');

const ToolHandlerSchema = z
  .strictObject({
    provider: z.string().min(1).optional(),
    handler: z.string().min(1).optional(),
  })
  .refine((value) => value.provider !== undefined || value.handler !== undefined, {
    error: 'Tool handlers must define a provider or handler',
  });

/**
 * Extended compose config supporting both chain and tool-router modes.
 */
export const ExtendedComposeConfigSchema = z
  .strictObject({
    type: z.enum(['chain', 'tool-router']),
    steps: z
      .array(
        z.strictObject({
          name: z.string().min(1),
          provider: z.string().min(1),
          model: z.string().min(1).optional(),
          systemPrompt: z.string().optional(),
          inputTransform: z.string().min(1).optional(),
          timeout: PositiveIntSchema.optional(),
          onError: z.enum(['fail', 'skip', 'default', 'partial']).optional(),
          defaultContent: z.string().optional(),
        })
      )
      .optional(),
    primary: z.string().min(1).optional(),
    tools: z.record(z.string(), ToolHandlerSchema).optional(),
    maxRounds: PositiveIntSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'chain' && !value.steps?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Chain composition requires at least one step',
        path: ['steps'],
      });
    }

    if (value.type !== 'tool-router') {
      return;
    }

    if (!value.primary) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tool-router composition requires a primary model',
        path: ['primary'],
      });
    }

    if (!value.tools) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Tool-router composition requires a tools map',
        path: ['tools'],
      });
    }
  });

export type ExtendedComposeConfig = z.infer<typeof ExtendedComposeConfigSchema>;

export const RetryConfigSchema = z.strictObject({
  maxAttempts: PositiveIntSchema,
  backoffMs: NonNegativeIntSchema,
});

export type RetryConfig = z.infer<typeof RetryConfigSchema>;

/**
 * Config-object route definition with full feature support.
 */
export type RouteConfigObject = {
  providers?: string[];
  compose?: ExtendedComposeConfig;
  routes?: Record<string, RouteValue>;
  middleware?: string[];
  systemPrompt?: string;
  circuitBreaker?: CircuitBreakerOptions;
  retry?: RetryConfig;
  degradation?: boolean;
};

export type RouteValue = RouteHandler | RouteConfigObject;

export const RouteValueSchema: z.ZodType<RouteValue> = z.lazy(() =>
  z.union([RouteHandlerSchema, RouteConfigObjectSchema])
);

export const RouteConfigObjectSchema: z.ZodType<RouteConfigObject> = z.strictObject({
  providers: z.array(z.string().min(1)).optional(),
  compose: ExtendedComposeConfigSchema.optional(),
  routes: z.record(z.string(), RouteValueSchema).optional(),
  middleware: z.array(z.string().min(1)).optional(),
  systemPrompt: z.string().optional(),
  circuitBreaker: CircuitBreakerOptionsSchema.optional(),
  retry: RetryConfigSchema.optional(),
  degradation: z.boolean().optional(),
});

/**
 * Per-port configuration for the proxy.
 */
export const PortConfigSchema = z.strictObject({
  providers: z.record(z.string(), ProviderConfigSchema).optional(),
  routes: z.record(z.string(), RouteValueSchema),
  rateLimitRpm: PositiveIntSchema.optional(),
  apiKeys: z.array(z.string().min(1)).optional(),
  plugins: z.array(PluginReferenceSchema).optional(),
  tenants: z.array(TenantConfigSchema).optional(),
  jwt: JwtConfigSchema.optional(),
  oauth2: OAuth2ConfigSchema.optional(),
  ipPool: IpPoolConfigSchema.optional(),
  proxy: EgressProxyEntrySchema.optional(),
  admin: z
    .union([z.boolean(), z.custom<AdminRouteOptions>((value) => isPlainObject(value))])
    .optional(),
});

export type PortConfig = z.infer<typeof PortConfigSchema>;

export const HotReloadConfigSchema = z.strictObject({
  mode: z.enum(['manual', 'watch']),
  watchPath: z.string().min(1).optional(),
  debounceMs: NonNegativeIntSchema.optional(),
});

export type HotReloadConfig = z.infer<typeof HotReloadConfigSchema>;

/**
 * Unified error event wrapping all three error systems.
 */
export const ProxyErrorEventSchema = z.strictObject({
  error: z.instanceof(Error),
  errorClass: z.enum([
    'auth',
    'rate_limit',
    'timeout',
    'server_error',
    'invalid_request',
    'content_filter',
    'model_not_found',
    'overloaded',
    'network',
    'unknown',
  ]),
  context: z.strictObject({
    port: z.string().min(1).optional(),
    route: z.string().min(1).optional(),
    requestId: z.string().min(1).optional(),
    provider: z.string().min(1).optional(),
    tenantId: z.string().min(1).optional(),
  }),
});

export type ProxyErrorEvent = z.infer<typeof ProxyErrorEventSchema>;

/**
 * Registered model definition used for token and cost accounting.
 */
export const ModelDefinitionSchema = z.strictObject({
  provider: z.string().min(1),
  inputCostPerMillion: NonNegativeNumberSchema.optional(),
  outputCostPerMillion: NonNegativeNumberSchema.optional(),
  thinkingCostPerMillion: NonNegativeNumberSchema.optional(),
  cacheReadCostPerMillion: NonNegativeNumberSchema.optional(),
  cacheWriteCostPerMillion: NonNegativeNumberSchema.optional(),
  metadata: UnknownRecordSchema.optional(),
});

export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;

/**
 * Token usage for a single model inside a route execution.
 */
export const ModelUsageSchema = z.strictObject({
  inputTokens: NonNegativeIntSchema.optional(),
  outputTokens: NonNegativeIntSchema.optional(),
  thinkingTokens: NonNegativeIntSchema.optional(),
  cacheReadTokens: NonNegativeIntSchema.optional(),
  cacheWriteTokens: NonNegativeIntSchema.optional(),
});

export type ModelUsage = z.infer<typeof ModelUsageSchema>;

/**
 * Future route return envelope for function-first public routes.
 */
export const RouteResultSchema = z.strictObject({
  data: z.unknown(),
  usage: z.record(z.string(), ModelUsageSchema).optional(),
  meta: z
    .strictObject({
      status: z.number().int().min(100).max(599).optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
});

export type RouteResult = z.infer<typeof RouteResultSchema>;

/**
 * Future public proxy definition.
 *
 * This is the north-star API surface used by `prism.createProxy({...})`.
 * It is intentionally simpler than the current internal multi-port shape.
 */
export const ProxyDefinitionSchema = PortConfigSchema.extend({
  id: z.string().min(1).optional(),
  port: z.number().int().min(0).max(65535),
  models: z.record(z.string(), ModelDefinitionSchema).optional(),
  hotReload: HotReloadConfigSchema.optional(),
});

export type ProxyDefinition = z.infer<typeof ProxyDefinitionSchema>;

/**
 * Query shape for usage and cost aggregations.
 */
export const UsageQuerySchema = z.strictObject({
  since: NonNegativeIntSchema.optional(),
  until: NonNegativeIntSchema.optional(),
  model: z.string().min(1).optional(),
  proxyId: z.string().min(1).optional(),
  routePath: z.string().min(1).optional(),
  tenantId: z.string().min(1).optional(),
});

export type UsageQuery = z.infer<typeof UsageQuerySchema>;

/**
 * Aggregate token totals.
 */
export const UsageSummarySchema = z.strictObject({
  requests: NonNegativeIntSchema,
  inputTokens: NonNegativeIntSchema,
  outputTokens: NonNegativeIntSchema,
  thinkingTokens: NonNegativeIntSchema,
  cacheReadTokens: NonNegativeIntSchema,
  cacheWriteTokens: NonNegativeIntSchema,
  totalTokens: NonNegativeIntSchema,
});

export type UsageSummary = z.infer<typeof UsageSummarySchema>;

/**
 * Aggregate cost totals.
 */
export const CostSummarySchema = z.strictObject({
  inputUsd: NonNegativeNumberSchema,
  outputUsd: NonNegativeNumberSchema,
  thinkingUsd: NonNegativeNumberSchema,
  cacheReadUsd: NonNegativeNumberSchema,
  cacheWriteUsd: NonNegativeNumberSchema,
  totalUsd: NonNegativeNumberSchema,
});

export type CostSummary = z.infer<typeof CostSummarySchema>;

/**
 * Public proxy lifecycle view.
 */
export const ProxyStatusSchema = z.strictObject({
  id: z.string().min(1),
  state: z.enum(['running', 'stopped', 'degraded']),
  port: z.number().int().min(0).max(65535),
  routes: z.array(z.string()),
  listening: z.boolean(),
  uptime: NonNegativeIntSchema,
});

export type ProxyStatus = z.infer<typeof ProxyStatusSchema>;

/**
 * Public Prism lifecycle view.
 */
export const PrismStatusSchema = z.strictObject({
  state: z.enum(['running', 'stopped', 'degraded']),
  proxies: z.array(ProxyStatusSchema),
  totals: z.strictObject({
    registered: NonNegativeIntSchema,
    running: NonNegativeIntSchema,
  }),
});

export type PrismStatus = z.infer<typeof PrismStatusSchema>;
