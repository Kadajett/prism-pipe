import type {
  CanonicalMessage,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamChunk,
  ContentBlock,
  ProviderCapabilities,
} from '../../core/types.js';
import type { ProviderTransformer } from '../transform-registry.js';

/**
 * Anthropic ↔ Canonical transformer.
 * Handles: top-level `system`, content blocks array, stop_reason → stopReason,
 * input/output token naming, event: message_stop streaming.
 */
export class AnthropicTransformer implements ProviderTransformer {
  readonly provider = 'anthropic';

  readonly capabilities: ProviderCapabilities = {
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: true,
    supportsSystemPrompt: true,
  };

  toCanonical(raw: unknown): CanonicalRequest {
    const r = raw as Record<string, unknown>;
    const messages = (r.messages as Array<Record<string, unknown>>) ?? [];
    const canonicalMessages: CanonicalMessage[] = [];

    for (const msg of messages) {
      const role = msg.role as string;
      const content = msg.content;

      if (typeof content === 'string') {
        canonicalMessages.push({ role: role as CanonicalMessage['role'], content });
      } else if (Array.isArray(content)) {
        const blocks: ContentBlock[] = content.map((block: Record<string, unknown>) => {
          switch (block.type) {
            case 'text':
              return { type: 'text' as const, text: String(block.text) };
            case 'image': {
              const src = block.source as Record<string, string>;
              return {
                type: 'image' as const,
                source:
                  src.type === 'base64'
                    ? { type: 'base64' as const, mediaType: src.media_type, data: src.data }
                    : { type: 'url' as const, url: src.url },
              };
            }
            case 'tool_use':
              return {
                type: 'tool_use' as const,
                id: String(block.id),
                name: String(block.name),
                input: (block.input as Record<string, unknown>) ?? {},
              };
            case 'tool_result':
              return {
                type: 'tool_result' as const,
                toolUseId: String(block.tool_use_id),
                content: String(block.content ?? ''),
                isError: block.is_error === true,
              };
            case 'thinking':
              return { type: 'thinking' as const, text: String(block.thinking) };
            default:
              return { type: 'text' as const, text: JSON.stringify(block) };
          }
        });
        canonicalMessages.push({ role: role as CanonicalMessage['role'], content: blocks });
      }
    }

    const req: CanonicalRequest = {
      model: String(r.model ?? ''),
      messages: canonicalMessages,
    };
    if (r.system) req.systemPrompt = String(r.system);
    if (r.temperature != null) req.temperature = Number(r.temperature);
    if (r.max_tokens != null) req.maxTokens = Number(r.max_tokens);
    if (r.top_p != null) req.topP = Number(r.top_p);
    if (r.stop_sequences) req.stopSequences = r.stop_sequences as string[];
    if (r.stream) req.stream = true;
    if (r.tools) {
      req.tools = (r.tools as Array<Record<string, unknown>>).map((t) => ({
        name: String(t.name),
        description: String(t.description ?? ''),
        inputSchema: (t.input_schema as Record<string, unknown>) ?? {},
      }));
    }
    return req;
  }

  fromCanonical(req: CanonicalRequest): unknown {
    const messages: Array<Record<string, unknown>> = [];

    for (const msg of req.messages) {
      if (msg.role === 'system') continue; // Anthropic uses top-level system

      const content = msg.content;
      if (typeof content === 'string') {
        messages.push({ role: msg.role === 'tool' ? 'user' : msg.role, content });
      } else if (Array.isArray(content)) {
        const blocks: Array<Record<string, unknown>> = [];
        for (const block of content) {
          switch (block.type) {
            case 'text':
              blocks.push({ type: 'text', text: block.text });
              break;
            case 'image': {
              const src = block.source;
              blocks.push({
                type: 'image',
                source:
                  src.type === 'base64'
                    ? { type: 'base64', media_type: src.mediaType, data: src.data }
                    : { type: 'url', url: src.url },
              });
              break;
            }
            case 'tool_use':
              blocks.push({
                type: 'tool_use',
                id: block.id,
                name: block.name,
                input: block.input,
              });
              break;
            case 'tool_result':
              blocks.push({
                type: 'tool_result',
                tool_use_id: block.toolUseId,
                content: block.content,
                is_error: block.isError ?? false,
              });
              break;
            case 'thinking':
              blocks.push({ type: 'thinking', thinking: block.text });
              break;
          }
        }
        // Tool results must come from user role in Anthropic
        const role = msg.role === 'tool' ? 'user' : msg.role;
        messages.push({ role, content: blocks });
      }
    }

    // Feature degradation: strip unsupported content
    const result: Record<string, unknown> = { model: req.model, messages };
    if (req.systemPrompt) result.system = req.systemPrompt;
    // Anthropic requires max_tokens. Use request value, or default to 8192.
    // Note: newer Anthropic models support much higher limits (up to 128k).
    result.max_tokens = req.maxTokens ?? 8192;
    if (req.temperature != null) result.temperature = req.temperature;
    if (req.topP != null) result.top_p = req.topP;
    if (req.stopSequences) result.stop_sequences = req.stopSequences;
    if (req.stream) result.stream = true;
    if (req.tools) {
      result.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    }
    return result;
  }

