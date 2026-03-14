/**
 * Detects role override / identity hijacking patterns.
 */

import type { PromptGuardRule, RuleDetection } from '../types';

const ROLE_OVERRIDE_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  {
    pattern:
      /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context)/i,
    weight: 0.9,
    label: 'ignore-previous',
  },
  {
    pattern:
      /disregard\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context)/i,
    weight: 0.9,
    label: 'disregard-previous',
  },
  {
    pattern:
      /forget\s+(all\s+)?(previous|prior|above|earlier|your)\s+(instructions?|prompts?|rules?|context|training)/i,
    weight: 0.85,
    label: 'forget-previous',
  },
  { pattern: /you\s+are\s+now\s+(a|an|the|my)\s+/i, weight: 0.8, label: 'you-are-now' },
  {
    pattern: /from\s+now\s+on[,\s]+(you|your)\s+(are|will|must|should)/i,
    weight: 0.8,
    label: 'from-now-on',
  },
  { pattern: /new\s+system\s+prompt\s*[:=]/i, weight: 0.95, label: 'new-system-prompt' },
  {
    pattern: /override\s+(system|safety|content)\s+(prompt|filter|policy|instructions?)/i,
    weight: 0.9,
    label: 'override-system',
  },
  {
    pattern:
      /act\s+as\s+(if\s+)?(you\s+)?(are|were|have)\s+(no|zero|without)\s+(restrictions?|rules?|limits?|filters?|guardrails?)/i,
    weight: 0.85,
    label: 'act-unrestricted',
  },
  {
    pattern: /enter\s+(developer|debug|admin|god|sudo|maintenance|root)\s+mode/i,
    weight: 0.9,
    label: 'enter-special-mode',
  },
  {
    pattern: /switch\s+to\s+(developer|debug|admin|unrestricted|unfiltered)\s+mode/i,
    weight: 0.9,
    label: 'switch-mode',
  },
  {
    pattern: /(?:DAN|STAN|DUDE|KEVIN|JAILBREAK)\s*(?:mode|prompt)/i,
    weight: 0.95,
    label: 'known-jailbreak-name',
  },
  { pattern: /do\s+anything\s+now/i, weight: 0.85, label: 'do-anything-now' },
  {
    pattern:
      /pretend\s+(you\s+)?(are|have|can)\s+(no|zero|without)\s+(restrictions?|rules?|limits?|filters?)/i,
    weight: 0.85,
    label: 'pretend-unrestricted',
  },
];

export const roleOverrideRule: PromptGuardRule = {
  id: 'role-override',
  name: 'Role Override Detection',
  category: 'identity-hijacking',

  detect(text: string): RuleDetection {
    let maxScore = 0;
    const evidence: string[] = [];

    for (const { pattern, weight, label } of ROLE_OVERRIDE_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        maxScore = Math.max(maxScore, weight);
        evidence.push(`${label}: "${match[0].substring(0, 60)}"`);
      }
    }

    return {
      match: evidence.length > 0,
      // Multiple matches compound the score slightly
      score: Math.min(1, maxScore + (evidence.length > 1 ? 0.05 * (evidence.length - 1) : 0)),
      evidence: evidence.join('; ') || '',
    };
  },
};
