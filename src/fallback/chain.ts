import type { ProviderConfig, ScopedLogger } from '../core/types.js';
import { PipelineError } from '../core/types.js';
import type { TimeoutBudget } from '../core/timeout.js';
import type { ProviderTransformer } from '../proxy/transform-registry.js';
import { callProvider, callProviderStream, type ProviderCallResult, type ProviderStreamResult } from '../proxy/provider.js';
import { retryWithBackoff, parseRetryAfter } from './retry.js';

export interface FallbackChainOptions {
	providers: Array<{
		config: ProviderConfig;
		transformer: ProviderTransformer;
	}>;
	body: unknown;
	stream?: boolean;
	timeout: TimeoutBudget;
	log: ScopedLogger;
	maxRetries?: number;
	baseBackoffMs?: number;
	maxBackoffMs?: number;
}

/** Status codes that should skip to the next provider instead of retrying. */
const FATAL_CODES = new Set(['auth', 'invalid_request', 'model_not_found', 'content_filter']);

/**
 * Execute a fallback chain: try providers in order.
 * - On retryable errors (429, 5xx, timeout): retry with exponential backoff + jitter
 * - On fatal errors (401, 400, 404): skip to next provider
 * - Respects Retry-After header on 429s
 * - Stops when timeout budget is exhausted
 */
export async function executeFallbackChain(
	opts: FallbackChainOptions,
): Promise<ProviderCallResult | ProviderStreamResult> {
	const {
		providers,
		body,
		stream,
		timeout,
		log,
		maxRetries = 2,
		baseBackoffMs = 500,
		maxBackoffMs = 30000,
	} = opts;

	const errors: Array<{ provider: string; error: PipelineError }> = [];

	for (const { config, transformer } of providers) {
		if (!timeout.hasTime()) break;

		// Track Retry-After from last error for this provider
		let lastRetryAfterMs: number | undefined;

		try {
			const result = await retryWithBackoff(
				async () => {
					if (stream) {
						return await callProviderStream({
							providerConfig: config,
							transformer,
							body,
							timeout,
						});
					}
					return await callProvider({
						providerConfig: config,
						transformer,
						body,
						timeout,
					});
				},
				{
					maxAttempts: maxRetries,
					baseDelayMs: baseBackoffMs,
					maxDelayMs: maxBackoffMs,
					jitter: 0.2,
					timeout,
				},
				(err) => {
					// Extract Retry-After from rate-limit errors
					if (err.code === 'rate_limit') {
						return lastRetryAfterMs;
					}
					return undefined;
				},
			);

			log.info(`Provider ${config.name} succeeded`, { provider: config.name });
			return result;
		} catch (err) {
			const pErr = err instanceof PipelineError
				? err
				: new PipelineError(String(err), 'unknown', config.name, 500, false);

			errors.push({ provider: config.name, error: pErr });

			// Extract Retry-After for logging
			if (pErr.code === 'rate_limit' && pErr.message) {
				const retryAfterMatch = pErr.message.match(/Retry-After:\s*(\S+)/i);
				if (retryAfterMatch) {
					lastRetryAfterMs = parseRetryAfter(retryAfterMatch[1]);
				}
			}

			log.warn(`Provider ${config.name} exhausted`, {
				code: pErr.code,
				status: pErr.statusCode,
				fatal: FATAL_CODES.has(pErr.code),
			});
		}
	}

	const lastError = errors[errors.length - 1]?.error;
	throw new PipelineError(
		`All ${providers.length} providers failed. Last: ${lastError?.message ?? 'unknown'}`,
		lastError?.code ?? 'server_error',
		'fallback_chain',
		lastError?.statusCode ?? 502,
		false,
	);
}
