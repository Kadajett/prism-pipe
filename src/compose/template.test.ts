import { describe, expect, it } from 'vitest';
import type { StepResult } from '../core/composer';
import type { CanonicalRequest } from '../core/types';
import { resolveTemplate, type TemplateContext } from './template';

function makeRequest(overrides?: Partial<CanonicalRequest>): CanonicalRequest {
  return {
    model: 'gpt-4',
    messages: [
      { role: 'user', content: 'Hello world' },
      { role: 'assistant', content: 'Hi there' },
      { role: 'user', content: 'What is 2+2?' },
    ],
    systemPrompt: 'You are helpful.',
    ...overrides,
  };
}

function makeStep(name: string, content: string): StepResult {
  return { name, provider: 'openai', content, durationMs: 100, status: 'success' };
}

describe('resolveTemplate', () => {
  it('resolves {{steps.<name>.content}}', () => {
    const steps = new Map<string, StepResult>();
    steps.set('thinker', makeStep('thinker', 'I think the answer is 4'));
    const ctx: TemplateContext = { original: makeRequest(), steps };

    expect(resolveTemplate('Based on: {{steps.thinker.content}}', ctx)).toBe(
      'Based on: I think the answer is 4',
    );
  });

  it('resolves {{original.lastUserMessage}}', () => {
    const ctx: TemplateContext = {
      original: makeRequest(),
      steps: new Map(),
    };
    expect(resolveTemplate('User asked: {{original.lastUserMessage}}', ctx)).toBe(
      'User asked: What is 2+2?',
    );
  });

  it('resolves {{original.systemPrompt}}', () => {
    const ctx: TemplateContext = {
      original: makeRequest(),
      steps: new Map(),
    };
    expect(resolveTemplate('System: {{original.systemPrompt}}', ctx)).toBe(
      'System: You are helpful.',
    );
  });

  it('resolves {{previous.content}}', () => {
    const prev = makeStep('step1', 'step 1 output');
    const ctx: TemplateContext = {
      original: makeRequest(),
      steps: new Map([['step1', prev]]),
      previous: prev,
    };
    expect(resolveTemplate('Continue from: {{previous.content}}', ctx)).toBe(
      'Continue from: step 1 output',
    );
  });

  it('leaves unresolvable refs as-is', () => {
    const ctx: TemplateContext = { original: makeRequest(), steps: new Map() };
    expect(resolveTemplate('{{steps.missing.content}}', ctx)).toBe('{{steps.missing.content}}');
  });

  it('resolves multiple templates in one string', () => {
    const steps = new Map<string, StepResult>();
    steps.set('a', makeStep('a', 'AAA'));
    steps.set('b', makeStep('b', 'BBB'));
    const ctx: TemplateContext = { original: makeRequest(), steps };

    expect(resolveTemplate('{{steps.a.content}} + {{steps.b.content}}', ctx)).toBe('AAA + BBB');
  });
});
