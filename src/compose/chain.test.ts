import { describe, expect, it, vi } from 'vitest';
import type { CallProviderFn, CompositionStep } from '../core/composer';
import { PipelineContext } from '../core/context';
import { createTimeoutBudget } from '../core/timeout';
import type { CanonicalResponse, ResolvedConfig } from '../core/types';
import { PipelineError } from '../core/types';
import { ChainComposer } from './chain';

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

describe('ChainComposer', () => {
  const composer = new ChainComposer();

  it('has type "chain"', () => {
    expect(composer.type).toBe('chain');
  });

  it('executes steps sequentially with template resolution', async () => {
    const callProvider: CallProviderFn = vi.fn()
      .mockResolvedValueOnce(makeResponse('I think the answer is 4'))
      .mockResolvedValueOnce(makeResponse('The answer is definitely 4.'));

    const steps: CompositionStep[] = [
      { name: 'thinker', provider: 'openai' },
      {
        name: 'writer',
        provider: 'openai',
        inputTransform: 'Rewrite this clearly: {{steps.thinker.content}}',
      },
    ];

    const ctx = makeCtx();
    const result = await composer.execute(ctx, steps, callProvider);

    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].name).toBe('thinker');
    expect(result.steps[0].content).toBe('I think the answer is 4');
    expect(result.steps[0].status).toBe('success');
    expect(result.steps[1].name).toBe('writer');
    expect(result.steps[1].content).toBe('The answer is definitely 4.');
    expect(result.finalResponse).toBeDefined();
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);

    // Verify the second call received the templated input
    const secondCall = (callProvider as ReturnType<typeof vi.fn>).mock.calls[1];
    const secondReq = secondCall[0];
    expect(secondReq.messages[0].content).toBe(
      'Rewrite this clearly: I think the answer is 4',
    );
  });

  it('uses {{previous.content}} template', async () => {
    const callProvider: CallProviderFn = vi.fn()
      .mockResolvedValueOnce(makeResponse('Step 1 output'))
      .mockResolvedValueOnce(makeResponse('Step 2 output'))
      .mockResolvedValueOnce(makeResponse('Final'));

    const steps: CompositionStep[] = [
      { name: 'a', provider: 'p1' },
      { name: 'b', provider: 'p1', inputTransform: 'Expand: {{previous.content}}' },
      { name: 'c', provider: 'p1', inputTransform: 'Summarize: {{previous.content}}' },
    ];

    const ctx = makeCtx();
    const result = await composer.execute(ctx, steps, callProvider);

    expect(result.steps).toHaveLength(3);
    const call2 = (callProvider as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(call2.messages[0].content).toBe('Expand: Step 1 output');
    const call3 = (callProvider as ReturnType<typeof vi.fn>).mock.calls[2][0];
    expect(call3.messages[0].content).toBe('Summarize: Step 2 output');
  });

  describe('error policies', () => {
    it('fail policy aborts the chain', async () => {
      const callProvider: CallProviderFn = vi.fn()
        .mockRejectedValueOnce(new Error('provider down'));

      const steps: CompositionStep[] = [
        { name: 'a', provider: 'p1', onError: 'fail' },
        { name: 'b', provider: 'p1' },
      ];

      const ctx = makeCtx();
      await expect(composer.execute(ctx, steps, callProvider)).rejects.toThrow(
        'Chain composition failed',
      );
    });

    it('skip policy continues the chain', async () => {
      const callProvider: CallProviderFn = vi.fn()
        .mockRejectedValueOnce(new Error('step failed'))
        .mockResolvedValueOnce(makeResponse('Final output'));

      const steps: CompositionStep[] = [
        { name: 'optional', provider: 'p1', onError: 'skip' },
        { name: 'required', provider: 'p1' },
      ];

      const ctx = makeCtx();
      const result = await composer.execute(ctx, steps, callProvider);

      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].status).toBe('skipped');
      expect(result.steps[1].status).toBe('success');
      expect(result.finalResponse).toBeDefined();
    });

    it('default policy uses defaultContent and continues', async () => {
      const callProvider: CallProviderFn = vi.fn()
        .mockRejectedValueOnce(new Error('nope'))
        .mockResolvedValueOnce(makeResponse('Done'));

      const steps: CompositionStep[] = [
        {
          name: 'fallback',
          provider: 'p1',
          onError: 'default',
          defaultContent: 'Default thinking',
        },
        {
          name: 'writer',
          provider: 'p1',
          inputTransform: 'Using: {{steps.fallback.content}}',
        },
      ];

      const ctx = makeCtx();
      const result = await composer.execute(ctx, steps, callProvider);

      expect(result.steps[0].status).toBe('defaulted');
      expect(result.steps[0].content).toBe('Default thinking');
      // The writer should have received the default content
      const writerReq = (callProvider as ReturnType<typeof vi.fn>).mock.calls[1][0];
      expect(writerReq.messages[0].content).toBe('Using: Default thinking');
    });

    it('partial policy returns completed steps', async () => {
      const callProvider: CallProviderFn = vi.fn()
        .mockResolvedValueOnce(makeResponse('Good start'))
        .mockRejectedValueOnce(new Error('boom'));

      const steps: CompositionStep[] = [
        { name: 'a', provider: 'p1' },
        { name: 'b', provider: 'p1', onError: 'partial' },
        { name: 'c', provider: 'p1' },
      ];

      const ctx = makeCtx();
      const result = await composer.execute(ctx, steps, callProvider);

      expect(result.steps).toHaveLength(2);
      expect(result.steps[0].status).toBe('success');
      expect(result.steps[1].status).toBe('error');
      // c was never executed
    });
  });

  it('respects per-step timeout via budget slicing', async () => {
    const callProvider: CallProviderFn = vi.fn().mockImplementation(
      async (_req, _provider, budget) => {
        // Verify the budget was sliced
        expect(budget.totalMs).toBeLessThanOrEqual(1000);
        return makeResponse('ok');
      },
    );

    const steps: CompositionStep[] = [
      { name: 'a', provider: 'p1', timeout: 1000 },
    ];

    const ctx = makeCtx(30_000);
    await composer.execute(ctx, steps, callProvider);
    expect(callProvider).toHaveBeenCalledOnce();
  });

  it('timeout triggers per-step fallback via error policy', async () => {
    // Create a very short budget
    const ctx = makeCtx(1); // 1ms budget

    // Wait for it to expire
    await new Promise((r) => setTimeout(r, 10));

    const callProvider: CallProviderFn = vi.fn();

    const steps: CompositionStep[] = [
      { name: 'a', provider: 'p1', onError: 'skip' },
      { name: 'b', provider: 'p1', onError: 'default', defaultContent: 'timed out fallback' },
    ];

    const result = await composer.execute(ctx, steps, callProvider);

    // Provider was never called — budget was exhausted
    expect(callProvider).not.toHaveBeenCalled();
    expect(result.steps[0].status).toBe('skipped');
    expect(result.steps[1].status).toBe('defaulted');
    expect(result.steps[1].content).toBe('timed out fallback');
  });

  it('records per-step timing in results', async () => {
    const callProvider: CallProviderFn = vi.fn()
      .mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 20));
        return makeResponse('ok');
      });

    const steps: CompositionStep[] = [
      { name: 'a', provider: 'p1' },
    ];

    const ctx = makeCtx();
    const result = await composer.execute(ctx, steps, callProvider);
    expect(result.steps[0].durationMs).toBeGreaterThanOrEqual(15);
  });
});
