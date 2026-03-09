import type {
  CanonicalMessage,
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamChunk,
  ContentBlock,
  ProviderCapabilities,
} from '../../core/types';
import type { ProviderTransformer } from '../transform-registry';

/**
 * Ollama ↔ Canonical transformer.
 * Handles: OpenAI-like messages but params in nested options object,
 * options.num_predict (not max_tokens), no auth headers needed (local),
 * newline-delimited JSON streaming (not SSE).
 */
export class OllamaTransformer implements ProviderTransformer {
  readonly provider = 'ollama';

  readonly capabilities: ProviderCapabilities = {
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: false,
    supportsSystemPrompt: true,
  };

  toCanonical(raw: unknown): CanonicalRequest {
    const r = raw as Record<string, unknown>;
    const messages = (r.messages as Array<Record<string, unknown>>) ?? [];
    const canonicalMessages: CanonicalMessage[] = [];
    let systemPrompt: string | undefined;

    for (const msg of messages) {
      const role = msg.role as string;
      if (role === 'system') {
        systemPrompt = (systemPrompt ? `${systemPrompt}\n` : '') + String(msg.content);
        continue;
      }

      const content = msg.content;
      if (typeof content === 'string') {
        canonicalMessages.push({ role: role as CanonicalMessage['role'], content });
      } else if (Array.isArray(content)) {
        const blocks: ContentBlock[] = content.map((part: Record<string, unknown>) => {
          if (part.type === 'text') return { type: 'text', text: String(part.text) };
          if (part.type === 'image_url') {
            const url = (part.image_url as Record<string, string>)?.url ?? '';
            if (url.startsWith('data:')) {
              const match = url.match(/^data:([^;]+);base64,(.+)/);
              if (match) {
                return {
                  type: 'image' as const,
                  source: { type: 'base64' as const, mediaType: match[1], data: match[2] },
                };
              }
            }
            return { type: 'image' as const, source: { type: 'url' as const, url } };
          }
          return { type: 'text' as const, text: JSON.stringify(part) };
        });
        canonicalMessages.push({ role: role as CanonicalMessage['role'], content: blocks });
      }

      // Handle tool calls in assistant messages
      if (role === 'assistant' && Array.isArray(msg.tool_calls)) {
        const toolBlocks: ContentBlock[] = (msg.tool_calls as Array<Record<string, unknown>>).map(
          (tc) => ({
            type: 'tool_use' as const,
            id: String(tc.id),
            name: String((tc.function as Record<string, unknown>)?.name),
            input: JSON.parse(String((tc.function as Record<string, unknown>)?.arguments ?? '{}')),
          })
        );
        // Merge with existing content
        const last = canonicalMessages[canonicalMessages.length - 1];
        if (last && last.role === 'assistant') {
          const existing =
            typeof last.content === 'string'
              ? [{ type: 'text' as const, text: last.content }]
              : (last.content as ContentBlock[]);
          last.content = [...existing, ...toolBlocks];
        }
      }

      // Handle tool role messages
      if (role === 'tool') {
        canonicalMessages.push({
          role: 'tool',
          content: [
            {
              type: 'tool_result',
              toolUseId: String(msg.tool_call_id),
              content: String(msg.content),
            },
          ],
        });
      }
    }

    const options = (r.options as Record<string, unknown>) ?? {};
    const req: CanonicalRequest = {
      model: String(r.model ?? ''),
      messages: canonicalMessages,
    };
    if (systemPrompt) req.systemPrompt = systemPrompt;
    if (options.temperature != null) req.temperature = Number(options.temperature);
    if (options.num_predict != null) req.maxTokens = Number(options.num_predict);
    if (options.top_p != null) req.topP = Number(options.top_p);
    if (options.stop) {
      req.stopSequences = Array.isArray(options.stop)
        ? options.stop
        : [String(options.stop)];
    }
    if (r.stream) req.stream = true;
    if (r.tools) {
      req.tools = (r.tools as Array<Record<string, unknown>>).map((t) => {
        const fn = t.function as Record<string, unknown>;
        return {
          name: String(fn.name),
          description: String(fn.description ?? ''),
          inputSchema: (fn.parameters as Record<string, unknown>) ?? {},
        };
      });
    }
    return req;
  }

  fromCanonical(req: CanonicalRequest): unknown {
    const messages: Array<Record<string, unknown>> = [];

    if (req.systemPrompt) {
      messages.push({ role: 'system', content: req.systemPrompt });
    }

    for (const msg of req.messages) {
      if (msg.role === 'system') {
        messages.push({
          role: 'system',
          content: typeof msg.content === 'string' ? msg.content : '',
        });
        continue;
      }

      if (msg.role === 'tool' && Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === 'object' && block.type === 'tool_result') {
            messages.push({
              role: 'tool',
              tool_call_id: block.toolUseId,
              content:
                typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            });
          }
        }
        continue;
      }

