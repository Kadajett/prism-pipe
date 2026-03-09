/**
 * Fork-Join Composer — parallel fan-out with configurable merge.
 *
 * Fans out to N providers via Promise.allSettled, each with a sliced budget.
 * Merge strategies: best-of (judge model picks), concatenate, vote, custom.
 */

import type {
  CallProviderFn,
  Composer,
  CompositionResult,
  CompositionStep,
  StepResult,
} from '../core/composer.js';
import type { PipelineContext } from '../core/context.js';
import type { CanonicalResponse, ContentBlock } from '../core/types.js';
import { PipelineError } from '../core/types.js';

// ─── Merge Strategy Types ───

export type MergeStrategy = 'best-of' | 'concatenate' | 'vote' | 'custom';

export interface ForkJoinOptions {
  /** How to merge the fork results. Default: 'concatenate' */
  merge: MergeStrategy;
  /** Model/provider for the judge when using best-of. Required for 'best-of'. */
  mergeModel?: string;
  /** Provider name for the merge model */
  mergeProvider?: string;
  /** Minimum number of successful forks to proceed. Default: 1 */
  minSuccessful?: number;
  /** Custom merge function for 'custom' strategy */
  customMerge?: (results: StepResult[], ctx: PipelineContext) => string;
}

/** Extract text from content blocks */
function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Build the judge prompt for best-of strategy */
function buildJudgePrompt(results: StepResult[], originalContent: string): string {
  const candidates = results
    .filter((r) => r.status === 'success')
    .map((r, i) => `--- Candidate ${i + 1} (${r.provider}) ---\n${r.content}`)
    .join('\n\n');

  return (
    `You are a judge evaluating multiple AI responses to the same prompt.\n\n` +
    `Original prompt:\n${originalContent}\n\n` +
    `${candidates}\n\n` +
    `Select the best response. Reply with ONLY the full text of the best candidate, ` +
    `with no additional commentary or explanation.`
  );
}

/** Merge via simple vote — pick the most common response (by normalized text) */
function mergeByVote(results: StepResult[]): string {
  const successful = results.filter((r) => r.status === 'success');
  if (successful.length === 0) return '';

  // Count normalized responses
  const counts = new Map<string, { count: number; original: string }>();
  for (const r of successful) {
    const normalized = r.content.trim().toLowerCase();
    const existing = counts.get(normalized);
    if (existing) {
      existing.count++;
    } else {
      counts.set(normalized, { count: 1, original: r.content });
    }
  }

  // Return the response with highest count
  let best = { count: 0, original: '' };
  for (const entry of counts.values()) {
    if (entry.count > best.count) best = entry;
  }
  return best.original;
}

export class ForkJoinComposer implements Composer {
  readonly type = 'fork-join';
  private readonly options: ForkJoinOptions;

  constructor(options: Partial<ForkJoinOptions> = {}) {
    this.options = {
      merge: options.merge ?? 'concatenate',
      mergeModel: options.mergeModel,
      mergeProvider: options.mergeProvider,
      minSuccessful: options.minSuccessful ?? 1,
      customMerge: options.customMerge,
    };
  }

