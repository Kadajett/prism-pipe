/**
 * CostTracker — aggregates per-request costs by key/tenant/provider.
 * Persisted to store, with in-memory accumulator for performance.
 */

import type { CostRecord, BudgetAlert, BudgetConfig } from '../metrics/types.js';
import { PricingDB } from './pricing.js';

export interface CostTrackerOptions {
  flatRate?: string[];
  budget?: BudgetConfig;
}

export class CostTracker {
  readonly pricing: PricingDB;
  private readonly records = new Map<string, CostRecord>();
  private readonly budget: BudgetConfig | undefined;
  private readonly alertsFired = new Set<string>(); // dedup alerts within a period
  private readonly alertHandlers: ((alert: BudgetAlert) => void)[] = [];

  constructor(opts: CostTrackerOptions = {}) {
    this.pricing = new PricingDB(opts.flatRate);
    this.budget = opts.budget;
  }

  onAlert(handler: (alert: BudgetAlert) => void): void {
    this.alertHandlers.push(handler);
  }

  /**
   * Record cost for a request.
   * Returns the cost breakdown for response headers.
   */
  track(params: {
    key: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
  }): { totalCost: number; inputCost: number; outputCost: number; flatRate: boolean } {
    const cost = this.pricing.calculateCost(params.model, params.inputTokens, params.outputTokens);
    const now = new Date();
    const dailyPeriod = now.toISOString().slice(0, 10);
    const monthlyPeriod = now.toISOString().slice(0, 7);

    // Accumulate daily
    this.accumulate({
      key: params.key,
      provider: params.provider,
      model: params.model,
      period: dailyPeriod,
      periodType: 'daily',
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalCost: cost.totalCost,
      requestCount: 1,
    });

    // Accumulate monthly
    this.accumulate({
      key: params.key,
      provider: params.provider,
      model: params.model,
      period: monthlyPeriod,
      periodType: 'monthly',
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      totalCost: cost.totalCost,
      requestCount: 1,
    });

    // Check budgets
    if (this.budget?.enabled) {
      this.checkBudget(params.key, dailyPeriod, 'daily', this.budget.daily);
      this.checkBudget(params.key, monthlyPeriod, 'monthly', this.budget.monthly);
    }

    return cost;
  }

  /** Check if a key has exceeded its budget (for hard enforcement) */
  isOverBudget(key: string): { exceeded: boolean; periodType?: 'daily' | 'monthly' } {
    if (!this.budget?.enabled || !this.budget.hardLimit) {
      return { exceeded: false };
    }

    const now = new Date();
    const dailyPeriod = now.toISOString().slice(0, 10);
    const monthlyPeriod = now.toISOString().slice(0, 7);

    if (this.budget.daily) {
      const spend = this.getSpend(key, dailyPeriod, 'daily');
      if (spend >= this.budget.daily) return { exceeded: true, periodType: 'daily' };
    }

    if (this.budget.monthly) {
      const spend = this.getSpend(key, monthlyPeriod, 'monthly');
      if (spend >= this.budget.monthly) return { exceeded: true, periodType: 'monthly' };
    }

    return { exceeded: false };
  }

  /** Get total spend for a key in a period */
  getSpend(key: string, period: string, periodType: 'daily' | 'monthly'): number {
    let total = 0;
    for (const [rk, record] of this.records) {
      if (rk.startsWith(`${key}:`) && record.period === period && record.periodType === periodType) {
        total += record.totalCost;
      }
    }
    return total;
  }

  /** Get all records (for persistence) */
  getRecords(): CostRecord[] {
    return [...this.records.values()];
  }

  private accumulate(record: CostRecord): void {
    const rk = `${record.key}:${record.provider}:${record.model}:${record.period}:${record.periodType}`;
    const existing = this.records.get(rk);
    if (existing) {
      existing.inputTokens += record.inputTokens;
      existing.outputTokens += record.outputTokens;
      existing.totalCost += record.totalCost;
      existing.requestCount += record.requestCount;
    } else {
      this.records.set(rk, { ...record });
    }
  }

  private checkBudget(
    key: string,
    period: string,
    periodType: 'daily' | 'monthly',
    limit?: number
  ): void {
    if (!limit || !this.budget) return;
    const spend = this.getSpend(key, period, periodType);
    const pct = (spend / limit) * 100;

    for (const threshold of this.budget.alertAt) {
      if (pct >= threshold) {
        const alertKey = `${key}:${period}:${periodType}:${threshold}`;
        if (!this.alertsFired.has(alertKey)) {
          this.alertsFired.add(alertKey);
          const alert: BudgetAlert = { key, periodType, period, threshold, currentSpend: spend, limit };
          for (const handler of this.alertHandlers) {
            handler(alert);
          }
        }
      }
    }
  }
}
