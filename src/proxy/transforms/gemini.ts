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
 * Gemini ↔ Canonical transformer.
 * Handles: contents array with parts[{text}] format, systemInstruction top-level,
 * generationConfig.maxOutputTokens, role mapping (assistant ↔ model),
 * finishReason SCREAMING_CASE, usageMetadata, SSE streaming.
 */
export class GeminiTransformer implements ProviderTransformer {
  readonly provider = 'gemini';

  readonly capabilities: ProviderCapabilities = {
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    supportsThinking: false,
    supportsSystemPrompt: true,
  };

  toCanonical(raw: unknown): CanonicalRequest {
    const r = raw as Record<string, unknown>;
    const contents = (r.contents as Array<Record<string, unknown>>) ?? [];
    const canonicalMessages: CanonicalMessage[] = [];

    for (const content of contents) {
      const role = content.role as string;
      const canonicalRole = role === 'model' ? 'assistant' : (role as CanonicalMessage['role']);
      const parts = (content.parts as Array<Record<string, unknown>>) ?? [];

      if (parts.length === 1 && typeof parts[0].text === 'string') {
        canonicalMessages.push({ role: canonicalRole, content: String(parts[0].text) });
      } else {
        const blocks: ContentBlock[] = parts.map((part, index) => {
          if (part.text != null) {
            return { type: 'text' as const, text: String(part.text) };
          }
          if (part.inlineData) {
            const inline = part.inlineData as Record<string, string>;
            return {
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                mediaType: inline.mimeType ?? 'image/jpeg',
                data: inline.data,
              },
            };
          }
          if (part.fileData) {
            const file = part.fileData as Record<string, string>;
            return {
              type: 'image' as const,
              source: { type: 'url' as const, url: file.fileUri },
            };
          }
          if (part.functionCall) {
            const fc = part.functionCall as Record<string, unknown>;
            return {
              type: 'tool_use' as const,
              id: `${fc.name}_${index}`, // Generate unique ID to handle multiple calls to same tool
              name: String(fc.name),
              input: (fc.args as Record<string, unknown>) ?? {},
            };
          }
          if (part.functionResponse) {
            const fr = part.functionResponse as Record<string, unknown>;
            return {
              type: 'tool_result' as const,
              toolUseId: String(fr.name),
              content: JSON.stringify(fr.response),
            };
          }
          return { type: 'text' as const, text: JSON.stringify(part) };
        });
        canonicalMessages.push({ role: canonicalRole, content: blocks });
      }
    }

    const generationConfig = (r.generationConfig as Record<string, unknown>) ?? {};
    const req: CanonicalRequest = {
      model: String(r.model ?? ''),
      messages: canonicalMessages,
    };

    if (r.systemInstruction) {
      const si = r.systemInstruction as Record<string, unknown>;
      const parts = (si.parts as Array<Record<string, string>>) ?? [];
      req.systemPrompt = parts.map((p) => p.text).join('\n');
    }

    if (generationConfig.temperature != null)
      req.temperature = Number(generationConfig.temperature);
    if (generationConfig.maxOutputTokens != null)
      req.maxTokens = Number(generationConfig.maxOutputTokens);
    if (generationConfig.topP != null) req.topP = Number(generationConfig.topP);
    if (generationConfig.stopSequences)
      req.stopSequences = generationConfig.stopSequences as string[];

    if (r.tools) {
      const tools = r.tools as Array<Record<string, unknown>>;
      req.tools = tools.flatMap((t) => {
        const declarations = (t.functionDeclarations as Array<Record<string, unknown>>) ?? [];
        return declarations.map((d) => ({
          name: String(d.name),
          description: String(d.description ?? ''),
          inputSchema: (d.parameters as Record<string, unknown>) ?? {},
        }));
      });
    }

