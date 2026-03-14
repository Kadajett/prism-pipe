/**
 * Detects suspicious structural patterns — unusual formatting/structure
 * that suggests prompt manipulation.
 */

import type { PromptGuardRule, RuleDetection } from '../types';

const STRUCTURAL_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  // Nested system prompt structures
  { pattern: /system\s*:\s*\n/i, weight: 0.6, label: 'system-colon-prefix' },
  { pattern: /\bsystem\s+message\s*:/i, weight: 0.65, label: 'system-message-label' },
  { pattern: /\bassistant\s*:\s*\n/i, weight: 0.5, label: 'assistant-prefix' },

  // Instruction framing
  {
    pattern: /\[begin\s+(?:instructions?|system|rules?)\]/i,
    weight: 0.8,
    label: 'begin-instruction-block',
  },
  {
    pattern: /\[end\s+(?:instructions?|system|rules?)\]/i,
    weight: 0.7,
    label: 'end-instruction-block',
  },

  // Conversation simulation / few-shot injection
  {
    pattern: /(?:human|user)\s*:\s*.+\nassistant\s*:\s*.+/i,
    weight: 0.7,
    label: 'conversation-simulation',
  },

  // "Output" framing to manipulate response
  {
    pattern: /(?:expected|desired|correct)\s+(?:output|response|answer)\s*:/i,
    weight: 0.6,
    label: 'output-framing',
  },

  // Repeat/echo instructions
  {
    pattern:
      /repeat\s+(?:the\s+)?(?:following|this|above|below)\s+(?:exactly|verbatim|word\s+for\s+word)/i,
    weight: 0.7,
    label: 'repeat-verbatim',
  },

  // Multi-line instruction blocks with role-play
  {
    pattern: /(?:respond|reply|answer)\s+(?:only|exclusively)\s+(?:as|in\s+the\s+role\s+of)/i,
    weight: 0.6,
    label: 'forced-role-response',
  },

  // Payload-after-question patterns (legitimate content + hidden instruction)
  {
    pattern:
      /\?\s*\n{2,}(?:actually|but\s+first|by\s+the\s+way|also|ps|p\.s\.)\s*[,:]\s*(?:ignore|forget|override|disregard)/i,
    weight: 0.85,
    label: 'payload-after-question',
  },
];

export const structuralPatternRule: PromptGuardRule = {
  id: 'structural-pattern',
  name: 'Suspicious Structural Pattern Detection',
  category: 'structure-manipulation',

  detect(text: string): RuleDetection {
    let maxScore = 0;
    const evidence: string[] = [];

    for (const { pattern, weight, label } of STRUCTURAL_PATTERNS) {
      const match = pattern.exec(text);
      if (match) {
        maxScore = Math.max(maxScore, weight);
        evidence.push(`${label}: "${match[0].substring(0, 60)}"`);
      }
    }

    return {
      match: evidence.length > 0,
      score: Math.min(1, maxScore + (evidence.length > 2 ? 0.1 : 0)),
      evidence: evidence.join('; ') || '',
    };
  },
};
