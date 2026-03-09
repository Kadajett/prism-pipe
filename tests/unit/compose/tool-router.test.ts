import { describe, it, expect, vi } from 'vitest';
import { ToolRouterComposer } from '../../../src/compose/tool-router.js';
import type { CanonicalRequest, CanonicalResponse } from '../../../src/core/types.js';

describe('ToolRouterComposer', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  it('returns response when no tool calls are made', async () => {
    const composer = new ToolRouterComposer(
      {
        primary: 'anthropic/claude-sonnet',
        tools: {},
      },
      mockLogger
    );

    const request: CanonicalRequest = {
      model: 'anthropic/claude-sonnet',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    const mockResponse: CanonicalResponse = {
      id: 'resp-1',
      model: 'anthropic/claude-sonnet',
      content: [{ type: 'text', text: 'Hi there!' }],
      stopReason: 'end',
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
    };

    const providerCall = vi.fn().mockResolvedValue(mockResponse);
    const result = await composer.execute(request, providerCall);

    expect(result).toEqual(mockResponse);
    expect(providerCall).toHaveBeenCalledTimes(1);
  });

  it('executes tool call routed to provider', async () => {
    const composer = new ToolRouterComposer(
      {
        primary: 'anthropic/claude-sonnet',
        tools: {
          web_search: { provider: 'perplexity/sonar' },
        },
      },
      mockLogger
    );

    const request: CanonicalRequest = {
      model: 'anthropic/claude-sonnet',
      messages: [{ role: 'user', content: 'Search for AI news' }],
    };

    // First call returns tool use
    const toolResponse: CanonicalResponse = {
      id: 'resp-1',
      model: 'anthropic/claude-sonnet',
      content: [
        {
          type: 'tool_use',
          id: 'tu-1',
          name: 'web_search',
          input: { query: 'AI news' },
        },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    // Tool provider response
    const toolProviderResponse: CanonicalResponse = {
      id: 'resp-2',
      model: 'perplexity/sonar',
      content: [{ type: 'text', text: 'Here are the latest AI news...' }],
      stopReason: 'end',
      usage: { inputTokens: 5, outputTokens: 20, totalTokens: 25 },
    };

    // Final response after tool result
    const finalResponse: CanonicalResponse = {
      id: 'resp-3',
      model: 'anthropic/claude-sonnet',
      content: [{ type: 'text', text: 'Based on the search results...' }],
      stopReason: 'end',
      usage: { inputTokens: 30, outputTokens: 15, totalTokens: 45 },
    };

    const providerCall = vi
      .fn()
      .mockResolvedValueOnce(toolResponse)
      .mockResolvedValueOnce(toolProviderResponse)
      .mockResolvedValueOnce(finalResponse);

    const result = await composer.execute(request, providerCall);

    expect(result).toEqual(finalResponse);
    expect(providerCall).toHaveBeenCalledTimes(3);
    // Check that perplexity was called
    expect(providerCall).toHaveBeenCalledWith('perplexity/sonar', expect.any(Object));
  });

  it('handles tool execution error', async () => {
    const composer = new ToolRouterComposer(
      {
        primary: 'anthropic/claude-sonnet',
        tools: {
          broken_tool: { provider: 'some/provider' },
        },
      },
      mockLogger
    );

    const request: CanonicalRequest = {
      model: 'anthropic/claude-sonnet',
      messages: [{ role: 'user', content: 'Use broken tool' }],
    };

    const toolResponse: CanonicalResponse = {
      id: 'resp-1',
      model: 'anthropic/claude-sonnet',
      content: [
        {
          type: 'tool_use',
          id: 'tu-1',
          name: 'broken_tool',
          input: {},
        },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    const finalResponse: CanonicalResponse = {
      id: 'resp-2',
      model: 'anthropic/claude-sonnet',
      content: [{ type: 'text', text: 'The tool failed, but here is my response...' }],
      stopReason: 'end',
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    };

    const providerCall = vi
      .fn()
      .mockResolvedValueOnce(toolResponse)
      .mockRejectedValueOnce(new Error('Provider error'))
      .mockResolvedValueOnce(finalResponse);

    const result = await composer.execute(request, providerCall);

    expect(result).toEqual(finalResponse);
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Tool execution failed',
      expect.objectContaining({ tool: 'broken_tool' })
    );
  });

  it('handles missing tool handler', async () => {
    const composer = new ToolRouterComposer(
      {
        primary: 'anthropic/claude-sonnet',
        tools: {},
      },
      mockLogger
    );

    const request: CanonicalRequest = {
      model: 'anthropic/claude-sonnet',
      messages: [{ role: 'user', content: 'Use unknown tool' }],
    };

    const toolResponse: CanonicalResponse = {
      id: 'resp-1',
      model: 'anthropic/claude-sonnet',
      content: [
        {
          type: 'tool_use',
          id: 'tu-1',
          name: 'unknown_tool',
          input: {},
        },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    const finalResponse: CanonicalResponse = {
      id: 'resp-2',
      model: 'anthropic/claude-sonnet',
      content: [{ type: 'text', text: 'Tool not found' }],
      stopReason: 'end',
      usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
    };

    const providerCall = vi
      .fn()
      .mockResolvedValueOnce(toolResponse)
      .mockResolvedValueOnce(finalResponse);

    const result = await composer.execute(request, providerCall);

    expect(result).toEqual(finalResponse);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'No handler configured for tool',
      expect.objectContaining({ tool: 'unknown_tool' })
    );
  });

  it('respects maxRounds limit', async () => {
    const composer = new ToolRouterComposer(
      {
        primary: 'anthropic/claude-sonnet',
        maxRounds: 2,
        tools: {
          infinite_tool: { provider: 'some/provider' },
        },
      },
      mockLogger
    );

    const request: CanonicalRequest = {
      model: 'anthropic/claude-sonnet',
      messages: [{ role: 'user', content: 'Loop forever' }],
    };

    // Always return tool use
    const toolResponse: CanonicalResponse = {
      id: 'resp-1',
      model: 'anthropic/claude-sonnet',
      content: [
        {
          type: 'tool_use',
          id: 'tu-1',
          name: 'infinite_tool',
          input: {},
        },
      ],
      stopReason: 'tool_use',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };

    const toolProviderResponse: CanonicalResponse = {
      id: 'resp-2',
      model: 'some/provider',
      content: [{ type: 'text', text: 'Tool result' }],
      stopReason: 'end',
      usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    };

    const providerCall = vi.fn().mockImplementation((provider) => {
      if (provider === 'anthropic/claude-sonnet') {
        return Promise.resolve(toolResponse);
      }
      return Promise.resolve(toolProviderResponse);
    });

    await expect(composer.execute(request, providerCall)).rejects.toThrow(
      'Tool router exceeded max rounds'
    );
  });

  it('handles multi-turn tool use', async () => {
    const composer = new ToolRouterComposer(
      {
        primary: 'anthropic/claude-sonnet',
        maxRounds: 5,
        tools: {
          tool_a: { provider: 'provider/a' },
          tool_b: { provider: 'provider/b' },
        },
      },
      mockLogger
    );

    const request: CanonicalRequest = {
      model: 'anthropic/claude-sonnet',
      messages: [{ role: 'user', content: 'Use both tools' }],
    };

    const responses = [
      // Round 1: Call tool_a
      {
        id: 'resp-1',
        model: 'anthropic/claude-sonnet',
        content: [{ type: 'tool_use' as const, id: 'tu-1', name: 'tool_a', input: {} }],
        stopReason: 'tool_use' as const,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
      // Tool A response
      {
        id: 'resp-2',
        model: 'provider/a',
        content: [{ type: 'text' as const, text: 'Result A' }],
        stopReason: 'end' as const,
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      },
      // Round 2: Call tool_b
      {
        id: 'resp-3',
        model: 'anthropic/claude-sonnet',
        content: [{ type: 'tool_use' as const, id: 'tu-2', name: 'tool_b', input: {} }],
        stopReason: 'tool_use' as const,
        usage: { inputTokens: 20, outputTokens: 5, totalTokens: 25 },
      },
      // Tool B response
      {
        id: 'resp-4',
        model: 'provider/b',
        content: [{ type: 'text' as const, text: 'Result B' }],
        stopReason: 'end' as const,
        usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      },
      // Final response
      {
        id: 'resp-5',
        model: 'anthropic/claude-sonnet',
        content: [{ type: 'text' as const, text: 'Combined results' }],
        stopReason: 'end' as const,
        usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
      },
    ];

    let callIndex = 0;
    const providerCall = vi.fn().mockImplementation(() => {
      return Promise.resolve(responses[callIndex++]);
    });

    const result = await composer.execute(request, providerCall);

    expect(result.content[0]).toEqual({ type: 'text', text: 'Combined results' });
    expect(providerCall).toHaveBeenCalledTimes(5);
  });
});