    return req;
  }

  fromCanonical(req: CanonicalRequest): unknown {
    const contents: Array<Record<string, unknown>> = [];

    for (const msg of req.messages) {
      if (msg.role === 'system') continue; // Gemini uses systemInstruction

      const role = msg.role === 'assistant' ? 'model' : msg.role;
      const content = msg.content;

      if (typeof content === 'string') {
        contents.push({ role, parts: [{ text: content }] });
      } else if (Array.isArray(content)) {
        const parts: Array<Record<string, unknown>> = [];
        for (const block of content) {
          switch (block.type) {
            case 'text':
              parts.push({ text: block.text });
              break;
            case 'image': {
              const src = block.source;
              if (src.type === 'base64') {
                parts.push({
                  inlineData: { mimeType: src.mediaType, data: src.data },
                });
              } else {
                parts.push({ fileData: { fileUri: src.url } });
              }
              break;
            }
            case 'tool_use':
              parts.push({
                functionCall: { name: block.name, args: block.input },
              });
              break;
            case 'tool_result': {
              let response: unknown;
              try {
                response = JSON.parse(String(block.content));
              } catch {
                response = { result: String(block.content) };
              }
              parts.push({
                functionResponse: { name: block.toolUseId, response },
              });
              break;
            }
          }
        }
        // Gemini requires user role for tool responses
        const finalRole = msg.role === 'tool' ? 'user' : role;
        contents.push({ role: finalRole, parts });
      }
    }

    const result: Record<string, unknown> = { contents };
    if (req.model) result.model = req.model;

    if (req.systemPrompt) {
      result.systemInstruction = { parts: [{ text: req.systemPrompt }] };
    }

    const generationConfig: Record<string, unknown> = {};
    if (req.temperature != null) generationConfig.temperature = req.temperature;
    if (req.maxTokens != null) generationConfig.maxOutputTokens = req.maxTokens;
    if (req.topP != null) generationConfig.topP = req.topP;
    if (req.stopSequences) generationConfig.stopSequences = req.stopSequences;
    if (Object.keys(generationConfig).length > 0) result.generationConfig = generationConfig;

    if (req.tools) {
      result.tools = [
        {
          functionDeclarations: req.tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          })),
        },
      ];
    }

    return result;
  }

  responseToCanonical(raw: unknown): CanonicalResponse {
    const r = raw as Record<string, unknown>;
    const candidates = (r.candidates as Array<Record<string, unknown>>) ?? [];
    const candidate = candidates[0] ?? {};
    const content = (candidate.content as Record<string, unknown>) ?? {};
    const parts = (content.parts as Array<Record<string, unknown>>) ?? [];

    const contentBlocks: ContentBlock[] = parts.map((part, index) => {
      if (part.text != null) {
        return { type: 'text', text: String(part.text) };
      }
      if (part.functionCall) {
        const fc = part.functionCall as Record<string, unknown>;
        return {
          type: 'tool_use',
          id: `${fc.name}_${index}`, // Generate unique ID to handle multiple calls to same tool
          name: String(fc.name),
          input: (fc.args as Record<string, unknown>) ?? {},
        };
      }
      return { type: 'text', text: JSON.stringify(part) };
    });

    const usageMetadata = (r.usageMetadata as Record<string, number>) ?? {};
    const finishReason = String(candidate.finishReason ?? 'STOP');

    const stopReasonMap: Record<string, CanonicalResponse['stopReason']> = {
      STOP: 'end',
      MAX_TOKENS: 'max_tokens',
      SAFETY: 'content_filter',
      RECITATION: 'content_filter',
      OTHER: 'unknown',
    };

    return {
      id: String(r.id ?? ''),
      model: String(r.model ?? ''),
      content: contentBlocks,
      stopReason: stopReasonMap[finishReason] ?? 'unknown',
      usage: {
        inputTokens: usageMetadata.promptTokenCount ?? 0,
        outputTokens: usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: usageMetadata.totalTokenCount ?? 0,
      },
    };
  }

  responseFromCanonical(res: CanonicalResponse): unknown {
    const parts: Array<Record<string, unknown>> = res.content.map((block) => {
      switch (block.type) {
        case 'text':
          return { text: block.text };
        case 'tool_use':
          return { functionCall: { name: block.name, args: block.input } };
        default:
          return { text: JSON.stringify(block) };
      }
    });

    const stopReasonMap: Record<string, string> = {
      end: 'STOP',
      max_tokens: 'MAX_TOKENS',
      content_filter: 'SAFETY',
      unknown: 'OTHER',
    };

    return {
      candidates: [
        {
          content: { role: 'model', parts },
          finishReason: stopReasonMap[res.stopReason] ?? 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: res.usage.inputTokens,
        candidatesTokenCount: res.usage.outputTokens,
        totalTokenCount: res.usage.totalTokens,
      },
    };
  }

  streamChunkToCanonical(chunk: unknown): CanonicalStreamChunk | null {
    const c = chunk as Record<string, unknown>;
    const candidates = (c.candidates as Array<Record<string, unknown>>) ?? [];
    const candidate = candidates[0];

    if (!candidate) {
      // Check for usage metadata in final chunk
      if (c.usageMetadata) {
        const usage = c.usageMetadata as Record<string, number>;
        return {
          type: 'usage',
          usage: {
            inputTokens: usage.promptTokenCount ?? 0,
            outputTokens: usage.candidatesTokenCount ?? 0,
            totalTokens: usage.totalTokenCount ?? 0,
          },
        };
      }
      return null;
    }

    if (candidate.finishReason) {
      return { type: 'done' };
    }

    const content = (candidate.content as Record<string, unknown>) ?? {};
    const parts = (content.parts as Array<Record<string, unknown>>) ?? [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.text != null) {
        return { type: 'content_delta', delta: { text: String(part.text) } };
      }
      if (part.functionCall) {
        const fc = part.functionCall as Record<string, unknown>;
        return {
          type: 'tool_use_delta',
          delta: {
            toolUseId: `${fc.name}_${i}`, // Generate unique ID to handle multiple calls to same tool
            toolName: String(fc.name),
            inputJson: JSON.stringify(fc.args ?? {}),
          },
        };
      }
    }

    return null;
  }

  streamChunkFromCanonical(chunk: CanonicalStreamChunk): unknown {
    if (chunk.type === 'done') {
      return { candidates: [{ finishReason: 'STOP' }] };
    }
    if (chunk.type === 'content_delta') {
      return {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: chunk.delta?.text ?? '' }] },
          },
        ],
      };
    }
    if (chunk.type === 'tool_use_delta') {
      const args = chunk.delta?.inputJson ? JSON.parse(chunk.delta.inputJson) : {};
      return {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: chunk.delta?.toolName ?? '',
                    args,
                  },
                },
              ],
            },
          },
        ],
      };
    }
    if (chunk.type === 'usage' && chunk.usage) {
      return {
        usageMetadata: {
          promptTokenCount: chunk.usage.inputTokens,
          candidatesTokenCount: chunk.usage.outputTokens,
          totalTokenCount: chunk.usage.totalTokens,
        },
      };
    }
    return null;
  }
}
