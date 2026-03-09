import type { CanonicalResponse, CanonicalStreamChunk, ProviderConfig, PipelineError as PipelineErrorType } from '../core/types.js';
import { PipelineError } from '../core/types.js';
import type { ProviderTransformer } from './transform-registry.js';
import type { TimeoutBudget } from '../core/timeout.js';

export interface ProviderCallOptions {
	providerConfig: ProviderConfig;
	transformer: ProviderTransformer;
	body: unknown;
	stream?: boolean;
	timeout: TimeoutBudget;
}

export interface ProviderCallResult {
	response: CanonicalResponse;
	latencyMs: number;
	provider: string;
}

export interface ProviderStreamResult {
	chunks: AsyncIterableIterator<CanonicalStreamChunk>;
	latencyMs: number;
	provider: string;
}

/**
 * Classifies HTTP errors into retryable/fatal categories.
 */
function classifyError(status: number): { code: PipelineErrorType['code']; retryable: boolean } {
	if (status === 401 || status === 403) return { code: 'auth', retryable: false };
	if (status === 429) return { code: 'rate_limit', retryable: true };
	if (status === 400) return { code: 'invalid_request', retryable: false };
	if (status === 404) return { code: 'model_not_found', retryable: false };
	if (status === 529 || status === 503) return { code: 'overloaded', retryable: true };
	if (status >= 500) return { code: 'server_error', retryable: true };
	return { code: 'unknown', retryable: false };
}

/**
 * Makes HTTP calls to AI providers, handles JSON and SSE streaming responses.
 */
export async function callProvider(opts: ProviderCallOptions): Promise<ProviderCallResult> {
	const { providerConfig, transformer, body, timeout } = opts;
	const start = Date.now();

	const url = `${providerConfig.baseUrl}/v1/chat/completions`;
	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};

	// Provider-specific auth headers
	if (transformer.provider === 'anthropic') {
		headers['x-api-key'] = providerConfig.apiKey;
		headers['anthropic-version'] = '2023-06-01';
	} else {
		headers['Authorization'] = `Bearer ${providerConfig.apiKey}`;
	}

	let res: Response;
	try {
		res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: timeout.signal,
		});
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			throw new PipelineError('Provider call timed out', 'timeout', providerConfig.name, 504, true);
		}
		throw new PipelineError(
			`Network error calling ${providerConfig.name}: ${err instanceof Error ? err.message : String(err)}`,
			'network',
			providerConfig.name,
			502,
			true,
		);
	}

	if (!res.ok) {
		const errorBody = await res.text().catch(() => '');
		const { code, retryable } = classifyError(res.status);
		throw new PipelineError(
			`Provider ${providerConfig.name} returned ${res.status}: ${errorBody.slice(0, 200)}`,
			code,
			providerConfig.name,
			res.status,
			retryable,
		);
	}

	const rawResponse = await res.json();
	const canonical = transformer.responseToCanonical(rawResponse);

	return {
		response: canonical,
		latencyMs: Date.now() - start,
		provider: providerConfig.name,
	};
}

/**
 * Makes a streaming call to a provider, returns an async iterator of canonical chunks.
 */
export async function callProviderStream(
	opts: ProviderCallOptions,
): Promise<ProviderStreamResult> {
	const { providerConfig, transformer, body, timeout } = opts;
	const start = Date.now();

	// Ensure stream is set in the body
	const streamBody = { ...(body as Record<string, unknown>), stream: true };

	const url = transformer.provider === 'anthropic'
		? `${providerConfig.baseUrl}/v1/messages`
		: `${providerConfig.baseUrl}/v1/chat/completions`;

	const headers: Record<string, string> = {
		'Content-Type': 'application/json',
	};

	if (transformer.provider === 'anthropic') {
		headers['x-api-key'] = providerConfig.apiKey;
		headers['anthropic-version'] = '2023-06-01';
	} else {
		headers['Authorization'] = `Bearer ${providerConfig.apiKey}`;
	}

	let res: Response;
	try {
		res = await fetch(url, {
			method: 'POST',
			headers,
			body: JSON.stringify(streamBody),
			signal: timeout.signal,
		});
	} catch (err) {
		if (err instanceof DOMException && err.name === 'AbortError') {
			throw new PipelineError('Provider stream timed out', 'timeout', providerConfig.name, 504, true);
		}
		throw new PipelineError(
			`Network error streaming from ${providerConfig.name}`,
			'network',
			providerConfig.name,
			502,
			true,
		);
	}

	if (!res.ok) {
		const errorBody = await res.text().catch(() => '');
		const { code, retryable } = classifyError(res.status);
		throw new PipelineError(
			`Provider ${providerConfig.name} returned ${res.status}: ${errorBody.slice(0, 200)}`,
			code,
			providerConfig.name,
			res.status,
			retryable,
		);
	}

	const reader = res.body?.getReader();
	if (!reader) {
		throw new PipelineError('No response body for streaming', 'server_error', providerConfig.name, 502, true);
	}

	const decoder = new TextDecoder();
	let buffer = '';

	async function* parseSSE(): AsyncIterableIterator<CanonicalStreamChunk> {
		while (true) {
			const { done, value } = await reader!.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith(':')) continue;

				if (trimmed.startsWith('data: ')) {
					const data = trimmed.slice(6);
					if (data === '[DONE]') {
						yield { type: 'done' };
						return;
					}
					try {
						const parsed = JSON.parse(data);
						const chunk = transformer.streamChunkToCanonical(parsed);
						if (chunk) yield chunk;
					} catch {
						// Skip malformed JSON
					}
				} else if (trimmed.startsWith('event: ')) {
					// Anthropic uses event types — the data line following will contain the payload
					// The next data: line handles it via streamChunkToCanonical
				}
			}
		}
	}

	return {
		chunks: parseSSE(),
		latencyMs: Date.now() - start,
		provider: providerConfig.name,
	};
}
