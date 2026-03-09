/**
 * Canonical data types that flow through the entire system.
 * All providers normalize to/from these types.
 */

export interface CanonicalRequest {
  model: string;
  systemPrompt?: string;
  messages: CanonicalMessage[];
  params: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
    stop?: string[];
    stream?: boolean;
    responseFormat?: { type: 'json_object' | 'text' };
  };
  providerExtensions?: Record<string, unknown>;
}

export interface CanonicalMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ContentBlock[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64' | 'url'; data: string; mediaType?: string } }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: ContentBlock[] };

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface CanonicalResponse {
  id: string;
  content: ContentBlock[];
  stopReason: 'stop' | 'max_tokens' | 'tool_use' | 'content_filter' | 'error';
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
  model: string;
  provider: string;
  latencyMs: number;
}

export interface CanonicalStreamChunk {
  type: 'content_delta' | 'usage' | 'done' | 'error';
  delta?: { text: string };
  usage?: { inputTokens: number; outputTokens: number };
  error?: { message: string; code: string };
}
