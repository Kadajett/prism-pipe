import { describe, expect, it } from 'vitest';
import { createTimeoutBudget } from './timeout';

describe('TimeoutBudget', () => {
  it('tracks remaining time', () => {
    const budget = createTimeoutBudget(5000);
    expect(budget.totalMs).toBe(5000);
    expect(budget.remaining()).toBeLessThanOrEqual(5000);
    expect(budget.remaining()).toBeGreaterThan(4900);
    expect(budget.hasTime()).toBe(true);
  });

  it('slice() creates child budget capped at remaining', () => {
    const parent = createTimeoutBudget(1000);
    const child = parent.slice(500);
    expect(child.totalMs).toBe(500);
    expect(child.hasTime()).toBe(true);
  });

  it('slice() without maxMs uses remaining time', () => {
    const parent = createTimeoutBudget(2000);
    const child = parent.slice();
    expect(child.totalMs).toBeLessThanOrEqual(2000);
    expect(child.totalMs).toBeGreaterThan(1900);
  });

  it('child budget cannot exceed parent remaining', () => {
    const parent = createTimeoutBudget(500);
    const child = parent.slice(10_000); // ask for 10s but only 500ms left
    expect(child.totalMs).toBeLessThanOrEqual(500);
  });

  it('signal fires at deadline', async () => {
    const budget = createTimeoutBudget(50);
    expect(budget.signal.aborted).toBe(false);
    await new Promise((r) => setTimeout(r, 100));
    expect(budget.signal.aborted).toBe(true);
    expect(budget.hasTime()).toBe(false);
    expect(budget.remaining()).toBe(0);
  });

  it('expired budget has no time for slices', async () => {
    const budget = createTimeoutBudget(30);
    await new Promise((r) => setTimeout(r, 60));
    const child = budget.slice(1000);
    expect(child.totalMs).toBe(0);
    expect(child.hasTime()).toBe(false);
  });
});