  responseToCanonical(raw: unknown): CanonicalResponse {
    const r = raw as Record<string, unknown>;
    const contentBlocks = (r.content as Array<Record<string, unknown>>) ?? [];

    const content: ContentBlock[] = contentBlocks.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: String(block.text) };
        case 'tool_use':
          return {
            type: 'tool_use',
            id: String(block.id),
            name: String(block.name),
            input: (block.input as Record<string, unknown>) ?? {},
          };
        case 'thinking':
          return { type: 'thinking', text: String(block.thinking) };
        default:
          return { type: 'text', text: JSON.stringify(block) };
      }
    });

    const usage = (r.usage as Record<string, number>) ?? {};
    const stopReason = String(r.stop_reason ?? 'end_turn');
    const stopMap: Record<string, CanonicalResponse['stopReason']> = {
      end_turn: 'end',
      max_tokens: 'max_tokens',
      tool_use: 'tool_use',
      stop_sequence: 'stop_sequence',
    };

    return {
      id: String(r.id ?? ''),
      model: String(r.model ?? ''),
      content,
      stopReason: stopMap[stopReason] ?? 'unknown',
      usage: {
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
      },
    };
  }

  responseFromCanonical(res: CanonicalResponse): unknown {
    const content: Array<Record<string, unknown>> = res.content.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text };
        case 'tool_use':
          return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        case 'thinking':
          return { type: 'thinking', thinking: block.text };
        default:
          return { type: 'text', text: JSON.stringify(block) };
      }
    });

    const stopMap: Record<string, string> = {
      end: 'end_turn',
      max_tokens: 'max_tokens',
      tool_use: 'tool_use',
      stop_sequence: 'stop_sequence',
    };

    return {
      id: res.id,
      type: 'message',
      role: 'assistant',
      model: res.model,
      content,
      stop_reason: stopMap[res.stopReason] ?? 'end_turn',
      usage: {
        input_tokens: res.usage.inputTokens,
        output_tokens: res.usage.outputTokens,
      },
    };
  }

  streamChunkToCanonical(chunk: unknown): CanonicalStreamChunk | null {
    const c = chunk as Record<string, unknown>;
    const type = c.type as string;

    switch (type) {
      case 'content_block_delta': {
        const delta = c.delta as Record<string, unknown>;
        if (delta?.type === 'text_delta') {
          return { type: 'content_delta', delta: { text: String(delta.text) } };
        }
        if (delta?.type === 'input_json_delta') {
          return {
            type: 'tool_use_delta',
            delta: { inputJson: String(delta.partial_json) },
          };
        }
        if (delta?.type === 'thinking_delta') {
          return { type: 'content_delta', delta: { text: String(delta.thinking) } };
        }
        return null;
      }
      case 'content_block_start': {
        const block = c.content_block as Record<string, unknown>;
        if (block?.type === 'tool_use') {
          return {
            type: 'tool_use_delta',
            delta: { toolUseId: String(block.id), toolName: String(block.name) },
          };
        }
        return null;
      }
      case 'message_delta': {
        const usage = (c.usage as Record<string, number>) ?? {};
        return {
          type: 'usage',
          usage: {
            inputTokens: usage.input_tokens ?? 0,
            outputTokens: usage.output_tokens ?? 0,
            totalTokens: (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0),
          },
        };
      }
      case 'message_stop':
        return { type: 'done' };
      case 'message_start':
      case 'ping':
        return null;
      default:
        return null;
    }
  }

  streamChunkFromCanonical(chunk: CanonicalStreamChunk): unknown {
    if (chunk.type === 'done') return { type: 'message_stop' };
    if (chunk.type === 'content_delta') {
      return {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: chunk.delta?.text ?? '' },
      };
    }
    if (chunk.type === 'tool_use_delta') {
      if (chunk.delta?.toolName) {
        return {
          type: 'content_block_start',
          content_block: {
            type: 'tool_use',
            id: chunk.delta.toolUseId ?? '',
            name: chunk.delta.toolName,
          },
        };
      }
      return {
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: chunk.delta?.inputJson ?? '' },
      };
    }
    return null;
  }
}
