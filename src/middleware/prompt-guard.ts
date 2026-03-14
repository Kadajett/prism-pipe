/**
 * Prompt injection detection middleware for PrismPipe.
 *
 * Scans `ctx.request.messages` for known injection patterns, computes a
 * threat score (0–1), and takes a configurable action (block/flag/sanitize/log).
 *
 * Designed for <5 ms latency on typical payloads.
 *
 * @example
 * ```ts
 * import { createPromptGuard } from './prompt-guard';
 *
 * const guard = createPromptGuard({ action: 'block', threshold: 0.4 });
 * // Use as middleware in the pipeline
 * ```
 */

import type { PipelineContext } from '../core/context';
import type { Middleware } from '../core/pipeline';
import type { CanonicalMessage, ContentBlock } from '../core/types';
import { PipelineError } from '../core/types';
import type { NamedMiddleware } from '../plugin/types';
import { defineMiddleware } from './define';

// ─── Types ───

/** Categories of prompt injection patterns. */
export type PatternCategory =
  | 'role_override'
  | 'delimiter_injection'
  | 'encoding_evasion'
  | 'meta_instruction'
  | 'exfiltration';

/** A single detection rule. */
export interface PatternRule {
  /** Human-readable name for logging. */
  name: string;
  /** Regex to test against message text. */
  pattern: RegExp;
  /** Weight towards the final score (0–1). */
  weight: number;
  /** Classification category. */
  category: PatternCategory;
}

/** Action to take when injection is detected above threshold. */
export type PromptGuardAction = 'block' | 'flag' | 'sanitize' | 'log';

/** Configuration for the prompt guard middleware. */
export interface PromptGuardConfig {
  /** Whether the guard is active. Default: true. */
  enabled?: boolean;
  /** Action when score exceeds threshold. Default: 'block'. */
  action?: PromptGuardAction;
  /** Score threshold to trigger action (0–1). Default: 0.5. */
  threshold?: number;
  /** Extra patterns merged with built-ins. */
  patterns?: PatternRule[];
  /** Message roles to skip (e.g. ['system', 'assistant']). Default: ['system', 'assistant']. */
  excludeRoles?: string[];
  /** Max characters to scan per message (truncates). Default: 10000. */
  maxScanLength?: number;
  /** Optional hook called on every detection. */
  onDetection?: (info: DetectionResult) => void;
}

/** Describes a single pattern match. */
export interface PatternMatch {
  rule: string;
  category: PatternCategory;
  weight: number;
}

/** Full result of scanning a request. */
export interface DetectionResult {
  score: number;
  matches: PatternMatch[];
  action: PromptGuardAction;
  blocked: boolean;
}

// ─── Built-in Patterns ───