      const content = msg.content;
      if (typeof content === 'string') {
        messages.push({ role: msg.role, content });
      } else if (Array.isArray(content)) {
        const toolCalls: Array<Record<string, unknown>> = [];
        const parts: Array<Record<string, unknown>> = [];

        for (const block of content) {
          if (block.type === 'text') {
            parts.push({ type: 'text', text: block.text });
          } else if (block.type === 'image') {
            const src = block.source;
            const url =
              src.type === 'base64' ? `data:${src.mediaType};base64,${src.data}` : src.url;
            parts.push({ type: 'image_url', image_url: { url } });
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id,
              type: 'function',
              function: { name: block.name, arguments: JSON.stringify(block.input) },
            });
          }
        }

        const entry: Record<string, unknown> = { role: msg.role };
        if (parts.length > 0)
          entry.content = parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
        if (toolCalls.length > 0) entry.tool_calls = toolCalls;
        if (!entry.content && !entry.tool_calls) entry.content = '';
        messages.push(entry);
      }
    }

    const options: Record<string, unknown> = {};
    if (req.temperature != null) options.temperature = req.temperature;
    if (req.maxTokens != null) options.num_predict = req.maxTokens;
    if (req.topP != null) options.top_p = req.topP;
    if (req.stopSequences) options.stop = req.stopSequences;

    const result: Record<string, unknown> = { model: req.model, messages };
    if (Object.keys(options).length > 0) result.options = options;
    if (req.stream) result.stream = true;
    if (req.tools) {
      result.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
    }
    return result;
  }

  responseToCanonical(raw: unknown): CanonicalResponse {
    const r = raw as Record<string, unknown>;
    const msg = (r.message as Record<string, unknown>) ?? {};

    const content: ContentBlock[] = [];
    if (msg.content && String(msg.content).trim()) {
      content.push({ type: 'text', text: String(msg.content) });
    }
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
        const fn = tc.function as Record<string, unknown>;
        content.push({
          type: 'tool_use',
          id: String(tc.id),
          name: String(fn.name),
          input: JSON.parse(String(fn.arguments ?? '{}')),
        });
      }
    }

    const stopReason = r.done === true ? 'end' : 'unknown';

    return {
      id: String(r.id ?? ''),
      model: String(r.model ?? ''),
      content,
      stopReason: stopReason as CanonicalResponse['stopReason'],
      usage: {
        inputTokens: Number(r.prompt_eval_count ?? 0),
        outputTokens: Number(r.eval_count ?? 0),
        totalTokens: Number(r.prompt_eval_count ?? 0) + Number(r.eval_count ?? 0),
      },
    };
  }

  responseFromCanonical(res: CanonicalResponse): unknown {
    const message: Record<string, unknown> = { role: 'assistant' };
    const textParts = res.content.filter((b) => b.type === 'text');
    const toolParts = res.content.filter((b) => b.type === 'tool_use');

    if (textParts.length > 0) {
      message.content = textParts.map((b) => (b as { text: string }).text).join('');
    }
    if (toolParts.length > 0) {
      message.tool_calls = toolParts.map((b) => {
        const tu = b as { id: string; name: string; input: Record<string, unknown> };
        return {
          id: tu.id,
          type: 'function',
          function: { name: tu.name, arguments: JSON.stringify(tu.input) },
        };
      });
    }

    return {
      model: res.model,
      message,
      done: res.stopReason === 'end',
      prompt_eval_count: res.usage.inputTokens,
      eval_count: res.usage.outputTokens,
    };
  }

  streamChunkToCanonical(chunk: unknown): CanonicalStreamChunk | null {
    const c = chunk as Record<string, unknown>;

    if (c.done === true) {
      // Final chunk with usage stats
      if (c.prompt_eval_count != null || c.eval_count != null) {
        return {
          type: 'usage',
          usage: {
            inputTokens: Number(c.prompt_eval_count ?? 0),
            outputTokens: Number(c.eval_count ?? 0),
            totalTokens: Number(c.prompt_eval_count ?? 0) + Number(c.eval_count ?? 0),
          },
        };
      }
      return { type: 'done' };
    }

    const msg = (c.message as Record<string, unknown>) ?? {};
    if (msg.content) {
      return { type: 'content_delta', delta: { text: String(msg.content) } };
    }

    if (msg.tool_calls) {
      const tc = (msg.tool_calls as Array<Record<string, unknown>>)[0];
      const fn = (tc?.function as Record<string, unknown>) ?? {};
      return {
        type: 'tool_use_delta',
        delta: {
          toolUseId: tc?.id ? String(tc.id) : undefined,
          toolName: fn.name ? String(fn.name) : undefined,
          inputJson: fn.arguments ? String(fn.arguments) : undefined,
        },
      };
    }

    return null;
  }

  streamChunkFromCanonical(chunk: CanonicalStreamChunk): unknown {
    if (chunk.type === 'done') return { done: true };
    if (chunk.type === 'content_delta') {
      return { message: { role: 'assistant', content: chunk.delta?.text ?? '' } };
    }
    if (chunk.type === 'tool_use_delta') {
      const tc: Record<string, unknown> = { type: 'function', function: {} };
      if (chunk.delta?.toolUseId) tc.id = chunk.delta.toolUseId;
      if (chunk.delta?.toolName)
        (tc.function as Record<string, unknown>).name = chunk.delta.toolName;
      if (chunk.delta?.inputJson)
        (tc.function as Record<string, unknown>).arguments = chunk.delta.inputJson;
      return { message: { role: 'assistant', tool_calls: [tc] } };
    }
    if (chunk.type === 'usage' && chunk.usage) {
      return {
        done: true,
        prompt_eval_count: chunk.usage.inputTokens,
        eval_count: chunk.usage.outputTokens,
      };
    }
    return null;
  }
}
