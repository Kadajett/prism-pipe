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
  isThinkingContent,
} from '../../../src/core/types.js';

describe('Core Types', () => {
  describe('Type Exports', () => {
    it('should export all canonical types', () => {
      const request: CanonicalRequest = {
        model: 'gpt-4',
        messages: [],
      };

      const response: CanonicalResponse = {
        id: 'test-id',
        model: 'gpt-4',
        content: [],
        stopReason: 'end',
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      };

      expect(request).toBeDefined();
      expect(response).toBeDefined();
    });
  });

  describe('Content Type Guards', () => {
    it('isTextContent should identify text content', () => {
      const textBlock: ContentBlock = { type: 'text', text: 'Hello world' };

      expect(isTextContent(textBlock)).toBe(true);
      expect(isImageContent(textBlock)).toBe(false);
      expect(isToolUseContent(textBlock)).toBe(false);
      expect(isToolResultContent(textBlock)).toBe(false);
    });

    it('isImageContent should identify image content', () => {
      const imageBlock: ContentBlock = {
        type: 'image',
        source: { type: 'url', url: 'https://example.com/image.png' },
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
        content: 'Weather is sunny',
      };

      expect(isToolResultContent(toolResultBlock)).toBe(true);
      expect(isTextContent(toolResultBlock)).toBe(false);
      expect(isImageContent(toolResultBlock)).toBe(false);
      expect(isToolUseContent(toolResultBlock)).toBe(false);
    });

    it('isThinkingContent should identify thinking content', () => {
      const thinkingBlock: ContentBlock = { type: 'thinking', text: 'Let me think...' };

      expect(isThinkingContent(thinkingBlock)).toBe(true);
      expect(isTextContent(thinkingBlock)).toBe(false);
    });

    it('should narrow type correctly in if statements', () => {
      const block: ContentBlock = { type: 'text', text: 'Hello' };

      if (isTextContent(block)) {
        expect(block.text).toBe('Hello');
      }
    });
  });

  describe('CanonicalMessage Structure', () => {
    it('should support system messages', () => {
      const message: CanonicalMessage = {
        role: 'system',
        content: 'You are a helpful assistant',
      };

      expect(message.role).toBe('system');
    });

    it('should support user messages with text', () => {
      const message: CanonicalMessage = {
        role: 'user',
        content: 'Hello',
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
            source: { type: 'base64', mediaType: 'image/png', data: 'base64data...' },
          },
        ],
      };

      expect(message.content).toHaveLength(2);
      expect(isTextContent((message.content as ContentBlock[])[0])).toBe(true);
      expect(isImageContent((message.content as ContentBlock[])[1])).toBe(true);
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
      };

      expect(message.role).toBe('assistant');
      expect((message.content as ContentBlock[])).toHaveLength(1);
    });

    it('should support tool result messages', () => {
      const message: CanonicalMessage = {
        role: 'tool',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'tool-1',
            content: 'Weather is 72°F and sunny',
          },
        ],
      };

      expect(message.role).toBe('tool');
    });
  });

  describe('CanonicalRequest Structure', () => {
    it('should support minimal request', () => {
      const request: CanonicalRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      expect(request.model).toBe('gpt-4');
      expect(request.messages).toHaveLength(1);
    });

    it('should support request with system prompt', () => {
      const request: CanonicalRequest = {
        model: 'claude-3-sonnet',
        systemPrompt: 'You are a helpful assistant',
        messages: [{ role: 'user', content: 'Hello' }],
      };

      expect(request.systemPrompt).toBe('You are a helpful assistant');
    });

    it('should support request with all parameters', () => {
      const request: CanonicalRequest = {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        maxTokens: 1000,
        topP: 0.9,
        stopSequences: ['STOP'],
        stream: true,
      };

      expect(request.temperature).toBe(0.7);
      expect(request.maxTokens).toBe(1000);
      expect(request.stream).toBe(true);
    });

    it('should support provider extensions', () => {
      const request: CanonicalRequest = {
        model: 'claude-3',
        messages: [],
        providerExtensions: {
          anthropic: { thinking: { type: 'enabled', budget_tokens: 1000 } },
        },
      };

      expect(request.providerExtensions).toBeDefined();
    });
  });

  describe('CanonicalResponse Structure', () => {
    it('should support basic response', () => {
      const response: CanonicalResponse = {
        id: 'resp-123',
        model: 'gpt-4',
        content: [{ type: 'text', text: 'Hello!' }],
        stopReason: 'end',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };

      expect(response.id).toBe('resp-123');
      expect(response.stopReason).toBe('end');
      expect(response.usage.inputTokens).toBe(10);
    });

    it('should support all stop reasons', () => {
      const reasons: Array<CanonicalResponse['stopReason']> = [
        'end', 'max_tokens', 'tool_use', 'stop_sequence', 'content_filter', 'unknown',
      ];

      for (const reason of reasons) {
        const response: CanonicalResponse = {
          id: 'test',
          model: 'test',
          content: [],
          stopReason: reason,
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
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
      expect(chunk.delta?.text).toBe('Hello');
    });

    it('should support usage chunk', () => {
      const chunk: CanonicalStreamChunk = {
        type: 'usage',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };

      expect(chunk.type).toBe('usage');
      expect(chunk.usage?.inputTokens).toBe(10);
    });

    it('should support done chunk', () => {
      const chunk: CanonicalStreamChunk = { type: 'done' };
      expect(chunk.type).toBe('done');
    });

    it('should support error chunk', () => {
      const chunk: CanonicalStreamChunk = {
        type: 'error',
        error: { message: 'Something went wrong', code: 'server_error' },
      };

      expect(chunk.type).toBe('error');
      expect(chunk.error?.message).toBe('Something went wrong');
    });
  });
});
