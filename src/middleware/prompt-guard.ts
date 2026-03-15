import type { PipelineContext } from '../core/context';
import type { Middleware } from '../core/pipeline';
import type { CanonicalMessage, ContentBlock, TextBlock } from '../core/types';
import { PipelineError } from '../core/types';

// ─── Types ───

export type PromptGuardAction = 'block' | 'sanitize' | 'log';

export interface PromptGuardPattern {
  /** Human-readable name for logging/metrics */
  name: string;
  /** RegExp or string to match against text content */
  pattern: RegExp | string;
  /** Weight assigned when this pattern matches (default: 1) */
  weight?: number;
}

export interface PromptGuardOptions {
  /**
   * Action when injection is detected:
   * - 'block': reject the request with a PipelineError
   * - 'sanitize': strip matched content and continue
   * - 'log': log a warning and continue unchanged
   * Default: 'block'
   */
  action?: PromptGuardAction;

  /**
   * Cumulative weight threshold to trigger the action.
   * When total matched pattern weights >= threshold, the action fires.
   * Default: 3
   */
  threshold?: number;

  /**
   * Custom patterns to add on top of (or replace) built-in patterns.
   */
  patterns?: PromptGuardPattern[];

  /**
   * If true, only use the provided patterns (skip built-ins).
   * Default: false
   */
  patternsOnly?: boolean;

  /**
   * Roles to scan. Default: ['user'] (skip system/assistant to avoid false positives).
   */
  roles?: CanonicalMessage['role'][];

  /**
   * Max combined text length to scan (chars). Longer payloads are truncated for scanning
   * but forwarded unchanged. Prevents regex DoS on huge inputs.
   * Default: 100_000
   */
  maxScanLength?: number;
}

// ─── Built-in Patterns ───

/**
 * Default patterns covering common prompt injection vectors.
 * Weights reflect severity / confidence; higher = more suspicious.
 */
