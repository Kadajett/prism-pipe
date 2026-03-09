import { describe, expect, it, vi } from 'vitest';
import { CostTracker } from '../../../src/cost/tracker.js';

describe('CostTracker', () => {
  it('tracks cost per request', () => {
    const tracker = new CostTracker();
    const cost = tracker.track({
      key: 'user-1',
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(cost.totalCost).toBeGreaterThan(0);
    expect(cost.flatRate).toBe(false);

    const records = tracker.getRecords();
    expect(records.length).toBeGreaterThanOrEqual(2); // daily + monthly
  });

  it('handles flat-rate tracking', () => {
    const tracker = new CostTracker({ flatRate: ['claude-max'] });
    const cost = tracker.track({
      key: 'user-1',
      provider: 'anthropic',
      model: 'claude-max-opus',
      inputTokens: 10000,
      outputTokens: 5000,
    });

    expect(cost.totalCost).toBe(0);
    expect(cost.flatRate).toBe(true);

    // Tokens are still tracked in records
    const records = tracker.getRecords();
    const dailyRecord = records.find((r) => r.periodType === 'daily');
    expect(dailyRecord?.inputTokens).toBe(10000);
    expect(dailyRecord?.outputTokens).toBe(5000);
  });

  it('fires budget alerts at configured thresholds', () => {
    const alerts: unknown[] = [];
    const tracker = new CostTracker({
      budget: {
        enabled: true,
        daily: 1.0, // $1/day
        alertAt: [80, 100],
        hardLimit: false,
        handlers: [{ type: 'log' }],
      },
    });
    tracker.onAlert((a) => alerts.push(a));

    // Spend $0.90 (90%) — should fire 80% alert
    tracker.track({
      key: 'user-1',
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 360_000, // ~$0.90
      outputTokens: 0,
    });

    expect(alerts.length).toBe(1);
    expect((alerts[0] as { threshold: number }).threshold).toBe(80);
  });

  it('rejects requests when hard limit exceeded', () => {
    const tracker = new CostTracker({
      budget: {
        enabled: true,
        daily: 0.001, // Very low limit
        alertAt: [100],
        hardLimit: true,
        handlers: [],
      },
    });

    // Spend over the limit
    tracker.track({
      key: 'user-1',
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 10_000,
      outputTokens: 10_000,
    });

    const result = tracker.isOverBudget('user-1');
    expect(result.exceeded).toBe(true);
    expect(result.periodType).toBe('daily');
  });

  it('allows requests when under budget', () => {
    const tracker = new CostTracker({
      budget: {
        enabled: true,
        daily: 100,
        alertAt: [80],
        hardLimit: true,
        handlers: [],
      },
    });

    tracker.track({
      key: 'user-1',
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(tracker.isOverBudget('user-1').exceeded).toBe(false);
  });
});
