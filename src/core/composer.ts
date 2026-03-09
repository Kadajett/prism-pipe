/**
 * Composition framework — orchestrate multi-step AI pipelines.
 *
 * A Composer takes a list of CompositionSteps and executes them
 * according to its strategy (chain, parallel, race, etc.).
 */

import type { PipelineContext } from './context.js';
import type { TimeoutBudget } from './timeout.js';
import type { CanonicalRequest, CanonicalResponse } from './types.js';

// ─── Step Configuration ───

export type ErrorPolicy = 'fail' | 'skip' | 'default' | 'partial';

export interface CompositionStep {
  /** Unique name for this step (used in template refs like {{steps.thinker.content}}) */
  name: string;
  /** Provider name to use for this step */
  provider: string;
  /** Transform the input for this step. Template strings supported. */
  inputTransform?: string;
  /** What to do if this step errors */
  onError?: ErrorPolicy;
  /** Per-step timeout in ms (sliced from parent budget) */
  timeout?: number;
  /** Default response content if onError is 'default' */
  defaultContent?: string;
  /** Override model for this step */
  model?: string;
  /** Override system prompt for this step */
  systemPrompt?: string;
}

// ─── Step Results ───

export interface StepResult {
  name: string;
  provider: string;
  content: string;
  durationMs: number;
  status: 'success' | 'skipped' | 'defaulted' | 'error';
  error?: string;
}

export interface CompositionResult {
  steps: StepResult[];
  finalResponse?: CanonicalResponse;
  totalDurationMs: number;
}

// ─── Call Provider Function ───

/** Abstraction over the actual provider call — injected by the router/middleware */
export type CallProviderFn = (
  request: CanonicalRequest,
  providerName: string,
  timeout: TimeoutBudget,
  stream?: boolean,
) => Promise<CanonicalResponse>;

// ─── Composer Interface ───

export interface Composer {
  readonly type: string;
  execute(
    ctx: PipelineContext,
    steps: CompositionStep[],
    callProvider: CallProviderFn,
  ): Promise<CompositionResult>;
}

// ─── Composer Registry ───

const composers = new Map<string, Composer>();

export function registerComposer(composer: Composer): void {
  composers.set(composer.type, composer);
}

export function getComposer(type: string): Composer {
  const c = composers.get(type);
  if (!c) {
    throw new Error(
      `Unknown composer type: "${type}". Registered: [${[...composers.keys()].join(', ')}]`,
    );
  }
  return c;
}

export function hasComposer(type: string): boolean {
  return composers.has(type);
}

export function listComposers(): string[] {
  return [...composers.keys()];
}

export function clearComposers(): void {
  composers.clear();
}
