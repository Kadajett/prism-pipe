import { describe, it, expect } from 'vitest';
import { OllamaTransformer } from '../../../src/proxy/transforms/ollama.js';
import type { CanonicalRequest, CanonicalResponse } from '../../../src/core/types.js';

describe('OllamaTransformer', () => {
  const t = new OllamaTransformer();

  describe('Request transformation', () => {
    it('converts Ollama request to canonical', () => {
      const raw = {
        model: 'llama2',
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'Hello' },
        ],
        options: { temperature: 0.7, num_predict: 100 },
      };

      const canonical = t.toCanonical(raw);
      expect(canonical.model).toBe('llama2');
      expect(canonical.systemPrompt).toBe('You are helpful.');
      expect(canonical.messages[0].role).toBe('user');
      expect(canonical.messages[0].content).toBe('Hello');
      expect(canonical.temperature).toBe(0.7);
      expect(canonical.maxTokens).toBe(100);
    });

    it('converts canonical to Ollama format', () => {
      const canonical: CanonicalRequest = {
        model: 'llama2',
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'Be helpful.',
        maxTokens: 100,
        temperature: 0.5,
      };

      const raw = t.fromCanonical(canonical) as Record<string, unknown>;
      const messages = raw.messages as Array<Record<string, unknown>>;
      expect(messages[0]).toEqual({ role: 'system', content: 'Be helpful.' });
      expect(messages[1]).toEqual({ role: 'user', content: 'Hello' });
      const options = raw.options as Record<string, unknown>;
      expect(options.num_predict).toBe(100);
      expect(options.temperature).toBe(0.5);
    });

    it('handles tool calls in request', () => {
      const canonical: CanonicalRequest = {
        model: 'llama2',
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
      expect(tools[0]).toEqual({
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get current weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      });
    });

    it('handles image content blocks', () => {
      const canonical: CanonicalRequest = {
        model: 'llava',
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
      const messages = raw.messages as Array<Record<string, unknown>>;
      const content = messages[0].content as Array<Record<string, unknown>>;
      expect(content[0]).toEqual({ type: 'text', text: 'Describe this image' });
      expect((content[1].image_url as Record<string, string>).url).toContain('base64');
    });

    it('handles empty options object', () => {
      const canonical: CanonicalRequest = {
        model: 'llama2',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const raw = t.fromCanonical(canonical) as Record<string, unknown>;
      expect(raw.options).toBeUndefined();
    });
  });

  describe('Response transformation', () => {
    it('converts Ollama response to canonical', () => {
      const raw = {
        model: 'llama2',
        message: { role: 'assistant', content: 'Hello!' },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      };

      const canonical = t.responseToCanonical(raw);
      expect(canonical.content[0]).toEqual({ type: 'text', text: 'Hello!' });
      expect(canonical.stopReason).toBe('end');
      expect(canonical.usage.inputTokens).toBe(10);
      expect(canonical.usage.outputTokens).toBe(5);
      expect(canonical.usage.totalTokens).toBe(15);
    });

    it('round-trips response (canonical → ollama → canonical)', () => {
      const original: CanonicalResponse = {
        id: 'resp-1',
        model: 'llama2',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };

      const ollama = t.responseFromCanonical(original);
      const backToCanonical = t.responseToCanonical(ollama);
      expect(backToCanonical.content[0]).toEqual({ type: 'text', text: 'Hello!' });
      expect(backToCanonical.stopReason).toBe('end');
      expect(backToCanonical.usage.inputTokens).toBe(10);
    });

    it('handles tool calls in response', () => {
      const raw = {
        model: 'llama2',
        message: {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"city":"NYC"}',
              },
            },
          ],
        },
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      };

      const canonical = t.responseToCanonical(raw);
      expect(canonical.content[0].type).toBe('tool_use');
      if (canonical.content[0].type === 'tool_use') {
        expect(canonical.content[0].name).toBe('get_weather');
        expect(canonical.content[0].input).toEqual({ city: 'NYC' });
      }
    });

    it('handles missing usage counts', () => {
      const raw = {
        model: 'llama2',
        message: { role: 'assistant', content: 'Hello!' },
        done: true,
      };

      const canonical = t.responseToCanonical(raw);
      expect(canonical.usage.inputTokens).toBe(0);
      expect(canonical.usage.outputTokens).toBe(0);
    });
  });

  describe('Streaming', () => {
    it('handles content delta', () => {
      const chunk = t.streamChunkToCanonical({
        message: { role: 'assistant', content: 'Hello' },
      });
      expect(chunk?.type).toBe('content_delta');
      expect(chunk?.delta?.text).toBe('Hello');
    });

    it('handles done signal', () => {
      const chunk = t.streamChunkToCanonical({ done: true });
      expect(chunk?.type).toBe('done');
    });

    it('handles done with usage stats', () => {
      const chunk = t.streamChunkToCanonical({
        done: true,
        prompt_eval_count: 10,
        eval_count: 5,
      });
      expect(chunk?.type).toBe('usage');
      expect(chunk?.usage?.inputTokens).toBe(10);
      expect(chunk?.usage?.outputTokens).toBe(5);
    });

    it('handles tool call in streaming', () => {
      const chunk = t.streamChunkToCanonical({
        message: {
          role: 'assistant',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"NYC"}' },
            },
          ],
        },
      });
      expect(chunk?.type).toBe('tool_use_delta');
      expect(chunk?.delta?.toolName).toBe('get_weather');
    });

    it('converts canonical streaming chunks to Ollama format', () => {
      const chunk = t.streamChunkFromCanonical({
        type: 'content_delta',
        delta: { text: 'Hello' },
      });
      const c = chunk as Record<string, unknown>;
      expect((c.message as Record<string, unknown>).content).toBe('Hello');
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
