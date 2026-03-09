import { describe, expect, it, vi } from 'vitest';
import type { CallProviderFn } from '../core/composer.js';
import { PipelineContext } from '../core/context.js';
import { createTimeoutBudget } from '../core/timeout.js';
import type { CanonicalResponse, ResolvedConfig } from '../core/types.js';
import { ThinkingWrapperComposer } from './thinking-wrapper.js';

function makeConfig(): ResolvedConfig {
  return {
    port: 3000,
    logLevel: 'info',
    requestTimeout: 30_000,
    providers: {},
    routes: [],
  };
}

function makeResponse(
  content: string,
  model = 'gpt-4',
  usage = { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
): CanonicalResponse {
  return {
    id: 'resp-1',
    model,
    content: [{ type: 'text', text: content }],
    stopReason: 'end',
    usage,
  };
}

function makeThinkingResponse(thinking: string, text: string): CanonicalResponse {
  return {
    id: 'resp-1',
    model: 'claude-3.5',
    content: [
      { type: 'thinking', text: thinking },
      { type: 'text', text },
    ],
    stopReason: 'end',
    usage: { inputTokens: 10, outputTokens: 50, totalTokens: 60 },
  };
}

function makeCtx(timeout?: number): PipelineContext {
  return new PipelineContext({
    request: {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Explain quantum computing.' }],
      systemPrompt: 'You are a physicist.',
    },
    config: makeConfig(),
    timeout: createTimeoutBudget(timeout ?? 30_000),
  });
}

describe('ThinkingWrapperComposer', () => {
  it('has type "thinking-wrapper"', () => {
    const composer = new ThinkingWrapperComposer({
      thinkerProvider: 'anthropic',
      executorProvider: 'openai',
    });
    expect(composer.type).toBe('thinking-wrapper');
  });

  it('injects reasoning from thinker into executor', async () => {
    const composer = new ThinkingWrapperComposer({
      thinkerProvider: 'anthropic',
      executorProvider: 'openai',
    });

    const callProvider: CallProviderFn = vi.fn()
      .mockImplementation(async (_req, provider) => {
        if (provider === 'anthropic') {
          return makeResponse('Step 1: quantum bits. Step 2: superposition.', 'claude-3.5');
        }
        return makeResponse('Quantum computing uses qubits...', 'gpt-4');
      });

    const result = await composer.execute(makeCtx(), [], callProvider);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].name).toBe('thinker');
    expect(result.steps[0].status).toBe('success');
    expect(result.steps[1].name).toBe('executor');
    expect(result.steps[1].status).toBe('success');
    expect(result.finalResponse).toBeDefined();
    expect(result.finalResponse!.content.some((b) => b.type === 'text')).toBe(true);

    // Verify executor received the reasoning in its input
    const executorCall = (callProvider as ReturnType<typeof vi.fn>).mock.calls[1];
    const executorReq = executorCall[0];
    expect(executorReq.messages[0].content).toContain('Step 1: quantum bits');
  });

  it('extracts thinking blocks when present', async () => {
    const composer = new ThinkingWrapperComposer({
      thinkerProvider: 'anthropic',
      executorProvider: 'openai',
      includeThinking: true,
    });

    const callProvider: CallProviderFn = vi.fn()
      .mockImplementation(async (_req, provider) => {
        if (provider === 'anthropic') {
          return makeThinkingResponse('Deep analysis here', 'Summary text');
        }
        return makeResponse('Final answer based on analysis.');
      });

    const result = await composer.execute(makeCtx(), [], callProvider);

    // Should include thinking block in final response
    expect(result.finalResponse!.content.some((b) => b.type === 'thinking')).toBe(true);
    const thinkingBlock = result.finalResponse!.content.find((b) => b.type === 'thinking');
    expect(thinkingBlock).toMatchObject({ type: 'thinking', text: 'Deep analysis here' });

    // Executor should have received the thinking content (from thinking block)
    const executorCall = (callProvider as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(executorCall[0].messages[0].content).toContain('Deep analysis here');
  });

  it('excludes thinking from response by default', async () => {
    const composer = new ThinkingWrapperComposer({
      thinkerProvider: 'anthropic',
      executorProvider: 'openai',
      includeThinking: false,
    });

    const callProvider: CallProviderFn = vi.fn()
      .mockImplementation(async (_req, provider) => {
        if (provider === 'anthropic') return makeThinkingResponse('Hidden reasoning', 'Surface');
        return makeResponse('Public answer.');
      });

    const result = await composer.execute(makeCtx(), [], callProvider);
    expect(result.finalResponse!.content.every((b) => b.type !== 'thinking')).toBe(true);
  });

  it('tracks thinking tokens separately in providerExtensions', async () => {
    const composer = new ThinkingWrapperComposer({
      thinkerProvider: 'anthropic',
      executorProvider: 'openai',
    });

    const callProvider: CallProviderFn = vi.fn()
      .mockImplementation(async (_req, provider) => {
        if (provider === 'anthropic') {
          return makeResponse('Reasoning...', 'claude', {
            inputTokens: 100,
            outputTokens: 200,
            totalTokens: 300,
          });
        }
        return makeResponse('Answer.', 'gpt-4', {
          inputTokens: 50,
          outputTokens: 30,
          totalTokens: 80,
        });
      });

    const result = await composer.execute(makeCtx(), [], callProvider);

    // Usage should be combined
    expect(result.finalResponse!.usage.inputTokens).toBe(150);
    expect(result.finalResponse!.usage.outputTokens).toBe(230);
    // Thinking tokens tracked separately
    expect(result.finalResponse!.providerExtensions?.thinkingTokens).toBe(200);
    expect(result.finalResponse!.providerExtensions?.executorTokens).toBe(30);
  });

  it('throws when thinker fails', async () => {
    const composer = new ThinkingWrapperComposer({
      thinkerProvider: 'anthropic',
      executorProvider: 'openai',
    });

    const callProvider: CallProviderFn = vi.fn()
      .mockRejectedValueOnce(new Error('Thinker timeout'));

    await expect(composer.execute(makeCtx(), [], callProvider)).rejects.toThrow(
      /Thinking step failed/,
    );
  });

  it('throws when executor fails', async () => {
    const composer = new ThinkingWrapperComposer({
      thinkerProvider: 'anthropic',
      executorProvider: 'openai',
    });

    const callProvider: CallProviderFn = vi.fn()
      .mockResolvedValueOnce(makeResponse('Reasoning'))
      .mockRejectedValueOnce(new Error('Executor overloaded'));

    await expect(composer.execute(makeCtx(), [], callProvider)).rejects.toThrow(
      /Executor step failed/,
    );
  });

  it('uses custom injection template', async () => {
    const composer = new ThinkingWrapperComposer({
      thinkerProvider: 'anthropic',
      executorProvider: 'openai',
      injectionTemplate: 'THINK: {{thinking}}\nACT:',
    });

    const callProvider: CallProviderFn = vi.fn()
      .mockImplementation(async (_req, provider) => {
        if (provider === 'anthropic') return makeResponse('My analysis');
        return makeResponse('Done');
      });

    await composer.execute(makeCtx(), [], callProvider);

    const executorCall = (callProvider as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(executorCall[0].messages[0].content).toContain('THINK: My analysis');
    expect(executorCall[0].messages[0].content).toContain('ACT:');
  });

  it('respects timeout budget', async () => {
    const composer = new ThinkingWrapperComposer({
      thinkerProvider: 'anthropic',
      executorProvider: 'openai',
    });

    const ctx = makeCtx(1);
    await new Promise((r) => setTimeout(r, 5));

    await expect(composer.execute(ctx, [], vi.fn())).rejects.toThrow(/[Tt]imeout/);
  });
});
