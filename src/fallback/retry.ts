import { PipelineError } from '../core/types.js';
import type { TimeoutBudget } from '../core/timeout.js';

export interface RetryOptions {
	/** Maximum number of retry attempts (not counting the initial try). */
	maxAttempts: number;
	/** Base delay in ms for exponential backoff. Default: 500 */
	baseDelayMs?: number;
	/** Maximum delay in ms. Default: 30000 */
	maxDelayMs?: number;
	/** Jitter factor (0–1). Adds randomness to prevent thundering herd. Default: 0.2 */
	jitter?: number;
	/** Timeout budget — abort if no time left. */
	timeout: TimeoutBudget;
}

/**
 * Calculate backoff delay with exponential increase and jitter.
 * Respects Retry-After header value if provided.
 */
export function calculateBackoff(
	attempt: number,
	baseDelayMs: number,
	maxDelayMs: number,
	jitter: number,
	retryAfterMs?: number,
): number {
	// If server told us when to retry, respect it
	if (retryAfterMs != null && retryAfterMs > 0) {
		return Math.min(retryAfterMs, maxDelayMs);
	}

	const exponential = baseDelayMs * 2 ** attempt;
	const capped = Math.min(exponential, maxDelayMs);
	const jitterRange = capped * jitter;
	const jittered = capped + (Math.random() * 2 - 1) * jitterRange;
	return Math.max(0, Math.round(jittered));
}

/**
 * Parse a Retry-After header value into milliseconds.
 * Supports: integer seconds ("120") or HTTP-date ("Sun, 08 Mar 2026 23:00:00 GMT").
 * Returns undefined if unparseable.
 */
export function parseRetryAfter(value: string | null | undefined): number | undefined {
	if (!value) return undefined;

	// Try as integer seconds first
	const seconds = Number.parseInt(value, 10);
	if (!Number.isNaN(seconds) && seconds >= 0) {
		return seconds * 1000;
	}

	// Try as HTTP-date
	const date = new Date(value);
	if (!Number.isNaN(date.getTime())) {
		const delayMs = date.getTime() - Date.now();
		return delayMs > 0 ? delayMs : 0;
	}

	return undefined;
}

/**
 * Retry a function with exponential backoff and jitter.
 * Aborts early if the timeout budget is exhausted.
 * Only retries on errors that are marked as retryable (PipelineError.retryable).
 */
export async function retryWithBackoff<T>(
	fn: () => Promise<T>,
	opts: RetryOptions,
	/** Optional: extract Retry-After from the error for server-guided backoff */
	getRetryAfter?: (err: PipelineError) => number | undefined,
): Promise<T> {
	const {
		maxAttempts,
		baseDelayMs = 500,
		maxDelayMs = 30000,
		jitter = 0.2,
		timeout,
	} = opts;

	let lastError: Error | undefined;

	for (let attempt = 0; attempt <= maxAttempts; attempt++) {
		if (!timeout.hasTime()) {
			throw lastError ?? new PipelineError(
				'Retry budget exhausted (timeout)',
				'timeout',
				'retry',
				504,
				false,
			);
		}

		try {
			return await fn();
		} catch (err) {
			lastError = err instanceof Error ? err : new Error(String(err));

			const pErr = err instanceof PipelineError ? err : undefined;

			// Non-retryable errors are thrown immediately
			if (pErr && !pErr.retryable) throw pErr;

			// Last attempt — don't sleep, just throw
			if (attempt >= maxAttempts) break;

			const retryAfterMs = pErr && getRetryAfter ? getRetryAfter(pErr) : undefined;
			const delay = calculateBackoff(attempt, baseDelayMs, maxDelayMs, jitter, retryAfterMs);

			// Don't wait longer than the remaining budget
			const effectiveDelay = Math.min(delay, timeout.remaining());
			if (effectiveDelay <= 0) break;

			await new Promise((resolve) => setTimeout(resolve, effectiveDelay));
		}
	}

	throw lastError ?? new PipelineError(
		'All retry attempts exhausted',
		'server_error',
		'retry',
		502,
		false,
	);
}
