/**
 * Canonical data types for prism-pipe
 *
 * These are the internal format all providers are normalized to/from.
 * Providers implement adapters that transform their native formats to/from these types.
 */

/**
 * Content blocks represent different types of content in messages
 */
export type ContentBlock = TextContent | ImageContent | ToolUseContent | ToolResultContent;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    data: string;
    mediaType?: string;
  };
}

export interface ToolUseContent {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultContent {
  type: 'tool_result';
  toolUseId: string;
  content: ContentBlock[];
}

/**
 * Tool call structure
 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Message in the canonical format
 */
export interface CanonicalMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ContentBlock[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

/**
 * Request parameters that can be passed to providers
 */
export interface RequestParams {
  temperature?: number;
  maxOutputTokens?: number;
  topP?: number;
  topK?: number;
  stop?: string[];
  stream?: boolean;
  responseFormat?: {
    type: 'json_object' | 'text';
  };
}

/**
 * Canonical request format
 */
export interface CanonicalRequest {
  model: string;
  systemPrompt?: string;
  messages: CanonicalMessage[];
  params: RequestParams;
  providerExtensions?: Record<string, unknown>;
}

/**
 * Stop reason for responses
 */
export type StopReason =
  | 'stop' // Natural completion
  | 'max_tokens' // Hit token limit
  | 'tool_use' // Model wants to use a tool
  | 'content_filter' // Content filtered
  | 'error'; // Error occurred

/**
 * Token usage information
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Canonical response format
 */
export interface CanonicalResponse {
  id: string;
  content: ContentBlock[];
  stopReason: StopReason;
  usage: TokenUsage;
  model: string;
  provider: string;
  latencyMs: number;
}

/**
 * Streaming chunk types
 */
export type CanonicalStreamChunk = ContentDeltaChunk | UsageChunk | DoneChunk | ErrorChunk;

export interface ContentDeltaChunk {
  type: 'content_delta';
  delta: {
    text: string;
  };
}

export interface UsageChunk {
  type: 'usage';
  usage: TokenUsage;
}

export interface DoneChunk {
  type: 'done';
}

export interface ErrorChunk {
  type: 'error';
  error: {
    message: string;
    code: string;
  };
}

/**
 * Helper type guards
 */
export function isTextContent(content: ContentBlock): content is TextContent {
  return content.type === 'text';
}

export function isImageContent(content: ContentBlock): content is ImageContent {
  return content.type === 'image';
}

export function isToolUseContent(content: ContentBlock): content is ToolUseContent {
  return content.type === 'tool_use';
}

export function isToolResultContent(content: ContentBlock): content is ToolResultContent {
  return content.type === 'tool_result';
}
