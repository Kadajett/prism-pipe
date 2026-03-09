/**
 * Thinking Wrapper Composer — 2-step chain: reasoning → execution.
 *
 * Injects reasoning from a thinking model into a fast executor model,
 * enabling reasoning-like behavior for non-thinking models.
 * Thinking tokens are tracked separately for cost analysis.
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

// ─── Configuration ───

export interface ThinkingWrapperOptions {
  /** Provider name for the reasoning model */
  thinkerProvider: string;
  /** Model name for the thinker (e.g. claude-3.5-sonnet with extended thinking) */
  thinkerModel?: string;
  /** System prompt for the thinker. Default: generic reasoning prompt. */
  thinkerPrompt?: string;
  /** Provider name for the fast executor */
  executorProvider: string;
  /** Model name for the executor */
  executorModel?: string;
  /** Template for injecting reasoning into the executor prompt.
   *  Use {{thinking}} as placeholder for the reasoning output.
   *  Default: "Reasoning:\n{{thinking}}\n\nNow provide your response:" */
  injectionTemplate?: string;
  /** Whether to include thinking content in the final response. Default: false */
  includeThinking?: boolean;
  /** Per-step timeout for the thinker in ms */
  thinkerTimeout?: number;
  /** Per-step timeout for the executor in ms */
  executorTimeout?: number;
}

const DEFAULT_THINKER_PROMPT =
  'Think through this problem step by step. Show your reasoning process clearly. ' +
  'Focus on analysis, edge cases, and the best approach before arriving at a conclusion.';

const DEFAULT_INJECTION_TEMPLATE =
  'The following reasoning was produced by an analysis step. ' +
  'Use it to inform your response, but write your answer naturally.\n\n' +
  'Reasoning:\n{{thinking}}\n\nNow provide your response to the original request:';

/** Extract text from content blocks */
function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Extract thinking blocks specifically */
function extractThinking(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: 'thinking'; text: string } => b.type === 'thinking')
    .map((b) => b.text)
    .join('\n');
}

export class ThinkingWrapperComposer implements Composer {
  readonly type = 'thinking-wrapper';
  private readonly options: ThinkingWrapperOptions;

  constructor(options: ThinkingWrapperOptions) {
    this.options = {
      ...options,
      thinkerPrompt: options.thinkerPrompt ?? DEFAULT_THINKER_PROMPT,
      injectionTemplate: options.injectionTemplate ?? DEFAULT_INJECTION_TEMPLATE,
      includeThinking: options.includeThinking ?? false,
    };
  }

