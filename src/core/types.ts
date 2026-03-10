/**
 * Canonical types for Prism Pipe's provider-agnostic AI gateway.
 * All provider-specific formats are converted to/from these types.
 */

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
  routes: RouteConfig[];
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

import type { Request, Response } from 'express';
import type { PluginReference } from '../plugin/types';
import type { TenantConfig, JwtConfig, OAuth2Config } from '../auth/tenant';
import type { CircuitBreakerOptions } from '../fallback/circuit-breaker';
import type { IpPoolConfig, ProxyEntry as EgressProxyEntry } from '../network/ip-pool';
import type { ToolHandler, ToolRouterConfig } from '../compose/tool-router';
import type { AdminRouteOptions } from '../admin/routes';
import type { PipelineContext } from '../types/index';

// Re-export auth types for public API consumers
export type { TenantConfig, JwtConfig, OAuth2Config } from '../auth/tenant';

/**
 * Route handler function — Express-compatible with PipelineContext.
 */
export type RouteHandler = (req: Request, res: Response, ctx: PipelineContext) => void | Promise<void>;

/**
 * Extended compose config supporting both chain and tool-router modes.
 */
export interface ExtendedComposeConfig {
  type: 'chain' | 'tool-router';
  /** Steps for chain composition */
  steps?: ComposeStepConfig[];
  /** Primary model for tool-router composition */
  primary?: string;
  /** Tool handlers for tool-router composition */
  tools?: Record<string, ToolHandler>;
  /** Max tool call rounds for tool-router (default: 5) */
  maxRounds?: number;
}

/**
 * Config-object route definition with full feature support.
 */
export interface RouteConfigObject {
  /** Provider names for this route (fallback order) */
  providers?: string[];
  /** Composition config (chain or tool-router) */
  compose?: ExtendedComposeConfig;
  /** Nested sub-routes */
  routes?: Record<string, RouteValue>;
  /** Named middleware to apply to this route */
  middleware?: string[];
  /** System prompt injected into requests */
  systemPrompt?: string;
  /** Circuit breaker config per route */
  circuitBreaker?: CircuitBreakerOptions;
  /** Retry config per route */
  retry?: RetryConfig;
  /** Enable/disable feature degradation for this route */
  degradation?: boolean;
}

/**
 * Retry configuration for route-level retries.
 */
export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
}

/**
 * A route value is either a handler function or a config object.
 */
export type RouteValue = RouteHandler | RouteConfigObject;

/**
 * Per-port configuration for the proxy.
 */
export interface PortConfig {
  /** Provider definitions keyed by name */
  providers?: Record<string, ProviderConfig>;
  /** Route definitions keyed by path pattern */
  routes: Record<string, RouteValue>;
  /** Global rate limit for this port (requests per minute) */
  rateLimitRpm?: number;
  /** API keys for simple auth on this port */
  apiKeys?: string[];
  /** Plugin references to load for this port */
  plugins?: PluginReference[];
  /** Tenant configurations for multi-tenant auth */
  tenants?: TenantConfig[];
  /** JWT auth config for this port */
  jwt?: JwtConfig;
  /** OAuth2 auth config for this port */
  oauth2?: OAuth2Config;
  /** IP pool config for egress */
  ipPool?: IpPoolConfig;
  /** Egress proxy config */
  proxy?: EgressProxyEntry;
  /** Admin API options (true = enable defaults, or pass config) */
  admin?: boolean | AdminRouteOptions;
}

/**
 * Top-level proxy configuration.
 * Keys are port numbers as strings, values are per-port config.
 */
export interface ProxyConfig {
  ports: Record<string, PortConfig>;
  /** Runtime hint for adapter selection */
  runtime?: 'node' | 'edge' | 'lambda';
  /** Hot-reload configuration */
  hotReload?: HotReloadConfig;
}

/**
 * Hot-reload configuration for the proxy.
 */
export interface HotReloadConfig {
  /** Reload mode: manual (programmatic) or watch (file watcher) */
  mode: 'manual' | 'watch';
  /** File path to watch (for watch mode) */
  watchPath?: string;
  /** Debounce interval in ms (default: 1000) */
  debounceMs?: number;
}

/**
 * Unified error event wrapping all three error systems.
 */
export interface ProxyErrorEvent {
  /** The original error (ProxyError, PipelineError, or PrismError) */
  error: Error;
  /** Classified error class */
  errorClass: ErrorClass;
  /** Request context */
  context: {
    port?: string;
    route?: string;
    requestId?: string;
    provider?: string;
    tenantId?: string;
  };
}