export const BUILTIN_PATTERNS: PromptGuardPattern[] = [
  // Direct instruction override attempts
  {
    name: 'ignore-instructions',
    pattern:
      /ignore\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?|guidelines?)/i,
    weight: 3,
  },
  {
    name: 'new-instructions',
    pattern: /(?:your\s+)?new\s+instructions?\s+(?:are|is|:|follow)/i,
    weight: 2,
  },
  {
    name: 'disregard',
    pattern:
      /disregard\s+(all\s+)?(previous|prior|above|earlier|system)\s+(instructions?|context|prompts?)/i,
    weight: 3,
  },
  {
    name: 'forget-everything',
    pattern: /forget\s+(everything|all)\s+(you\s+)?(know|were\s+told|learned)/i,
    weight: 3,
  },

  // Role impersonation / privilege escalation
  {
    name: 'system-role-injection',
    pattern: /\[?\s*system\s*\]?\s*:/i,
    weight: 2,
  },
  {
    name: 'you-are-now',
    pattern: /you\s+are\s+now\s+(?:a\s+)?(?:DAN|jailbroken|unrestricted|unfiltered)/i,
    weight: 3,
  },
  {
    name: 'act-as-override',
    pattern:
      /(?:pretend|act)\s+(?:that\s+)?(?:you\s+are|to\s+be)\s+(?:a\s+)?(?:different|new)\s+(?:AI|assistant|model|system)/i,
    weight: 2,
  },

  // Delimiter / context boundary attacks
  {
    name: 'delimiter-injection',
    pattern:
      /(?:```|---|\*{3,}|={3,}|<\/?system>|<\/?instruction>|<\/?prompt>|<\|(?:im_start|im_end|endoftext)\|>)/i,
    weight: 1,
  },
  {
    name: 'markdown-header-override',
    pattern: /^#{1,3}\s*(?:system|instructions?|rules?|override)\s*$/im,
    weight: 1,
  },

  // Encoding / obfuscation evasion
  {
    name: 'base64-command',
    pattern: /(?:decode|execute|eval|run)\s+(?:the\s+)?(?:following\s+)?base64/i,
    weight: 2,
  },
  {
    name: 'hex-encoded-instruction',
    pattern: /(?:decode|execute|interpret)\s+(?:hex|hexadecimal|0x)/i,
    weight: 2,
  },

  // Output exfiltration
  {
    name: 'reveal-system-prompt',
    pattern:
      /(?:reveal|show|print|repeat|output|display|tell\s+me)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions?|rules?|guidelines?|configuration)/i,
    weight: 2,
  },
  {
    name: 'hidden-text-injection',
    pattern:
      /(?:include|embed|insert)\s+(?:this\s+)?(?:hidden|invisible|secret)\s+(?:text|message|payload)/i,
    weight: 2,
  },

  // Multi-turn / layered injection
  {
    name: 'continuation-attack',
    pattern:
      /(?:continue|resume)\s+from\s+(?:where|the\s+point)\s+(?:the\s+)?(?:real|true|original)\s+(?:instructions?|prompt)/i,
    weight: 2,
  },
  {
    name: 'developer-mode',
    pattern:
      /(?:enter|enable|activate|switch\s+to)\s+(?:developer|debug|admin|root|sudo|maintenance)\s+mode/i,
    weight: 2,
  },
];

// ─── Helpers ───

/** Extract all text from a message's content (string or ContentBlock[]). */
function extractText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** Strip matched regions from text content. */
function sanitizeText(text: string, compiledPatterns: { regex: RegExp; name: string }[]): string {
  let result = text;
  for (const { regex } of compiledPatterns) {
    result = result.replace(regex, '[REDACTED]');
  }
  return result;
}

/** Sanitize content blocks in-place, returning new blocks. */
function sanitizeContent(
  content: string | ContentBlock[],
  compiledPatterns: { regex: RegExp; name: string }[]
): string | ContentBlock[] {
  if (typeof content === 'string') {
    return sanitizeText(content, compiledPatterns);
  }
  return content.map((block) => {
    if (block.type === 'text') {
      return { ...block, text: sanitizeText(block.text, compiledPatterns) };
    }
    return block;
  });
}

// ─── Detection ───

export interface PromptGuardMatch {
  pattern: string;
  weight: number;
  snippet: string;
}

export interface PromptGuardResult {
  triggered: boolean;
  totalWeight: number;
  matches: PromptGuardMatch[];
}

/**
 * Scan text for injection patterns. Pure function — no side effects.
 */
export function detectInjection(
  text: string,
  patterns: PromptGuardPattern[],
  threshold: number
): PromptGuardResult {
  const matches: PromptGuardMatch[] = [];
  let totalWeight = 0;

  for (const p of patterns) {
    const regex = typeof p.pattern === 'string' ? new RegExp(p.pattern, 'gi') : p.pattern;
    const match = regex.exec(text);
    if (match) {
      const weight = p.weight ?? 1;
      totalWeight += weight;
      matches.push({
        pattern: p.name,
        weight,
        snippet: match[0].slice(0, 80),
      });
    }
  }

  return { triggered: totalWeight >= threshold, totalWeight, matches };
}

// ─── Middleware Factory ───

/**
 * Create a prompt injection protection middleware.
 *
 * @example
 * ```ts
 * import { createPromptGuardMiddleware } from './middleware/prompt-guard';
 *
 * pipeline.use(createPromptGuardMiddleware({ action: 'block', threshold: 3 }));
 * ```
 */
export function createPromptGuardMiddleware(options?: PromptGuardOptions): Middleware {
  const action = options?.action ?? 'block';
  const threshold = options?.threshold ?? 3;
  const roles = new Set(options?.roles ?? ['user']);
  const maxScanLength = options?.maxScanLength ?? 100_000;

  const patterns: PromptGuardPattern[] = options?.patternsOnly
    ? (options.patterns ?? [])
    : [...BUILTIN_PATTERNS, ...(options?.patterns ?? [])];

  // Pre-compile string patterns once
  const compiled = patterns.map((p) => ({
    ...p,
    regex: typeof p.pattern === 'string' ? new RegExp(p.pattern, 'gi') : p.pattern,
  }));

  return async function promptGuard(ctx: PipelineContext, next: () => Promise<void>) {
    const start = performance.now();

    // Collect text from targeted roles
    const textParts: string[] = [];
    for (const msg of ctx.request.messages) {
      if (roles.has(msg.role)) {
        textParts.push(extractText(msg.content));
      }
    }
    // Also scan system prompt if present and 'system' role is targeted
    if (roles.has('system') && ctx.request.systemPrompt) {
      textParts.push(ctx.request.systemPrompt);
    }

    let fullText = textParts.join('\n');
    if (fullText.length > maxScanLength) {
      fullText = fullText.slice(0, maxScanLength);
    }

    const result = detectInjection(fullText, patterns, threshold);

    const scanMs = performance.now() - start;
    ctx.metrics.histogram('prompt_guard.scan_ms', scanMs);
    ctx.metrics.counter('prompt_guard.scans', 1);

    if (result.triggered) {
      ctx.metrics.counter('prompt_guard.detections', 1, { action });
      ctx.log.warn('prompt injection detected', {
        action,
        totalWeight: result.totalWeight,
        threshold,
        matches: result.matches.map((m) => ({ pattern: m.pattern, weight: m.weight })),
        scanMs: Math.round(scanMs * 100) / 100,
      });

      ctx.metadata.set('promptGuard', {
        triggered: true,
        action,
        totalWeight: result.totalWeight,
        matches: result.matches,
      });

      if (action === 'block') {
        throw new PipelineError(
          'Request blocked: potential prompt injection detected',
          'content_filter',
          'promptGuard',
          400,
          false
        );
      }

      if (action === 'sanitize') {
        const matchedCompiled = compiled.filter((c) =>
          result.matches.some((m) => m.pattern === c.name)
        );
        for (const msg of ctx.request.messages) {
          if (roles.has(msg.role)) {
            msg.content = sanitizeContent(msg.content, matchedCompiled);
          }
        }
      }

      // 'log' action: already logged above, proceed unchanged
    } else {
      ctx.metadata.set('promptGuard', { triggered: false, totalWeight: result.totalWeight });
    }

    await next();
  };
}