/** @internal */
export const BUILTIN_PATTERNS: PatternRule[] = [
  // ── Role override ──
  {
    name: 'ignore-previous',
    pattern: /ignore\s+(all\s+)?previous\s+instructions/i,
    weight: 0.85,
    category: 'role_override',
  },
  {
    name: 'you-are-now',
    pattern: /you\s+are\s+now\s+(?:a|an|the)\s+/i,
    weight: 0.6,
    category: 'role_override',
  },
  {
    name: 'new-system-prompt',
    pattern: /new\s+system\s+prompt/i,
    weight: 0.8,
    category: 'role_override',
  },
  {
    name: 'forget-instructions',
    pattern: /forget\s+(all\s+)?(your\s+)?instructions/i,
    weight: 0.85,
    category: 'role_override',
  },
  {
    name: 'override-role',
    pattern: /override\s+(your\s+)?(role|persona|character)/i,
    weight: 0.7,
    category: 'role_override',
  },

  // ── Delimiter injection ──
  {
    name: 'fake-system-tag',
    pattern: /<\/?system>/i,
    weight: 0.9,
    category: 'delimiter_injection',
  },
  {
    name: 'hash-system',
    pattern: /#{3,}\s*SYSTEM\s*#{3,}/i,
    weight: 0.85,
    category: 'delimiter_injection',
  },
  { name: 'fence-system', pattern: /```system\b/i, weight: 0.8, category: 'delimiter_injection' },
  { name: 'bracket-system', pattern: /\[SYSTEM\]/i, weight: 0.75, category: 'delimiter_injection' },

  // ── Encoding evasion ──
  {
    name: 'base64-instruction',
    pattern: /(?:aWdub3Jl|Zm9yZ2V0|c3lzdGVt|SW5zdHJ1Y3Rpb24)/i,
    weight: 0.7,
    category: 'encoding_evasion',
  },
  {
    name: 'unicode-homoglyph',
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — detecting encoding evasion via control chars
    pattern: /[\u0400-\u04FF][\u0000-\u007F]{2,}[\u0400-\u04FF]/i,
    weight: 0.5,
    category: 'encoding_evasion',
  },
  {
    name: 'zero-width-chars',
    // biome-ignore lint/suspicious/noMisleadingCharacterClass: intentional — detecting zero-width char sequences used for evasion
    pattern: /[\u200B\u200C\u200D\uFEFF]{2,}/i,
    weight: 0.6,
    category: 'encoding_evasion',
  },

  // ── Meta-instructions ──
  {
    name: 'do-not-follow',
    pattern: /do\s+not\s+follow\s+(your\s+)?guidelines/i,
    weight: 0.8,
    category: 'meta_instruction',
  },
  {
    name: 'output-system-prompt',
    pattern: /output\s+(your\s+)?system\s+prompt/i,
    weight: 0.85,
    category: 'meta_instruction',
  },
  {
    name: 'disregard-above',
    pattern: /disregard\s+(all\s+)?(the\s+)?above/i,
    weight: 0.85,
    category: 'meta_instruction',
  },
  {
    name: 'ignore-rules',
    pattern: /ignore\s+(all\s+)?(your\s+)?(rules|constraints|guidelines)/i,
    weight: 0.8,
    category: 'meta_instruction',
  },

  // ── Exfiltration ──
  {
    name: 'repeat-above',
    pattern: /repeat\s+(everything|all)\s+(above|before)/i,
    weight: 0.75,
    category: 'exfiltration',
  },
  {
    name: 'show-instructions',
    pattern: /show\s+me\s+(your\s+)?instructions/i,
    weight: 0.7,
    category: 'exfiltration',
  },
  {
    name: 'what-is-system-prompt',
    pattern: /what\s+is\s+(your\s+)?system\s+prompt/i,
    weight: 0.75,
    category: 'exfiltration',
  },
  {
    name: 'print-initial-prompt',
    pattern: /print\s+(your\s+)?(initial|original)\s+prompt/i,
    weight: 0.7,
    category: 'exfiltration',
  },
];

// ─── Helpers ───

/**
 * Extract all scannable text from a `CanonicalMessage`.
 * Handles both `string` and `ContentBlock[]` content shapes.
 * @internal
 */
export function extractText(msg: CanonicalMessage, maxLen: number): string {
  let raw: string;
  if (typeof msg.content === 'string') {
    raw = msg.content;
  } else {
    const parts: string[] = [];
    for (const block of msg.content as ContentBlock[]) {
      if ('text' in block && typeof (block as { text?: unknown }).text === 'string') {
        parts.push((block as { text: string }).text);
      }
    }
    raw = parts.join(' ');
  }
  return raw.length > maxLen ? raw.slice(0, maxLen) : raw;
}

/**
 * Run all patterns against a single text, returning matches.
 * @internal
 */
export function scanText(text: string, patterns: PatternRule[]): PatternMatch[] {
  const matches: PatternMatch[] = [];
  for (const rule of patterns) {
    if (rule.pattern.test(text)) {
      matches.push({ rule: rule.name, category: rule.category, weight: rule.weight });
    }
  }
  return matches;
}

/**
 * Compute a normalised score (0–1) from weighted matches.
 * Uses a saturating formula: `1 - ∏(1 - weight_i)` so multiple low-weight
 * matches can still cross the threshold.
 * @internal
 */
export function computeScore(matches: PatternMatch[]): number {
  if (matches.length === 0) return 0;
  let complement = 1;
  for (const m of matches) {
    complement *= 1 - m.weight;
  }
  return 1 - complement;
}

/**
 * Strip matched patterns from message text.
 * @internal
 */
function sanitizeContent(
  content: string | ContentBlock[],
  patterns: PatternRule[],
  maxLen: number
): string | ContentBlock[] {
  if (typeof content === 'string') {
    const scanWindow = content.length > maxLen ? content.slice(0, maxLen) : content;
    const tail = content.length > maxLen ? content.slice(maxLen) : '';
    let sanitized = scanWindow;
    for (const rule of patterns) {
      const globalPattern = rule.pattern.flags.includes('g')
        ? rule.pattern
        : new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
      sanitized = sanitized.replace(globalPattern, '');
    }
    return sanitized + tail;
  }

  return (content as ContentBlock[]).map((block) => {
    if ('text' in block && typeof (block as { text?: unknown }).text === 'string') {
      const fullText = (block as { text: string }).text;
      const scanWindow = fullText.length > maxLen ? fullText.slice(0, maxLen) : fullText;
      const tail = fullText.length > maxLen ? fullText.slice(maxLen) : '';
      let sanitized = scanWindow;
      for (const rule of patterns) {
        const globalPattern = rule.pattern.flags.includes('g')
          ? rule.pattern
          : new RegExp(rule.pattern.source, `${rule.pattern.flags}g`);
        sanitized = sanitized.replace(globalPattern, '');
      }
      return { ...block, text: sanitized + tail } as ContentBlock;
    }
    return block;
  });
}

// ─── Factory ───

const DEFAULTS: Required<Omit<PromptGuardConfig, 'patterns' | 'onDetection'>> = {
  enabled: true,
  action: 'block',
  threshold: 0.5,
  excludeRoles: ['system', 'assistant'],
  maxScanLength: 10_000,
};

/**
 * Create a prompt-guard middleware instance.
 *
 * @param config - Guard configuration (all fields optional with sensible defaults).
 * @returns A `Middleware` function suitable for the PrismPipe pipeline.
 *
 * @example
 * ```ts
 * const guard = createPromptGuard({ action: 'flag', threshold: 0.3 });
 * pipeline.use(guard);
 * ```
 */
export function createPromptGuard(config: PromptGuardConfig = {}): Middleware {
  const enabled = config.enabled ?? DEFAULTS.enabled;
  const action = config.action ?? DEFAULTS.action;
  const threshold = config.threshold ?? DEFAULTS.threshold;
  const excludeRoles = new Set(config.excludeRoles ?? DEFAULTS.excludeRoles);
  const maxScanLength = config.maxScanLength ?? DEFAULTS.maxScanLength;
  const patterns = config.patterns ? [...BUILTIN_PATTERNS, ...config.patterns] : BUILTIN_PATTERNS;

  return async function promptGuard(
    ctx: PipelineContext,
    next: () => Promise<void>
  ): Promise<void> {
    if (!enabled) {
      await next();
      return;
    }

    ctx.metrics.counter('prompt_guard.scanned');

    const allMatches: PatternMatch[] = [];

    for (const msg of ctx.request.messages) {
      if (excludeRoles.has(msg.role)) continue;
      const text = extractText(msg, maxScanLength);
      const matches = scanText(text, patterns);
      allMatches.push(...matches);
    }

    const score = computeScore(allMatches);
    ctx.metrics.histogram('prompt_guard.score', score);

    if (score < threshold) {
      await next();
      return;
    }

    // Score exceeded threshold — determine categories for metrics
    const categories = [...new Set(allMatches.map((m) => m.category))];
    for (const category of categories) {
      ctx.metrics.counter('prompt_guard.detected', 1, { action, category });
    }

    const result: DetectionResult = {
      score,
      matches: allMatches,
      action,
      blocked: action === 'block',
    };

    ctx.log.warn('prompt injection detected', { score, matches: allMatches, action });

    config.onDetection?.(result);

    switch (action) {
      case 'block':
        throw new PipelineError(
          `Request blocked by prompt guard (score: ${score.toFixed(2)})`,
          'content_filter',
          'prompt-guard',
          400
        );

      case 'flag':
        ctx.metadata.set('promptGuard.flagged', true);
        ctx.metadata.set('promptGuard.score', score);
        ctx.metadata.set('promptGuard.matches', allMatches);
        await next();
        return;

      case 'sanitize':
        // Mutate messages in-place, stripping matched patterns
        for (const msg of ctx.request.messages) {
          if (excludeRoles.has(msg.role)) continue;
          msg.content = sanitizeContent(msg.content, patterns, maxScanLength);
        }
        ctx.metadata.set('promptGuard.sanitized', true);
        ctx.metadata.set('promptGuard.score', score);
        await next();
        return;

      case 'log':
        // Already logged above — just continue
        ctx.metadata.set('promptGuard.score', score);
        await next();
        return;
    }
  };
}

// ─── Named Middleware (for plugin/config-driven loading) ───

/**
 * Pre-configured named middleware with priority 10 (runs before inject-system).
 * Can be referenced as `'prompt-guard'` in route middleware arrays.
 */
export const promptGuardMiddleware: NamedMiddleware = defineMiddleware(
  'prompt-guard',
  async (ctx, next) => {
    // Default config when loaded by name — can be overridden via route config
    const routeConfig = ctx.metadata.get('promptGuard.config') as PromptGuardConfig | undefined;
    const mw = createPromptGuard(routeConfig ?? {});
    await mw(ctx, next);
  },
  { priority: 10 }
);
