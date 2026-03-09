/**
 * Core types and error system exports
 */

// Types
export type {
  ContentBlock,
  TextContent,
  ImageContent,
  ToolUseContent,
  ToolResultContent,
  ToolCall,
  CanonicalMessage,
  RequestParams,
  CanonicalRequest,
  StopReason,
  TokenUsage,
  CanonicalResponse,
  CanonicalStreamChunk,
  ContentDeltaChunk,
  UsageChunk,
  DoneChunk,
  ErrorChunk,
} from './types.js';

export {
  isTextContent,
  isImageContent,
  isToolUseContent,
  isToolResultContent,
} from './types.js';

// Errors
export {
  ErrorClass,
  ProxyError,
  ProviderError,
  RateLimitError,
  TimeoutError,
  ValidationError,
  AuthError,
  BudgetError,
  ConfigError,
  ContextLengthError,
  ContentFilterError,
  OverloadedError,
  classifyError,
  toHttpResponse,
  type ErrorResponseBody,
} from './errors.js';