  async execute(
    ctx: PipelineContext,
    steps: CompositionStep[],
    callProvider: CallProviderFn,
  ): Promise<CompositionResult> {
    const totalStart = Date.now();

    if (steps.length === 0) {
      throw new PipelineError(
        'Fork-join requires at least one step',
        'invalid_request',
        'fork_join',
        400,
      );
    }

    if (this.options.merge === 'best-of' && !this.options.mergeProvider) {
      throw new PipelineError(
        'best-of merge strategy requires mergeProvider',
        'invalid_request',
        'fork_join',
        400,
      );
    }

    // ─── Fan-out: execute all steps in parallel ───
    ctx.log.info(`Fork-join fanning out to ${steps.length} providers`, {
      merge: this.options.merge,
      minSuccessful: this.options.minSuccessful,
    });

    const forkPromises = steps.map(async (step): Promise<StepResult> => {
      const stepStart = Date.now();

      if (!ctx.timeout.hasTime()) {
        return {
          name: step.name,
          provider: step.provider,
          content: '',
          durationMs: 0,
          status: 'error',
          error: 'Timeout budget exhausted before fork started',
        };
      }

      const stepBudget = ctx.timeout.slice(step.timeout);

      try {
        const request = {
          ...ctx.original,
          model: step.model ?? ctx.original.model,
          systemPrompt: step.systemPrompt ?? ctx.original.systemPrompt,
          stream: false as const,
        };

        const response = await callProvider(request, step.provider, stepBudget, false);
        const content = extractText(response.content);

        return {
          name: step.name,
          provider: step.provider,
          content,
          durationMs: Date.now() - stepStart,
          status: 'success',
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        ctx.log.warn(`Fork "${step.name}" failed`, { error: errMsg, provider: step.provider });

        return {
          name: step.name,
          provider: step.provider,
          content: step.defaultContent ?? '',
          durationMs: Date.now() - stepStart,
          status: step.onError === 'default' ? 'defaulted' : 'error',
          error: errMsg,
        };
      }
    });

    const settled = await Promise.allSettled(forkPromises);
    const completedSteps: StepResult[] = settled.map((s) =>
      s.status === 'fulfilled'
        ? s.value
        : {
            name: 'unknown',
            provider: 'unknown',
            content: '',
            durationMs: 0,
            status: 'error' as const,
            error: s.reason instanceof Error ? s.reason.message : String(s.reason),
          },
    );

    // ─── Check minimum successful threshold ───
    const successCount = completedSteps.filter(
      (s) => s.status === 'success' || s.status === 'defaulted',
    ).length;

    if (successCount < (this.options.minSuccessful ?? 1)) {
      const errors = completedSteps
        .filter((s) => s.status === 'error')
        .map((s) => `${s.provider}: ${s.error}`)
        .join('; ');

      throw new PipelineError(
        `Fork-join: only ${successCount}/${this.options.minSuccessful} forks succeeded. Errors: ${errors}`,
        'server_error',
        'fork_join',
        502,
      );
    }

    // ─── Merge phase ───
    const mergedContent = await this.merge(completedSteps, ctx, callProvider);
    const totalDurationMs = Date.now() - totalStart;

    ctx.log.info('Fork-join complete', {
      forks: steps.length,
      successful: successCount,
      merge: this.options.merge,
      totalDurationMs,
    });

    // Build a synthetic final response
    const finalResponse: CanonicalResponse = {
      id: `fj-${ctx.id}`,
      model: this.options.mergeModel ?? ctx.original.model,
      content: [{ type: 'text', text: mergedContent }],
      stopReason: 'end',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    };

    return {
      steps: completedSteps,
      finalResponse,
      totalDurationMs,
    };
  }

  private async merge(
    results: StepResult[],
    ctx: PipelineContext,
    callProvider: CallProviderFn,
  ): Promise<string> {
    const successful = results.filter((r) => r.status === 'success' || r.status === 'defaulted');

    switch (this.options.merge) {
      case 'concatenate': {
        return successful.map((r) => `[${r.provider}]\n${r.content}`).join('\n\n');
      }

      case 'vote': {
        return mergeByVote(results);
      }

      case 'best-of': {
        if (successful.length === 1) return successful[0].content;

        // Extract the original user message for context
        const lastUserMsg = ctx.original.messages
          .filter((m) => m.role === 'user')
          .pop();
        const originalContent =
          typeof lastUserMsg?.content === 'string'
            ? lastUserMsg.content
            : lastUserMsg
              ? extractText(lastUserMsg.content as ContentBlock[])
              : '';

        const judgePrompt = buildJudgePrompt(results, originalContent);
        const judgeBudget = ctx.timeout.slice();

        const judgeResponse = await callProvider(
          {
            model: this.options.mergeModel ?? ctx.original.model,
            messages: [{ role: 'user', content: judgePrompt }],
            stream: false,
          },
          this.options.mergeProvider!,
          judgeBudget,
          false,
        );

        return extractText(judgeResponse.content);
      }

      case 'custom': {
        if (!this.options.customMerge) {
          throw new PipelineError(
            'custom merge strategy requires customMerge function',
            'invalid_request',
            'fork_join',
            400,
          );
        }
        return this.options.customMerge(results, ctx);
      }

      default:
        throw new PipelineError(
          `Unknown merge strategy: ${this.options.merge}`,
          'invalid_request',
          'fork_join',
          400,
        );
    }
  }
}
