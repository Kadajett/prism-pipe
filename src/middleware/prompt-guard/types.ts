/**
 * Prompt Guard middleware types.
 */

import { z } from 'zod';

// ─── Risk Levels ───

export type RiskLevel = 'none' | 'low' | 'medium' | 'high' | 'critical';

export const RISK_LEVELS: readonly RiskLevel[] = [
  'none',
  'low',
  'medium',
  'high',
  'critical',
] as const;

// ─── Rule Interface ───

export interface RuleDetection {
  match: boolean;
  score: number; // 0.0 - 1.0
  evidence: string;
}

export interface PromptGuardRule {
  id: string;
  name: string;
  category: string;
  detect(text: string): RuleDetection;
}

// ─── Sensitivity Thresholds ───

export interface SensitivityThresholds {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export const SENSITIVITY_PRESETS: Record<string, SensitivityThresholds> = {
  low: { low: 0.5, medium: 0.7, high: 0.85, critical: 0.95 },
  medium: { low: 0.3, medium: 0.5, high: 0.7, critical: 0.85 },
  high: { low: 0.15, medium: 0.35, high: 0.55, critical: 0.7 },
};

// ─── Config Schema ───

export const PromptGuardConfigSchema = z.object({
  enabled: z.boolean().default(true),
  mode: z.enum(['flag', 'block', 'log-only']).default('flag'),
  action: z
    .object({
      blockMessage: z.string().default('Request blocked: potential prompt injection detected'),
      blockStatusCode: z.number().int().default(403),
      headerName: z.string().default('X-Prism-Injection-Risk'),
    })
    .default({
      blockMessage: 'Request blocked: potential prompt injection detected',
      blockStatusCode: 403,
      headerName: 'X-Prism-Injection-Risk',
    }),
  layers: z
    .object({
      normalizer: z.boolean().default(true),
      heuristic: z.boolean().default(true),
      classifier: z
        .object({
          enabled: z.boolean().default(false),
          endpoint: z.string().optional(),
          timeoutMs: z.number().int().default(50),
        })
        .default({ enabled: false, timeoutMs: 50 }),
      dataset: z
        .object({
          enabled: z.boolean().default(false),
          path: z.string().optional(),
          acceptedTerms: z.boolean().default(false),
        })
        .default({ enabled: false, acceptedTerms: false }),
    })
    .default({
      normalizer: true,
      heuristic: true,
      classifier: { enabled: false, timeoutMs: 50 },
      dataset: { enabled: false, acceptedTerms: false },
    }),
  sensitivity: z.enum(['low', 'medium', 'high']).default('medium'),
  disabledRules: z.array(z.string()).default([]),
  excludeRoutes: z.array(z.string()).default([]),
  multiTurnWindow: z.number().int().min(1).default(3),
  audit: z
    .object({
      enabled: z.boolean().default(true),
      logNormalizedSnippet: z.boolean().default(true),
      maxSnippetLength: z.number().int().default(200),
    })
    .default({ enabled: true, logNormalizedSnippet: true, maxSnippetLength: 200 }),
});

export type PromptGuardConfig = z.infer<typeof PromptGuardConfigSchema>;

// ─── Injection Log Entry ───

export interface InjectionLogEntry {
  requestId: string;
  timestamp: number;
  riskLevel: RiskLevel;
  triggeredRules: Array<{ ruleId: string; score: number; evidence: string }>;
  actionTaken: 'flagged' | 'blocked' | 'logged';
  messageIndex: number;
  normalizedSnippet?: string;
}

// ─── Scorer Result ───

export interface ScorerResult {
  riskLevel: RiskLevel;
  aggregateScore: number;
  ruleResults: Array<{
    ruleId: string;
    ruleName: string;
    category: string;
    score: number;
    evidence: string;
  }>;
}
