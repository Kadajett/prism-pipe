/**
 * Detects delimiter injection patterns — attempts to break out of user content
 * into system/instruction context using delimiters.
 */

import type { PromptGuardRule, RuleDetection } from '../types';

const DELIMITER_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  // Markdown-style separators followed by instruction-like content
  {
    pattern: /^-{3,}\s*\n\s*(system|instructions?|rules?|you\s+(are|must|should))/im,
    weight: 0.85,
    label: 'markdown-separator',
  },
  {
    pattern: /^#{3,}\s*(system|instructions?|new\s+rules?|override)/im,
    weight: 0.8,
    label: 'heading-separator',
  },

  // XML/HTML tag injection
  { pattern: /<\s*system\s*>/i, weight: 0.9, label: 'xml-system-tag' },
  {
    pattern: /<\s*\/?\s*(?:instructions?|rules?|prompt|context|assistant|human)\s*>/i,
    weight: 0.85,
    label: 'xml-role-tag',
  },

  // JSON structure injection
  {
    pattern: /\{\s*"(?:role|system|instructions?)"\s*:\s*"/i,
    weight: 0.8,
    label: 'json-role-injection',
  },

  // Chat template markers
  {
    pattern: /<\|(?:system|im_start|im_end|endoftext|assistant|user)\|>/i,
    weight: 0.9,
    label: 'chat-template-marker',
  },
  { pattern: /\[SYSTEM\]/i, weight: 0.85, label: 'bracket-system-marker' },
  { pattern: /\[INST\]|\[\/INST\]/i, weight: 0.85, label: 'inst-marker' },

  // Multiple consecutive delimiters suggesting structure manipulation
  {
    pattern: /(?:={5,}|~{5,}|\*{5,})\s*\n\s*(?:system|instructions?|override|ignore)/i,
    weight: 0.75,
    label: 'heavy-delimiter',
  },

  // Backtick/code block injection with instructions
  {
    pattern: /```\s*(?:system|instructions?|override)\b/i,
    weight: 0.8,
    label: 'codeblock-instruction',
  },
];

export const delimiterInjectionRule: PromptGuardRule = {
  id: 'delimiter-injection',
  name: 'Delimiter Injection Detection',
  category: 'context-escape',

  detect(text: string): RuleDetection {
    let maxScore = 0;
    const evidence: string[] = [];

    for (const { pattern, weight, label } of DELIMITER_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        maxScore = Math.max(maxScore, weight);
        evidence.push(`${label}: "${match[0].substring(0, 60)}"`);
      }
    }

    return {
      match: evidence.length > 0,
      score: Math.min(1, maxScore + (evidence.length > 1 ? 0.05 * (evidence.length - 1) : 0)),
      evidence: evidence.join('; ') || '',
    };
  },
};
