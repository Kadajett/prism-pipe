/**
 * Timeout budget — tracks remaining wall-clock time for a request.
 * Supports sub-budgets via slice() for composed multi-step calls.
 */

export interface TimeoutBudget {
	readonly totalMs: number;
	readonly startedAt: number;
	readonly deadlineAt: number;
	remaining(): number;
	hasTime(): boolean;
	slice(maxMs?: number): TimeoutBudget;
	readonly signal: AbortSignal;
}

export function createTimeoutBudget(totalMs: number): TimeoutBudget {
	const controller = new AbortController();
	const startedAt = Date.now();
	const deadlineAt = startedAt + totalMs;

	const timer = setTimeout(() => controller.abort(), totalMs);
	// Don't hold the process open
	if (timer.unref) timer.unref();

	return {
		totalMs,
		startedAt,
		deadlineAt,
		signal: controller.signal,

		remaining(): number {
			return Math.max(0, deadlineAt - Date.now());
		},

		hasTime(): boolean {
			return Date.now() < deadlineAt;
		},

		slice(maxMs?: number): TimeoutBudget {
			const rem = this.remaining();
			const sliceMs = maxMs ? Math.min(maxMs, rem) : rem;
			return createTimeoutBudget(sliceMs);
		},
	};
}
