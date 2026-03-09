import { describe, it, expect } from 'vitest';
import { GeminiTransformer } from '../../../src/proxy/transforms/gemini.js';
import type { CanonicalRequest, CanonicalResponse } from '../../../src/core/types.js';

describe('GeminiTransformer', () => {
  const t = new GeminiTransformer();

  describe('Request transformation', () => {
    it('converts Gemini request to canonical', () => {
      const raw = {
        model: 'gemini-2.0-flash-exp',
        systemInstruction: { parts: [{ text: 'You are helpful.' }] },
        contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7 },
      };

      const canonical = t.toCanonical(raw);
      expect(canonical.model).toBe('gemini-2.0-flash-exp');
      expect(canonical.systemPrompt).toBe('You are helpful.');
      expect(canonical.messages[0].role).toBe('user');
      expect(canonical.messages[0].content).toBe('Hello');
      expect(canonical.maxTokens).toBe(1024);
      expect(canonical.temperature).toBe(0.7);
    });

    it('converts canonical to Gemini format', () => {
      const canonical: CanonicalRequest = {
        model: 'gemini-2.0-flash-exp',
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'Be helpful.',
        maxTokens: 1024,
        temperature: 0.5,
      };

      const raw = t.fromCanonical(canonical) as Record<string, unknown>;
      expect((raw.systemInstruction as Record<string, unknown>).parts).toEqual([
        { text: 'Be helpful.' },
      ]);
      const contents = raw.contents as Array<Record<string, unknown>>;
      expect(contents[0].role).toBe('user');
      expect((contents[0].parts as Array<Record<string, unknown>>)[0]).toEqual({ text: 'Hello' });
      const config = raw.generationConfig as Record<string, unknown>;
      expect(config.maxOutputTokens).toBe(1024);
      expect(config.temperature).toBe(0.5);
    });

    it('handles assistant role as model role', () => {
      const canonical: CanonicalRequest = {
        model: 'gemini-2.0-flash-exp',
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi there!' },
        ],
      };

      const raw = t.fromCanonical(canonical) as Record<string, unknown>;
      const contents = raw.contents as Array<Record<string, unknown>>;
      expect(contents[1].role).toBe('model');
    });

    it('handles image content blocks', () => {
      const canonical: CanonicalRequest = {
        model: 'gemini-2.0-flash-exp',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this image' },
              {
                type: 'image',
                source: { type: 'base64', mediaType: 'image/jpeg', data: 'base64data' },
              },
            ],
          },
        ],
      };

      const raw = t.fromCanonical(canonical) as Record<string, unknown>;
      const contents = raw.contents as Array<Record<string, unknown>>;
      const parts = contents[0].parts as Array<Record<string, unknown>>;
      expect(parts[0]).toEqual({ text: 'Describe this image' });
      expect((parts[1].inlineData as Record<string, unknown>).data).toBe('base64data');
    });

    it('handles tool definitions', () => {
      const canonical: CanonicalRequest = {
        model: 'gemini-2.0-flash-exp',
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get current weather',
            inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
          },
        ],
      };

      const raw = t.fromCanonical(canonical) as Record<string, unknown>;
      const tools = raw.tools as Array<Record<string, unknown>>;
      const decls = tools[0].functionDeclarations as Array<Record<string, unknown>>;
      expect(decls[0]).toEqual({
        name: 'get_weather',
        description: 'Get current weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      });
    });
  });

  describe('Response transformation', () => {
    it('converts Gemini response to canonical', () => {
      const raw = {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Hello!' }] },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      };

      const canonical = t.responseToCanonical(raw);
      expect(canonical.content[0]).toEqual({ type: 'text', text: 'Hello!' });
      expect(canonical.stopReason).toBe('end');
      expect(canonical.usage.inputTokens).toBe(10);
      expect(canonical.usage.outputTokens).toBe(5);
      expect(canonical.usage.totalTokens).toBe(15);
    });

    it('round-trips response (canonical → gemini → canonical)', () => {
      const original: CanonicalResponse = {
        id: 'resp-1',
        model: 'gemini-2.0-flash-exp',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };

      const gemini = t.responseFromCanonical(original);
      const backToCanonical = t.responseToCanonical(gemini);
      expect(backToCanonical.content[0]).toEqual({ type: 'text', text: 'Hello!' });
      expect(backToCanonical.stopReason).toBe('end');
      expect(backToCanonical.usage.inputTokens).toBe(10);
    });

    it('handles tool calls in response', () => {
      const raw = {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                {
                  functionCall: {
                    name: 'get_weather',
                    args: { city: 'NYC' },
                  },
                },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      };

      const canonical = t.responseToCanonical(raw);
      expect(canonical.content[0].type).toBe('tool_use');
      if (canonical.content[0].type === 'tool_use') {
        expect(canonical.content[0].name).toBe('get_weather');
        expect(canonical.content[0].input).toEqual({ city: 'NYC' });
      }
    });

    it('handles MAX_TOKENS stop reason', () => {
      const raw = {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: 'Hello' }] },
            finishReason: 'MAX_TOKENS',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 100, totalTokenCount: 110 },
      };

      const canonical = t.responseToCanonical(raw);
      expect(canonical.stopReason).toBe('max_tokens');
    });

    it('handles SAFETY stop reason', () => {
      const raw = {
        candidates: [
          {
            content: { role: 'model', parts: [{ text: '' }] },
            finishReason: 'SAFETY',
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 0, totalTokenCount: 10 },
      };

      const canonical = t.responseToCanonical(raw);
      expect(canonical.stopReason).toBe('content_filter');
    });
  });

  describe('Streaming', () => {
    it('handles text content delta', () => {
      const chunk = t.streamChunkToCanonical({
        candidates: [{ content: { role: 'model', parts: [{ text: 'Hello' }] } }],
      });
      expect(chunk?.type).toBe('content_delta');
      expect(chunk?.delta?.text).toBe('Hello');
    });

    it('handles finish with finishReason', () => {
      const chunk = t.streamChunkToCanonical({
        candidates: [{ finishReason: 'STOP' }],
      });
      expect(chunk?.type).toBe('done');
    });

    it('handles usage metadata in final chunk', () => {
      const chunk = t.streamChunkToCanonical({
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      });
      expect(chunk?.type).toBe('usage');
      expect(chunk?.usage?.inputTokens).toBe(10);
      expect(chunk?.usage?.outputTokens).toBe(5);
    });

    it('handles function call in streaming', () => {
      const chunk = t.streamChunkToCanonical({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'get_weather', args: { city: 'NYC' } } }],
            },
          },
        ],
      });
      expect(chunk?.type).toBe('tool_use_delta');
      expect(chunk?.delta?.toolName).toBe('get_weather');
    });

    it('converts canonical streaming chunks to Gemini format', () => {
      const chunk = t.streamChunkFromCanonical({
        type: 'content_delta',
        delta: { text: 'Hello' },
      });
      const c = chunk as Record<string, unknown>;
      const candidates = c.candidates as Array<Record<string, unknown>>;
      expect(candidates[0].content).toBeDefined();
    });
  });

  describe('Capabilities', () => {
    it('reports correct capabilities', () => {
      expect(t.capabilities.supportsTools).toBe(true);
      expect(t.capabilities.supportsVision).toBe(true);
      expect(t.capabilities.supportsStreaming).toBe(true);
      expect(t.capabilities.supportsThinking).toBe(false);
      expect(t.capabilities.supportsSystemPrompt).toBe(true);
    });
  });
});
