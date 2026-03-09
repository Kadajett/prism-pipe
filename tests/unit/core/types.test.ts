import { describe, expect, it } from 'vitest';
import {
  type CanonicalMessage,
  type CanonicalRequest,
  type CanonicalResponse,
  type CanonicalStreamChunk,
  type ContentBlock,
  isImageContent,
  isTextContent,
  isToolResultContent,
  isToolUseContent,
} from '../../../src/core/types.js';

describe('Core Types', () => {
  describe('Type Exports', () => {
    it('should export all canonical types', () => {
      // This test just ensures the types are exported and compile
      const request: CanonicalRequest = {
        model: 'gpt-4',
        messages: [],
        params: {},
      };

      const response: CanonicalResponse = {
        id: 'test-id',
        content: [],
        stopReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 20 },
        model: 'gpt-4',
        provider: 'openai',
        latencyMs: 100,
      };

      expect(request).toBeDefined();
      expect(response).toBeDefined();
    });
  });

  describe('Content Type Guards', () => {
    it('isTextContent should identify text content', () => {
      const textBlock: ContentBlock = {
        type: 'text',
        text: 'Hello world',
      };

      expect(isTextContent(textBlock)).toBe(true);
      expect(isImageContent(textBlock)).toBe(false);
      expect(isToolUseContent(textBlock)).toBe(false);
      expect(isToolResultContent(textBlock)).toBe(false);
    });

    it('isImageContent should identify image content', () => {
      const imageBlock: ContentBlock = {
        type: 'image',
        source: {
          type: 'url',
          data: 'https://example.com/image.png',
        },
      };

      expect(isImageContent(imageBlock)).toBe(true);
      expect(isTextContent(imageBlock)).toBe(false);
      expect(isToolUseContent(imageBlock)).toBe(false);
      expect(isToolResultContent(imageBlock)).toBe(false);
    });

    it('isToolUseContent should identify tool use content', () => {
      const toolUseBlock: ContentBlock = {
        type: 'tool_use',
        id: 'tool-123',
        name: 'get_weather',
        input: { location: 'San Francisco' },
      };

      expect(isToolUseContent(toolUseBlock)).toBe(true);
      expect(isTextContent(toolUseBlock)).toBe(false);
      expect(isImageContent(toolUseBlock)).toBe(false);
      expect(isToolResultContent(toolUseBlock)).toBe(false);
    });

    it('isToolResultContent should identify tool result content', () => {
      const toolResultBlock: ContentBlock = {
        type: 'tool_result',
        toolUseId: 'tool-123',
        content: [{ type: 'text', text: 'Weather is sunny' }],
      };

      expect(isToolResultContent(toolResultBlock)).toBe(true);
      expect(isTextContent(toolResultBlock)).toBe(false);
      expect(isImageContent(toolResultBlock)).toBe(false);
      expect(isToolUseContent(toolResultBlock)).toBe(false);
    });

    it('should narrow type correctly in if statements', () => {
      const block: ContentBlock = {
        type: 'text',
        text: 'Hello',
      };

      if (isTextContent(block)) {
        // TypeScript should know block.text exists here
        expect(block.text).toBe('Hello');
      }
    });
  });

  describe('CanonicalMessage Structure', () => {
    it('should support system messages', () => {
      const message: CanonicalMessage = {
        role: 'system',
        content: [{ type: 'text', text: 'You are a helpful assistant' }],
      };

      expect(message.role).toBe('system');
      expect(message.content).toHaveLength(1);
    });

    it('should support user messages with text', () => {
      const message: CanonicalMessage = {
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      };

      expect(message.role).toBe('user');
    });

    it('should support user messages with images', () => {
      const message: CanonicalMessage = {
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          {
            type: 'image',
            source: {
              type: 'base64',
              data: 'base64data...',
              mediaType: 'image/png',
            },
          },
        ],
      };

      expect(message.content).toHaveLength(2);
      expect(isTextContent(message.content[0])).toBe(true);
      expect(isImageContent(message.content[1])).toBe(true);
    });

    it('should support assistant messages with tool calls', () => {
      const message: CanonicalMessage = {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'get_weather',
            input: { location: 'NYC' },
          },
        ],
        toolCalls: [
          {
            id: 'tool-1',
            type: 'function',
            function: {
              name: 'get_weather',
              arguments: '{"location":"NYC"}',
            },
          },
        ],
      };

      expect(message.role).toBe('assistant');
      expect(message.toolCalls).toHaveLength(1);
    });

    it('should support tool result messages', () => {
      const message: CanonicalMessage = {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'tool-1',
            content: [{ type: 'text', text: 'Weather is 72°F and sunny' }],
          },
        ],
        toolCallId: 'tool-1',
      };

      expect(message.role).toBe('tool');
      expect(message.toolCallId).toBe('tool-1');
    });
  });

  describe('CanonicalRequest Structure', () => {
    it('should support minimal request', () => {
      const request: CanonicalRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
        params: {},
      };

      expect(request.model).toBe('gpt-4');
      expect(request.messages).toHaveLength(1);
    });

    it('should support request with system prompt', () => {
      const request: CanonicalRequest = {
        model: 'claude-3-sonnet',
        systemPrompt: 'You are a helpful assistant',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
        params: {},
      };

      expect(request.systemPrompt).toBe('You are a helpful assistant');
    });

    it('should support request with all parameters', () => {
      const request: CanonicalRequest = {
        model: 'gpt-4',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ],
        params: {
          temperature: 0.7,
          maxOutputTokens: 1000,
          topP: 0.9,
          topK: 50,
          stop: ['STOP'],
          stream: true,
          responseFormat: { type: 'json_object' },
        },
      };

      expect(request.params.temperature).toBe(0.7);
      expect(request.params.maxOutputTokens).toBe(1000);
      expect(request.params.stream).toBe(true);
    });

    it('should support provider extensions', () => {
      const request: CanonicalRequest = {
        model: 'claude-3',
        messages: [],
        params: {},
        providerExtensions: {
          anthropic: {
            thinking: { type: 'enabled', budget_tokens: 1000 },
          },
        },
      };

      expect(request.providerExtensions).toBeDefined();
      expect(request.providerExtensions?.anthropic).toBeDefined();
    });
  });

  describe('CanonicalResponse Structure', () => {
    it('should support basic response', () => {
      const response: CanonicalResponse = {
        id: 'resp-123',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 5 },
        model: 'gpt-4',
        provider: 'openai',
        latencyMs: 200,
      };

      expect(response.id).toBe('resp-123');
      expect(response.stopReason).toBe('stop');
      expect(response.usage.inputTokens).toBe(10);
      expect(response.latencyMs).toBe(200);
    });

    it('should support all stop reasons', () => {
      const reasons: Array<CanonicalResponse['stopReason']> = [
        'stop',
        'max_tokens',
        'tool_use',
        'content_filter',
        'error',
      ];

      for (const reason of reasons) {
        const response: CanonicalResponse = {
          id: 'test',
          content: [],
          stopReason: reason,
          usage: { inputTokens: 0, outputTokens: 0 },
          model: 'test',
          provider: 'test',
          latencyMs: 0,
        };

        expect(response.stopReason).toBe(reason);
      }
    });
  });

  describe('CanonicalStreamChunk', () => {
    it('should support content_delta chunk', () => {
      const chunk: CanonicalStreamChunk = {
        type: 'content_delta',
        delta: { text: 'Hello' },
      };

      expect(chunk.type).toBe('content_delta');
      if (chunk.type === 'content_delta') {
        expect(chunk.delta.text).toBe('Hello');
      }
    });

    it('should support usage chunk', () => {
      const chunk: CanonicalStreamChunk = {
        type: 'usage',
        usage: { inputTokens: 10, outputTokens: 5 },
      };

      expect(chunk.type).toBe('usage');
      if (chunk.type === 'usage') {
        expect(chunk.usage.inputTokens).toBe(10);
      }
    });

    it('should support done chunk', () => {
      const chunk: CanonicalStreamChunk = {
        type: 'done',
      };

      expect(chunk.type).toBe('done');
    });

    it('should support error chunk', () => {
      const chunk: CanonicalStreamChunk = {
        type: 'error',
        error: {
          message: 'Something went wrong',
          code: 'server_error',
        },
      };

      expect(chunk.type).toBe('error');
      if (chunk.type === 'error') {
        expect(chunk.error.message).toBe('Something went wrong');
      }
    });
  });
});
