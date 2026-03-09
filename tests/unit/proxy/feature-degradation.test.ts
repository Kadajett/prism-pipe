import { describe, it, expect, vi } from 'vitest';
import { withFeatureDegradation } from '../../../src/proxy/feature-degradation.js';
import type { ProviderTransformer } from '../../../src/proxy/transform-registry.js';
import type { CanonicalRequest, ProviderCapabilities } from '../../../src/core/types.js';

describe('FeatureDegradationWrapper', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const createMockTransformer = (
    capabilities: Partial<ProviderCapabilities>
  ): ProviderTransformer => ({
    provider: 'test-provider',
    capabilities: {
      supportsTools: false,
      supportsVision: false,
      supportsStreaming: true,
      supportsThinking: false,
      supportsSystemPrompt: true,
      ...capabilities,
    },
    toCanonical: vi.fn(),
    fromCanonical: vi.fn((req) => req),
    responseToCanonical: vi.fn(),
    responseFromCanonical: vi.fn(),
    streamChunkToCanonical: vi.fn(),
    streamChunkFromCanonical: vi.fn(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tools degradation', () => {
    it('converts tools to system prompt when not supported', () => {
      const mockTransformer = createMockTransformer({ supportsTools: false });
      const wrapped = withFeatureDegradation(mockTransformer, mockLogger);

      const request: CanonicalRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get current weather',
            inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
          },
        ],
      };

      wrapped.fromCanonical(request);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Provider does not support tools, converting to system prompt',
        expect.objectContaining({ provider: 'test-provider', toolCount: 1 })
      );

      expect(mockTransformer.fromCanonical).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining('get_weather'),
          tools: undefined,
        })
      );
    });

    it('preserves tools when supported', () => {
      const mockTransformer = createMockTransformer({ supportsTools: true });
      const wrapped = withFeatureDegradation(mockTransformer, mockLogger);

      const request: CanonicalRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: [
          {
            name: 'get_weather',
            description: 'Get current weather',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      };

      wrapped.fromCanonical(request);

      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockTransformer.fromCanonical).toHaveBeenCalledWith(
        expect.objectContaining({ tools: request.tools })
      );
    });
  });

  describe('Vision degradation', () => {
    it('strips images when not supported', () => {
      const mockTransformer = createMockTransformer({ supportsVision: false });
      const wrapped = withFeatureDegradation(mockTransformer, mockLogger);

      const request: CanonicalRequest = {
        model: 'test-model',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this' },
              {
                type: 'image',
                source: { type: 'base64', mediaType: 'image/jpeg', data: 'base64data' },
              },
            ],
          },
        ],
      };

      wrapped.fromCanonical(request);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Provider does not support vision, stripping images',
        expect.objectContaining({ provider: 'test-provider', role: 'user' })
      );

      expect(mockTransformer.fromCanonical).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              role: 'user',
              content: [{ type: 'text', text: 'Describe this' }],
            },
          ],
        })
      );
    });

    it('preserves images when supported', () => {
      const mockTransformer = createMockTransformer({ supportsVision: true });
      const wrapped = withFeatureDegradation(mockTransformer, mockLogger);

      const request: CanonicalRequest = {
        model: 'test-model',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Describe this' },
              {
                type: 'image',
                source: { type: 'base64', mediaType: 'image/jpeg', data: 'base64data' },
              },
            ],
          },
        ],
      };

      wrapped.fromCanonical(request);

      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockTransformer.fromCanonical).toHaveBeenCalledWith(
        expect.objectContaining({ messages: request.messages })
      );
    });
  });

  describe('Thinking degradation', () => {
    it('converts thinking blocks to system prompt when not supported', () => {
      const mockTransformer = createMockTransformer({ supportsThinking: false });
      const wrapped = withFeatureDegradation(mockTransformer, mockLogger);

      const request: CanonicalRequest = {
        model: 'test-model',
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', text: 'Let me think...' },
              { type: 'text', text: 'Here is my answer' },
            ],
          },
        ],
      };

      wrapped.fromCanonical(request);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Provider does not support thinking blocks, adding step-by-step instruction',
        expect.objectContaining({ provider: 'test-provider' })
      );

      expect(mockTransformer.fromCanonical).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining('Think step by step'),
          messages: [
            {
              role: 'assistant',
              content: [{ type: 'text', text: 'Here is my answer' }],
            },
          ],
        })
      );
    });

    it('preserves thinking blocks when supported', () => {
      const mockTransformer = createMockTransformer({ supportsThinking: true });
      const wrapped = withFeatureDegradation(mockTransformer, mockLogger);

      const request: CanonicalRequest = {
        model: 'test-model',
        messages: [
          {
            role: 'assistant',
            content: [
              { type: 'thinking', text: 'Let me think...' },
              { type: 'text', text: 'Here is my answer' },
            ],
          },
        ],
      };

      wrapped.fromCanonical(request);

      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockTransformer.fromCanonical).toHaveBeenCalledWith(
        expect.objectContaining({ messages: request.messages })
      );
    });
  });

  describe('System prompt degradation', () => {
    it('converts system prompt to user message when not supported', () => {
      const mockTransformer = createMockTransformer({ supportsSystemPrompt: false });
      const wrapped = withFeatureDegradation(mockTransformer, mockLogger);

      const request: CanonicalRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are helpful',
      };

      wrapped.fromCanonical(request);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Provider does not support system prompts, converting to user message',
        expect.objectContaining({ provider: 'test-provider' })
      );

      expect(mockTransformer.fromCanonical).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: undefined,
          messages: [
            { role: 'user', content: 'System instructions: You are helpful' },
            { role: 'user', content: 'Hello' },
          ],
        })
      );
    });

    it('preserves system prompt when supported', () => {
      const mockTransformer = createMockTransformer({ supportsSystemPrompt: true });
      const wrapped = withFeatureDegradation(mockTransformer, mockLogger);

      const request: CanonicalRequest = {
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are helpful',
      };

      wrapped.fromCanonical(request);

      expect(mockLogger.warn).not.toHaveBeenCalled();
      expect(mockTransformer.fromCanonical).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: 'You are helpful' })
      );
    });
  });

  describe('Multiple degradations', () => {
    it('handles multiple unsupported features at once', () => {
      const mockTransformer = createMockTransformer({
        supportsTools: false,
        supportsVision: false,
        supportsThinking: false,
      });
      const wrapped = withFeatureDegradation(mockTransformer, mockLogger);

      const request: CanonicalRequest = {
        model: 'test-model',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Hello' },
              {
                type: 'image',
                source: { type: 'base64', mediaType: 'image/jpeg', data: 'data' },
              },
            ],
          },
          {
            role: 'assistant',
            content: [
              { type: 'thinking', text: 'Thinking...' },
              { type: 'text', text: 'Response' },
            ],
          },
        ],
        tools: [
          {
            name: 'tool',
            description: 'A tool',
            inputSchema: { type: 'object' },
          },
        ],
      };

      wrapped.fromCanonical(request);

      expect(mockLogger.warn).toHaveBeenCalledTimes(3);
      expect(mockTransformer.fromCanonical).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining('Available Tools'),
          tools: undefined,
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.not.arrayContaining([expect.objectContaining({ type: 'image' })]),
            }),
          ]),
        })
      );
    });
  });

  describe('Passthrough methods', () => {
    it('passes through toCanonical', () => {
      const mockTransformer = createMockTransformer({});
      const wrapped = withFeatureDegradation(mockTransformer, mockLogger);

      const raw = { model: 'test', messages: [] };
      wrapped.toCanonical(raw);

      expect(mockTransformer.toCanonical).toHaveBeenCalledWith(raw);
    });

    it('passes through response methods', () => {
      const mockTransformer = createMockTransformer({});
      const wrapped = withFeatureDegradation(mockTransformer, mockLogger);

      const response = { id: 'test', content: [] };
      wrapped.responseToCanonical(response);
      wrapped.responseFromCanonical(response);

      expect(mockTransformer.responseToCanonical).toHaveBeenCalledWith(response);
      expect(mockTransformer.responseFromCanonical).toHaveBeenCalledWith(response);
    });

    it('passes through streaming methods', () => {
      const mockTransformer = createMockTransformer({});
      const wrapped = withFeatureDegradation(mockTransformer, mockLogger);

      const chunk = { type: 'content_delta' };
      wrapped.streamChunkToCanonical(chunk);
      wrapped.streamChunkFromCanonical(chunk);

      expect(mockTransformer.streamChunkToCanonical).toHaveBeenCalledWith(chunk);
      expect(mockTransformer.streamChunkFromCanonical).toHaveBeenCalledWith(chunk);
    });
  });
});
