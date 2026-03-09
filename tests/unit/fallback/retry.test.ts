import { describe, it, expect, vi } from 'vitest';
import { retryWithBackoff, calculateBackoff, parseRetryAfter } from '../../../src/fallback/retry.js';
import { PipelineError } from '../../../src/core/types.js';
import { createTimeoutBudget } from '../../../src/core/timeout.js';

describe('parseRetryAfter', () => {
	it('parses integer seconds', () => {
		expect(parseRetryAfter('30')).toBe(30000);
	});

	it('parses zero', () => {
		expect(parseRetryAfter('0')).toBe(0);
	});

	it('returns undefined for null/empty', () => {
		expect(parseRetryAfter(null)).toBeUndefined();
		expect(parseRetryAfter('')).toBeUndefined();
		expect(parseRetryAfter(undefined)).toBeUndefined();
	});

	it('parses HTTP-date in the future', () => {
		const future = new Date(Date.now() + 60000).toUTCString();
		const ms = parseRetryAfter(future);
		expect(ms).toBeGreaterThan(50000);
		expect(ms).toBeLessThanOrEqual(60000);
	});

	it('returns 0 for past HTTP-date', () => {
		const past = new Date(Date.now() - 10000).toUTCString();
		expect(parseRetryAfter(past)).toBe(0);
	});
});

describe('calculateBackoff', () => {
	it('increases exponentially', () => {
		const d0 = calculateBackoff(0, 500, 30000, 0);
		const d1 = calculateBackoff(1, 500, 30000, 0);
		const d2 = calculateBackoff(2, 500, 30000, 0);
		expect(d0).toBe(500);
		expect(d1).toBe(1000);
		expect(d2).toBe(2000);
	});

	it('caps at maxDelayMs', () => {
		expect(calculateBackoff(10, 500, 5000, 0)).toBe(5000);
	});

	it('respects retryAfterMs over calculated value', () => {
		expect(calculateBackoff(0, 500, 30000, 0, 10000)).toBe(10000);
	});

	it('caps retryAfterMs at maxDelayMs', () => {
		expect(calculateBackoff(0, 500, 5000, 0, 60000)).toBe(5000);
	});
});

describe('retryWithBackoff', () => {
	it('returns on first success', async () => {
		const fn = vi.fn().mockResolvedValue('ok');
		const result = await retryWithBackoff(fn, {
			maxAttempts: 3,
			timeout: createTimeoutBudget(5000),
		});
		expect(result).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('retries on retryable error then succeeds', async () => {
		const fn = vi.fn()
			.mockRejectedValueOnce(new PipelineError('rate limited', 'rate_limit', 'test', 429, true))
			.mockResolvedValue('ok');

		const result = await retryWithBackoff(fn, {
			maxAttempts: 2,
			baseDelayMs: 10,
			timeout: createTimeoutBudget(5000),
		});
		expect(result).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('throws immediately on non-retryable error', async () => {
		const fn = vi.fn()
			.mockRejectedValue(new PipelineError('bad auth', 'auth', 'test', 401, false));

		await expect(retryWithBackoff(fn, {
			maxAttempts: 3,
			timeout: createTimeoutBudget(5000),
		})).rejects.toThrow('bad auth');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('exhausts all attempts and throws last error', async () => {
		const fn = vi.fn()
			.mockRejectedValue(new PipelineError('server err', 'server_error', 'test', 500, true));

		await expect(retryWithBackoff(fn, {
			maxAttempts: 2,
			baseDelayMs: 10,
			timeout: createTimeoutBudget(5000),
		})).rejects.toThrow('server err');
		expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
	});

	it('respects Retry-After via getRetryAfter callback', async () => {
		const fn = vi.fn()
			.mockRejectedValueOnce(new PipelineError('429', 'rate_limit', 'test', 429, true))
			.mockResolvedValue('ok');

		const start = Date.now();
		await retryWithBackoff(
			fn,
			{ maxAttempts: 1, baseDelayMs: 10, timeout: createTimeoutBudget(5000) },
			() => 100, // 100ms Retry-After
		);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(80); // at least ~100ms
	});

	it('aborts when timeout budget exhausted', async () => {
		const fn = vi.fn()
			.mockRejectedValue(new PipelineError('slow', 'server_error', 'test', 500, true));

		const budget = createTimeoutBudget(50); // very short

		await expect(retryWithBackoff(fn, {
			maxAttempts: 10,
			baseDelayMs: 100,
			timeout: budget,
		})).rejects.toThrow();
	});
});
