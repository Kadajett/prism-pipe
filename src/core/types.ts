/** Canonical request format — provider-agnostic representation of an LLM API call. */
export interface ContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  data?: string;
  mediaType?: string;
  toolUseId?: string;
  toolName?: string;
  input?: unknown;
  content?: string;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentBlock[];
}

export interface CanonicalRequest {
  provider: string;
  model: string;
  messages: Message[];
  stream: boolean;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string[];
  metadata?: Record<string, unknown>;
}

export interface CanonicalResponse {
  provider: string;
  model: string;
  content: ContentBlock[];
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: string;
  metadata?: Record<string, unknown>;
}

export interface StreamChunk {
  type: "content" | "usage" | "done" | "error";
  content?: ContentBlock;
  usage?: CanonicalResponse["usage"];
  error?: string;
}
