/**
 * Prompt Guard middleware — detects prompt injection and jailbreak attempts
 * using layered defense: normalization → heuristic rules → optional classifier → optional dataset.
 *
 * Modes:
 *   - flag: adds X-Prism-Injection-Risk header, continues processing
 *   - block: returns 403 (or configured status), stops pipeline
 *   - log-only: logs detection, always continues
 */

import type { Middleware } from '../../core/pipeline';
import type { CanonicalMessage, ContentBlock } from '../../core/types';
import { detectUnicodeAnomalies, normalizeText } from './normalizer';
import { getActiveRules } from './rules/index';
import { scoreMessages } from './scorer';
import type { InjectionLogEntry, PromptGuardConfig, ScorerResult } from './types';
import { PromptGuardConfigSchema } from './types';

export type { InjectionLogEntry, PromptGuardConfig } from './types';
export { PromptGuardConfigSchema } from './types';

/**
 * Extract text content from messages for scanning.
 */
function extractTextFromMessages(
  messages: CanonicalMessage[]
): Array<{ text: string; index: number }> {
  const results: Array<{ text: string; index: number }> = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'user') continue; // Only scan user messages

    if (typeof msg.content === 'string') {
      if (msg.content.trim()) results.push({ text: msg.content, index: i });
    } else if (Array.isArray(msg.content)) {
      const textParts = (msg.content as ContentBlock[])
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text);
      const combined = textParts.join('\n');
      if (combined.trim()) results.push({ text: combined, index: i });
    }
  }

  return results;
}

/**
 * Create the prompt guard middleware.
 */
export function createPromptGuardMiddleware(rawConfig?: Partial<PromptGuardConfig>): Middleware {
  const config = PromptGuardConfigSchema.parse(rawConfig ?? {});

  if (!config.enabled) {
    return async function promptGuardDisabled(_ctx, next) {
      await next();
    };
  }

  const rules = getActiveRules(config.disabledRules);

  return async function promptGuard(ctx, next) {
    const start = Date.now();

    // Check route exclusion
    const route = ctx.metadata.get('route') as string | undefined;
    if (
      route &&
      config.excludeRoutes.some((pattern) => {
        if (pattern.endsWith('*')) {
          return route.startsWith(pattern.slice(0, -1));
        }
        return route === pattern;
      })
    ) {
      await next();
      return;
    }

    // Extract user messages within the multi-turn window
    const userMessages = extractTextFromMessages(ctx.request.messages);
    const windowedMessages = userMessages.slice(-config.multiTurnWindow);

    if (windowedMessages.length === 0) {
      await next();
      return;
    }

    // Layer 1: Normalize
    const normalizedTexts = windowedMessages.map((m) => ({
      ...m,
      normalized: config.layers.normalizer ? normalizeText(m.text) : m.text,
      anomalies: config.layers.normalizer ? detectUnicodeAnomalies(m.text) : undefined,
    }));

    // Store normalized text for downstream layers
    ctx.metadata.set(
      'promptGuard.normalized',
      normalizedTexts.map((t) => t.normalized)
    );

    // Layer 2: Heuristic rules
    let result: ScorerResult = { riskLevel: 'none', aggregateScore: 0, ruleResults: [] };
    let detectedMessageIndex = -1;

    if (config.layers.heuristic) {
      const scored = scoreMessages(
        normalizedTexts.map((t) => t.normalized),
        rules,
        config.sensitivity
      );
      result = scored.worstResult;
      detectedMessageIndex = scored.messageIndex;

      // Boost score if unicode anomalies were detected (obfuscation attempt)
      const anomalyCount = normalizedTexts.reduce(
        (sum, t) => sum + (t.anomalies?.anomalyCount ?? 0),
        0
      );
      if (anomalyCount > 0 && result.aggregateScore > 0) {
        result.aggregateScore = Math.min(1, result.aggregateScore + anomalyCount * 0.05);
      }
    }

    // Emit metrics
    const latencyMs = Date.now() - start;
    ctx.metrics.histogram('prompt_guard.latency_ms', latencyMs);

    if (result.riskLevel !== 'none') {
      ctx.metrics.counter('prompt_guard.detections', 1, {
        level: result.riskLevel,
        action: config.mode,
      });
    }

    // Store result in metadata for downstream use
    ctx.metadata.set('promptGuard.result', result);

    // Determine action
    const actionTaken =
      result.riskLevel === 'none'
        ? ('logged' as const)
        : config.mode === 'block' &&
            (result.riskLevel === 'high' || result.riskLevel === 'critical')
          ? ('blocked' as const)
          : config.mode === 'block'
            ? ('flagged' as const)
            : config.mode === 'flag'
              ? ('flagged' as const)
              : ('logged' as const);

    // Log detection
    if (result.riskLevel !== 'none') {
      const logEntry: InjectionLogEntry = {
        requestId: ctx.id,
        timestamp: Date.now(),
        riskLevel: result.riskLevel,
        triggeredRules: result.ruleResults.map((r) => ({
          ruleId: r.ruleId,
          score: r.score,
          evidence: r.evidence,
        })),
        actionTaken,
        messageIndex: detectedMessageIndex,
        normalizedSnippet: config.audit.logNormalizedSnippet
          ? normalizedTexts[Math.max(0, detectedMessageIndex)]?.normalized.substring(
              0,
              config.audit.maxSnippetLength
            )
          : undefined,
      };

      ctx.log.warn('prompt injection detected', {
        riskLevel: result.riskLevel,
        score: result.aggregateScore,
        action: actionTaken,
        rules: result.ruleResults.map((r) => r.ruleId),
      });

      // Store audit entry for the store layer to persist
      ctx.metadata.set('promptGuard.auditEntry', logEntry);
    }

    // Apply action
    if (actionTaken === 'blocked') {
      // Set response to block — don't call next()
      ctx.metadata.set('promptGuard.blocked', true);
      ctx.metadata.set('responseStatus', config.action.blockStatusCode);
      ctx.metadata.set('responseBody', {
        error: {
          type: 'prompt_injection_detected',
          message: config.action.blockMessage,
        },
      });
      // Don't call next() — pipeline stops here
      return;
    }

    // Flag mode: add header metadata for the response
    if (actionTaken === 'flagged') {
      const headers = (ctx.metadata.get('responseHeaders') as Record<string, string>) ?? {};
      headers[config.action.headerName] = result.riskLevel;
      ctx.metadata.set('responseHeaders', headers);
    }

    await next();
  };
}
