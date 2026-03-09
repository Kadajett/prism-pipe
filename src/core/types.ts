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

export interface RouteConfig {
  path: string;
  providers: string[];
  pipeline?: string[];
  systemPrompt?: string;
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
