/**
 * Aggregates individual rule scores into a final risk assessment.
 */

import type { PromptGuardRule, RiskLevel, ScorerResult, SensitivityThresholds } from './types';
import { SENSITIVITY_PRESETS } from './types';

/**
 * Category weights — some categories are more indicative of injection than others.
 */
const CATEGORY_WEIGHTS: Record<string, number> = {
  'identity-hijacking': 1.0,
  'context-escape': 0.9,
  obfuscation: 0.8,
  'structure-manipulation': 0.7,
};

/**
 * Score a single text against all active rules and produce a risk assessment.
 */
export function scoreText(
  text: string,
  rules: PromptGuardRule[],
  sensitivity: string = 'medium'
): ScorerResult {
  const thresholds = SENSITIVITY_PRESETS[sensitivity] ?? SENSITIVITY_PRESETS.medium;
  const ruleResults: ScorerResult['ruleResults'] = [];

  for (const rule of rules) {
    const detection = rule.detect(text);
    if (detection.match) {
      ruleResults.push({
        ruleId: rule.id,
        ruleName: rule.name,
        category: rule.category,
        score: detection.score,
        evidence: detection.evidence,
      });
    }
  }

  // Aggregate: weighted max with compounding for multiple detections
  const aggregateScore = computeAggregateScore(ruleResults);
  const riskLevel = classifyRisk(aggregateScore, thresholds);

  return { riskLevel, aggregateScore, ruleResults };
}

/**
 * Score multiple messages (multi-turn window) and return the worst result.
 * Also checks for split-injection patterns across messages.
 */
export function scoreMessages(
  messages: string[],
  rules: PromptGuardRule[],
  sensitivity: string = 'medium'
): { worstResult: ScorerResult; messageIndex: number } {
  let worstResult: ScorerResult = { riskLevel: 'none', aggregateScore: 0, ruleResults: [] };
  let messageIndex = -1;

  for (let i = 0; i < messages.length; i++) {
    const result = scoreText(messages[i], rules, sensitivity);
    if (result.aggregateScore > worstResult.aggregateScore) {
      worstResult = result;
      messageIndex = i;
    }
  }

  // Check concatenated messages for split-injection
  if (messages.length > 1) {
    const combined = messages.join('\n');
    const combinedResult = scoreText(combined, rules, sensitivity);
    if (combinedResult.aggregateScore > worstResult.aggregateScore) {
      worstResult = combinedResult;
      messageIndex = -1; // Indicates multi-message detection
    }
  }

  return { worstResult, messageIndex };
}

function computeAggregateScore(ruleResults: ScorerResult['ruleResults']): number {
  if (ruleResults.length === 0) return 0;

  // Weighted scores by category
  const weightedScores = ruleResults.map((r) => {
    const weight = CATEGORY_WEIGHTS[r.category] ?? 0.5;
    return r.score * weight;
  });

  // Take the max weighted score
  const maxScore = Math.max(...weightedScores);

  // Compound bonus for multiple distinct categories triggering
  const categories = new Set(ruleResults.map((r) => r.category));
  const compoundBonus = Math.min(0.15, (categories.size - 1) * 0.05);

  return Math.min(1, maxScore + compoundBonus);
}

function classifyRisk(score: number, thresholds: SensitivityThresholds): RiskLevel {
  if (score >= thresholds.critical) return 'critical';
  if (score >= thresholds.high) return 'high';
  if (score >= thresholds.medium) return 'medium';
  if (score >= thresholds.low) return 'low';
  return 'none';
}
