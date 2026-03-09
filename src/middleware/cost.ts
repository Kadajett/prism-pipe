/**
 * Cost tracking middleware — calculates and attaches cost info to context.
 * Budget enforcement happens here (BudgetError → 403).
 */

import type { PipelineContext } from '../core/context.js';
import { PipelineError } from '../core/types.js';
import type { CostTracker } from '../cost/tracker.js';

export function costMiddleware(tracker: CostTracker) {
  return async function cost(ctx: PipelineContext, next: () => Promise<void>): Promise<void> {
    // Pre-flight: check if key is already over budget
    const apiKey = (ctx.metadata.get('apiKey') as string) ?? 'default';
    const budget = tracker.isOverBudget(apiKey);
    if (budget.exceeded) {
      throw new PipelineError(
        `Budget exceeded (${budget.periodType})`,
        'rate_limit',
        'cost',
        403,
        false
      );
    }

    await next();

    // Post-flight: track cost from response usage
    if (ctx.response?.usage) {
      const provider = (ctx.metadata.get('provider') as string) ?? 'unknown';
      const model = ctx.response.model || ctx.request.model;

      const costResult = tracker.track({
        key: apiKey,
        provider,
        model,
        inputTokens: ctx.response.usage.inputTokens,
        outputTokens: ctx.response.usage.outputTokens,
      });

      // Attach cost info for response headers
      ctx.metadata.set('cost', costResult);
    }
  };
}
