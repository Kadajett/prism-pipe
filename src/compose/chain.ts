/**
 * Chain Composer — sequential multi-step composition.
 *
 * Steps execute in order: step 1 output feeds step 2 input via inputTransform templates.
 * Steps 1..N-1 are buffered; step N streams if the original request has stream=true.
 * Each step gets a sliced timeout budget from the parent.
 */

import type {
  CallProviderFn,
  Composer,
  CompositionResult,
  CompositionStep,
  ErrorPolicy,
  StepResult,
} from '../core/composer';
import type { PipelineContext } from '../core/context';
import type { CanonicalRequest, ContentBlock } from '../core/types';
import { PipelineError } from '../core/types';
import { resolveTemplate, type TemplateContext } from './template';

/** Extract text from content blocks */
function extractText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Build a request for a composition step */
function buildStepRequest(
  step: CompositionStep,
  ctx: PipelineContext,
  tplCtx: TemplateContext,
): CanonicalRequest {
  const base = ctx.original;

  // Resolve input transform template to get the user message for this step
  let userContent: string;
  if (step.inputTransform) {
    userContent = resolveTemplate(step.inputTransform, tplCtx);
  } else if (tplCtx.previous) {
    // Default: pass previous step's output as user message
    userContent = tplCtx.previous.content;
  } else {
    // First step with no transform: use original messages as-is
    return {
      ...base,
      model: step.model ?? base.model,
      systemPrompt: step.systemPrompt ?? base.systemPrompt,
      stream: false,
    };
  }

  return {
    model: step.model ?? base.model,
    messages: [{ role: 'user', content: userContent }],
    systemPrompt: step.systemPrompt ?? base.systemPrompt,
    temperature: base.temperature,
    maxTokens: base.maxTokens,
    topP: base.topP,
    stream: false,
  };
}

/** Handle step error according to policy */
function handleStepError(
  step: CompositionStep,
  error: unknown,
  durationMs: number,
): { result: StepResult; shouldAbort: boolean } {
  const policy: ErrorPolicy = step.onError ?? 'fail';
  const errMsg = error instanceof Error ? error.message : String(error);

  switch (policy) {
    case 'fail':
      return {
        result: {
          name: step.name,
          provider: step.provider,
          content: '',
          durationMs,
          status: 'error',
          error: errMsg,
        },
        shouldAbort: true,
      };

    case 'skip':
      return {
        result: {
          name: step.name,
          provider: step.provider,
          content: '',
          durationMs,
          status: 'skipped',
          error: errMsg,
        },
        shouldAbort: false,
      };

    case 'default':
      return {
        result: {
          name: step.name,
          provider: step.provider,
          content: step.defaultContent ?? '',
          durationMs,
          status: 'defaulted',
          error: errMsg,
        },
        shouldAbort: false,
      };

    case 'partial':
      // Partial: abort but return what we have so far
      return {
        result: {
          name: step.name,
          provider: step.provider,
          content: '',
          durationMs,
          status: 'error',
          error: errMsg,
        },
        shouldAbort: true,
      };
  }
}

export class ChainComposer implements Composer {
  readonly type = 'chain';

  async execute(
    ctx: PipelineContext,
    steps: CompositionStep[],
    callProvider: CallProviderFn,
  ): Promise<CompositionResult> {
    const totalStart = Date.now();
    const completedSteps: StepResult[] = [];
    const stepMap = new Map<string, StepResult>();
    let isPartial = false;

    const tplCtx: TemplateContext = {
      original: ctx.original,
      steps: stepMap,
      previous: undefined,
    };

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const isLastStep = i === steps.length - 1;
      const stepStart = Date.now();

      // Check budget
      if (!ctx.timeout.hasTime()) {
        const { result, shouldAbort } = handleStepError(
          step,
          new PipelineError('Timeout budget exhausted', 'timeout', step.name, 504, true),
          0,
        );
        completedSteps.push(result);
        if (shouldAbort) {
          isPartial = step.onError === 'partial';
          break;
        }
        continue;
      }

      // Slice timeout for this step
      const stepBudget = ctx.timeout.slice(step.timeout);

      try {
        const request = buildStepRequest(step, ctx, tplCtx);

        ctx.log.info(`Chain step "${step.name}" starting`, {
          provider: step.provider,
          budgetMs: stepBudget.remaining(),
          isLast: isLastStep,
        });

        // TODO: For streaming the final step, the caller would need to handle
        // the stream differently. For now, all steps are buffered.
        const response = await callProvider(request, step.provider, stepBudget, false);

        const content = extractText(response.content);
        const durationMs = Date.now() - stepStart;

        const result: StepResult = {
          name: step.name,
          provider: step.provider,
          content,
          durationMs,
          status: 'success',
        };

        completedSteps.push(result);
        stepMap.set(step.name, result);
        tplCtx.previous = result;

        ctx.log.info(`Chain step "${step.name}" completed`, {
          durationMs,
          contentLength: content.length,
        });

        // If this is the last step, store the full response
        if (isLastStep) {
          return {
            steps: completedSteps,
            finalResponse: response,
            totalDurationMs: Date.now() - totalStart,
          };
        }
      } catch (error) {
        const durationMs = Date.now() - stepStart;
        const { result, shouldAbort } = handleStepError(step, error, durationMs);

        completedSteps.push(result);

        // Even errored/skipped steps go in the map so templates can reference them
        stepMap.set(step.name, result);
        tplCtx.previous = result;

        ctx.log.warn(`Chain step "${step.name}" ${result.status}`, {
          error: result.error,
          policy: step.onError ?? 'fail',
        });

        if (shouldAbort) {
          isPartial = step.onError === 'partial';
          break;
        }
      }
    }

    // If we got here without returning, either all steps had errors or partial
    const totalDurationMs = Date.now() - totalStart;

    if (isPartial && completedSteps.some((s) => s.status === 'success')) {
      // Return partial result: last successful step
      const lastSuccess = [...completedSteps].reverse().find((s) => s.status === 'success');
      return {
        steps: completedSteps,
        totalDurationMs,
      };
    }

    // Check if we have any successful results at all
    const hasUsable = completedSteps.some((s) => s.status === 'success' || s.status === 'defaulted');
    if (!hasUsable) {
      const lastErr = completedSteps[completedSteps.length - 1];
      throw new PipelineError(
        `Chain composition failed: all steps errored. Last: ${lastErr?.error ?? 'unknown'}`,
        'server_error',
        'chain_composer',
        502,
      );
    }

    return {
      steps: completedSteps,
      totalDurationMs,
    };
  }
}
