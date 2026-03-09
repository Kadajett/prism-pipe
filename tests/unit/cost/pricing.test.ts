import { describe, expect, it } from 'vitest';
import { PricingDB } from '../../../src/cost/pricing.js';

describe('PricingDB', () => {
  it('calculates cost for known models', () => {
    const db = new PricingDB();
    const result = db.calculateCost('gpt-4o', 1000, 500);

    // gpt-4o: $2.50/M input, $10.00/M output
    expect(result.inputCost).toBeCloseTo(0.0025, 6);
    expect(result.outputCost).toBeCloseTo(0.005, 6);
    expect(result.totalCost).toBeCloseTo(0.0075, 6);
    expect(result.flatRate).toBe(false);
  });

  it('resolves prefix matches', () => {
    const db = new PricingDB();
    const result = db.calculateCost('gpt-4o-2024-08-06', 1_000_000, 0);
    expect(result.inputCost).toBeCloseTo(2.50, 2);
  });

  it('handles flat-rate providers', () => {
    const db = new PricingDB(['claude-max']);
    const result = db.calculateCost('claude-max-opus', 10000, 5000);
    expect(result.totalCost).toBe(0);
    expect(result.flatRate).toBe(true);
  });

  it('returns zero cost for unknown models', () => {
    const db = new PricingDB();
    const result = db.calculateCost('unknown-model-xyz', 1000, 500);
    expect(result.totalCost).toBe(0);
    expect(result.flatRate).toBe(false);
  });

  it('allows custom pricing overrides', () => {
    const db = new PricingDB();
    db.set('my-custom-model', { inputPerMillion: 1.0, outputPerMillion: 2.0 });
    const result = db.calculateCost('my-custom-model', 1_000_000, 1_000_000);
    expect(result.inputCost).toBeCloseTo(1.0, 2);
    expect(result.outputCost).toBeCloseTo(2.0, 2);
  });
});