  async execute(
    ctx: PipelineContext,
    _steps: CompositionStep[],
    callProvider: CallProviderFn,
  ): Promise<CompositionResult> {
    const totalStart = Date.now();
    const completedSteps: StepResult[] = [];

    // ─── Step 1: Thinker ───
    ctx.log.info('Thinking wrapper: starting thinker step', {
      provider: this.options.thinkerProvider,
      model: this.options.thinkerModel,
    });

    const thinkerStart = Date.now();
    let thinkingContent = '';
    let thinkerUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

    if (!ctx.timeout.hasTime()) {
      throw new PipelineError(
        'Timeout budget exhausted before thinking step',
        'timeout',
        'thinking_wrapper',
        504,
        true,
      );
    }

    const thinkerBudget = ctx.timeout.slice(this.options.thinkerTimeout);

    try {
      const thinkerRequest = {
        model: this.options.thinkerModel ?? ctx.original.model,
        messages: [...ctx.original.messages],
        systemPrompt: this.options.thinkerPrompt,
        temperature: ctx.original.temperature,
        maxTokens: ctx.original.maxTokens,
        topP: ctx.original.topP,
        stream: false as const,
      };

      const thinkerResponse = await callProvider(
        thinkerRequest,
        this.options.thinkerProvider,
        thinkerBudget,
        false,
      );

      // Extract thinking blocks if present; fall back to text content
      thinkingContent = extractThinking(thinkerResponse.content) || extractText(thinkerResponse.content);
      thinkerUsage = thinkerResponse.usage;

      completedSteps.push({
        name: 'thinker',
        provider: this.options.thinkerProvider,
        content: thinkingContent,
        durationMs: Date.now() - thinkerStart,
        status: 'success',
      });

      ctx.log.info('Thinking wrapper: thinker complete', {
        thinkingLength: thinkingContent.length,
        durationMs: Date.now() - thinkerStart,
        thinkingTokens: thinkerUsage.outputTokens,
      });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      completedSteps.push({
        name: 'thinker',
        provider: this.options.thinkerProvider,
        content: '',
        durationMs: Date.now() - thinkerStart,
        status: 'error',
        error: errMsg,
      });

      throw new PipelineError(
        `Thinking step failed: ${errMsg}`,
        'server_error',
        'thinking_wrapper.thinker',
        502,
      );
    }

    // ─── Step 2: Executor with injected reasoning ───
    ctx.log.info('Thinking wrapper: starting executor step', {
      provider: this.options.executorProvider,
      model: this.options.executorModel,
    });

    const executorStart = Date.now();

    if (!ctx.timeout.hasTime()) {
      throw new PipelineError(
        'Timeout budget exhausted before executor step',
        'timeout',
        'thinking_wrapper',
        504,
        true,
      );
    }

    const executorBudget = ctx.timeout.slice(this.options.executorTimeout);

    // Inject the reasoning into the executor's messages
    const injectedContent = this.options.injectionTemplate!.replace(
      /\{\{thinking\}\}/g,
      thinkingContent,
    );

    // Get the original user message
    const originalMessages = ctx.original.messages;
    const lastUserMsg = [...originalMessages].reverse().find((m) => m.role === 'user');
    const lastUserText =
      typeof lastUserMsg?.content === 'string'
        ? lastUserMsg.content
        : lastUserMsg
          ? extractText(lastUserMsg.content as ContentBlock[])
          : '';

    const executorRequest = {
      model: this.options.executorModel ?? ctx.original.model,
      messages: [
        // Provide context: system-like injection of reasoning, then original user message
        { role: 'user' as const, content: `${injectedContent}\n\nOriginal request: ${lastUserText}` },
      ],
      systemPrompt: ctx.original.systemPrompt,
      temperature: ctx.original.temperature,
      maxTokens: ctx.original.maxTokens,
      topP: ctx.original.topP,
      stream: false as const,
    };

    try {
      const executorResponse = await callProvider(
        executorRequest,
        this.options.executorProvider,
        executorBudget,
        false,
      );

      const executorContent = extractText(executorResponse.content);

      completedSteps.push({
        name: 'executor',
        provider: this.options.executorProvider,
        content: executorContent,
        durationMs: Date.now() - executorStart,
        status: 'success',
      });

      ctx.log.info('Thinking wrapper: executor complete', {
        contentLength: executorContent.length,
        durationMs: Date.now() - executorStart,
      });

      // ─── Build final response ───
      const finalContent: ContentBlock[] = [];

      // Optionally include thinking in response
      if (this.options.includeThinking && thinkingContent) {
        finalContent.push({ type: 'thinking', text: thinkingContent });
      }

      finalContent.push(...executorResponse.content.filter((b) => b.type === 'text'));

      const finalResponse: CanonicalResponse = {
        id: `tw-${ctx.id}`,
        model: executorResponse.model,
        content: finalContent,
        stopReason: executorResponse.stopReason,
        usage: {
          inputTokens: thinkerUsage.inputTokens + executorResponse.usage.inputTokens,
          outputTokens: thinkerUsage.outputTokens + executorResponse.usage.outputTokens,
          totalTokens: thinkerUsage.totalTokens + executorResponse.usage.totalTokens,
        },
        providerExtensions: {
          thinkingTokens: thinkerUsage.outputTokens,
          executorTokens: executorResponse.usage.outputTokens,
        },
      };

      return {
        steps: completedSteps,
        finalResponse,
        totalDurationMs: Date.now() - totalStart,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      completedSteps.push({
        name: 'executor',
        provider: this.options.executorProvider,
        content: '',
        durationMs: Date.now() - executorStart,
        status: 'error',
        error: errMsg,
      });

      throw new PipelineError(
        `Executor step failed: ${errMsg}`,
        'server_error',
        'thinking_wrapper.executor',
        502,
      );
    }
  }
}
