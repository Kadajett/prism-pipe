import { describe, expect, it, vi } from 'vitest';
import type { CallProviderFn, CompositionStep } from '../core/composer.js';
import { PipelineContext } from '../core/context.js';
import { createTimeoutBudget } from '../core/timeout.js';
import type { CanonicalResponse, ResolvedConfig } from '../core/types.js';
import { PipelineError } from '../core/types.js';
import { ForkJoinComposer } from './fork-join.js';

function makeConfig(): ResolvedConfig {
  return {
    port: 3000,
    logLevel: 'info',
    requestTimeout: 30_000,
    providers: {},
    routes: [],
  };
}

function makeResponse(content: string, model = 'gpt-4'): CanonicalResponse {
  return {
    id: 'resp-1',
    model,
    content: [{ type: 'text', text: content }],
    stopReason: 'end',
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  };
}

function makeCtx(timeout?: number): PipelineContext {
  return new PipelineContext({
    request: {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'What is 2+2?' }],
      systemPrompt: 'You are a math tutor.',
    },
    config: makeConfig(),
    timeout: createTimeoutBudget(timeout ?? 30_000),
  });
}

describe('ForkJoinComposer', () => {
  it('has type "fork-join"', () => {
    const composer = new ForkJoinComposer();
    expect(composer.type).toBe('fork-join');
  });

  it('executes steps in parallel and concatenates by default', async () => {
    const composer = new ForkJoinComposer({ merge: 'concatenate' });
    const callProvider: CallProviderFn = vi.fn()
      .mockImplementation(async (_req, provider) => {
        if (provider === 'openai') return makeResponse('OpenAI says 4');
        return makeResponse('Anthropic says 4');
      });

    const steps: CompositionStep[] = [
      { name: 'fork-a', provider: 'openai' },
      { name: 'fork-b', provider: 'anthropic' },
    ];

    const result = await composer.execute(makeCtx(), steps, callProvider);

    expect(result.steps).toHaveLength(2);
    expect(result.steps.every((s) => s.status === 'success')).toBe(true);
    expect(result.finalResponse).toBeDefined();
    expect(result.finalResponse!.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('OpenAI says 4'),
    });
    expect(result.finalResponse!.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Anthropic says 4'),
    });
    // Both providers called
    expect(callProvider).toHaveBeenCalledTimes(2);
  });

  it('handles partial fork failures gracefully', async () => {
    const composer = new ForkJoinComposer({ merge: 'concatenate', minSuccessful: 1 });
    const callProvider: CallProviderFn = vi.fn()
      .mockImplementation(async (_req, provider) => {
        if (provider === 'failing') throw new Error('Provider down');
        return makeResponse('Working response');
      });

    const steps: CompositionStep[] = [
      { name: 'good', provider: 'working' },
      { name: 'bad', provider: 'failing' },
    ];

    const result = await composer.execute(makeCtx(), steps, callProvider);

    expect(result.steps).toHaveLength(2);
    expect(result.steps.find((s) => s.name === 'good')!.status).toBe('success');
    expect(result.steps.find((s) => s.name === 'bad')!.status).toBe('error');
    expect(result.finalResponse).toBeDefined();
  });

  it('throws when too few forks succeed', async () => {
    const composer = new ForkJoinComposer({ merge: 'concatenate', minSuccessful: 2 });
    const callProvider: CallProviderFn = vi.fn()
      .mockImplementation(async (_req, provider) => {
        if (provider === 'failing') throw new Error('Provider down');
        return makeResponse('OK');
      });

    const steps: CompositionStep[] = [
      { name: 'good', provider: 'working' },
      { name: 'bad', provider: 'failing' },
    ];

    await expect(composer.execute(makeCtx(), steps, callProvider)).rejects.toThrow(
      /only 1\/2 forks succeeded/,
    );
  });

  it('vote strategy picks most common response', async () => {
    const composer = new ForkJoinComposer({ merge: 'vote' });
    const callProvider: CallProviderFn = vi.fn()
      .mockResolvedValueOnce(makeResponse('4'))
      .mockResolvedValueOnce(makeResponse('4'))
      .mockResolvedValueOnce(makeResponse('5'));

    const steps: CompositionStep[] = [
      { name: 'a', provider: 'p1' },
      { name: 'b', provider: 'p2' },
      { name: 'c', provider: 'p3' },
    ];

    const result = await composer.execute(makeCtx(), steps, callProvider);
    expect(result.finalResponse!.content[0]).toMatchObject({ type: 'text', text: '4' });
  });

  it('best-of strategy calls judge model', async () => {
    const composer = new ForkJoinComposer({
      merge: 'best-of',
      mergeProvider: 'judge',
      mergeModel: 'gpt-4-judge',
    });

    const callProvider: CallProviderFn = vi.fn()
      .mockImplementation(async (_req, provider) => {
        if (provider === 'judge') return makeResponse('The best answer is 4.');
        if (provider === 'p1') return makeResponse('I think 4');
        return makeResponse('Maybe 4?');
      });

    const steps: CompositionStep[] = [
      { name: 'a', provider: 'p1' },
      { name: 'b', provider: 'p2' },
    ];

    const result = await composer.execute(makeCtx(), steps, callProvider);

    // 2 fork calls + 1 judge call
    expect(callProvider).toHaveBeenCalledTimes(3);
    expect(result.finalResponse!.content[0]).toMatchObject({
      type: 'text',
      text: 'The best answer is 4.',
    });
  });

  it('best-of requires mergeProvider', async () => {
    const composer = new ForkJoinComposer({ merge: 'best-of' });
    const steps: CompositionStep[] = [{ name: 'a', provider: 'p1' }];

    await expect(composer.execute(makeCtx(), steps, vi.fn())).rejects.toThrow(
      /mergeProvider/,
    );
  });

  it('rejects empty steps', async () => {
    const composer = new ForkJoinComposer();
    await expect(composer.execute(makeCtx(), [], vi.fn())).rejects.toThrow(
      /at least one step/,
    );
  });

  it('respects timeout budget', async () => {
    const composer = new ForkJoinComposer({ merge: 'concatenate' });
    // Create context with 1ms timeout — will expire immediately
    const ctx = makeCtx(1);
    // Burn the budget
    await new Promise((r) => setTimeout(r, 5));

    const callProvider: CallProviderFn = vi.fn().mockResolvedValue(makeResponse('OK'));
    const steps: CompositionStep[] = [{ name: 'a', provider: 'p1' }];

    // Should still return (error status on step) but with minSuccessful=1, it throws
    await expect(composer.execute(ctx, steps, callProvider)).rejects.toThrow();
  });
});
