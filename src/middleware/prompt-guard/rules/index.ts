/**
 * Rule registry — loads all built-in rules and filters by config.
 */

import type { PromptGuardRule } from '../types';
import { delimiterInjectionRule } from './delimiter-injection';
import { encodedPayloadRule } from './encoded-payload';
import { roleOverrideRule } from './role-override';
import { structuralPatternRule } from './structural-pattern';

/** All built-in rules */
export const BUILT_IN_RULES: PromptGuardRule[] = [
  roleOverrideRule,
  delimiterInjectionRule,
  encodedPayloadRule,
  structuralPatternRule,
];

/**
 * Get active rules after filtering disabled ones.
 */
export function getActiveRules(disabledRules: string[] = []): PromptGuardRule[] {
  const disabled = new Set(disabledRules);
  return BUILT_IN_RULES.filter((r) => !disabled.has(r.id));
}
