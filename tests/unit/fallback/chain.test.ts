import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeFallbackChain } from '../../../src/fallback/chain.js';
import { PipelineError } from '../../../src/core/types.js';
import { createTimeoutBudget } from '../../../src/core/timeout.js';
import type { ProviderTransformer } from '../../../src/proxy/transform-registry.js';
import type { ProviderConfig, ScopedLogger, CanonicalResponse, CanonicalStreamChunk, CanonicalRequest, ProviderCapabilities } from '../../../src/core/types.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
	mockFetch.mockReset();
});

function makeLogger(): ScopedLogger {
	return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeProvider(name: string): { config: ProviderConfig; transformer: ProviderTransformer } {
	return {
		config: { name, baseUrl: `https://${name}.example.com`, apiKey: `key-${name}` },
		transformer: {
			provider: name,
			capabilities: {} as ProviderCapabilities,
			toCanonical: (r: unknown) => r as CanonicalRequest,
			fromCanonical: (r: CanonicalRequest) => r as unknown,
			responseToCanonical: (r: unknown) => r as CanonicalResponse,
			responseFromCanonical: (r: CanonicalResponse) => r as unknown,
			streamChunkToCanonical: (c: unknown) => c as CanonicalStreamChunk | null,
			streamChunkFromCanonical: (c: CanonicalStreamChunk) => c as unknown,
		},
	};
}

function mockSuccessResponse(content = 'Hello') {
	return new Response(JSON.stringify({
		id: 'test',
		model: 'test',
		content: [{ type: 'text', text: content }],
		stopReason: 'end',
		usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
	}), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('Fallback Chain', () => {
	it('succeeds on first provider', async () => {
		mockFetch.mockResolvedValueOnce(mockSuccessResponse());

		const result = await executeFallbackChain({
			providers: [makeProvider('openai')],
			body: { model: 'gpt-4o', messages: [] },
			timeout: createTimeoutBudget(5000),
			log: makeLogger(),
		});

		expect(result.provider).toBe('openai');
	});

	it('falls through to second provider on fatal error', async () => {
		mockFetch
			.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
			.mockResolvedValueOnce(mockSuccessResponse('from anthropic'));

		const result = await executeFallbackChain({
			providers: [makeProvider('openai'), makeProvider('anthropic')],
			body: { model: 'test', messages: [] },
			timeout: createTimeoutBudget(5000),
			log: makeLogger(),
		});

		expect(result.provider).toBe('anthropic');
	});

	it('retries on 429 then succeeds', async () => {
		mockFetch
			.mockResolvedValueOnce(new Response('Rate limited', { status: 429, headers: { 'Retry-After': '1' } }))
			.mockResolvedValueOnce(mockSuccessResponse());

		const result = await executeFallbackChain({
			providers: [makeProvider('openai')],
			body: { model: 'test', messages: [] },
			timeout: createTimeoutBudget(5000),
			log: makeLogger(),
			maxRetries: 2,
			baseBackoffMs: 10,
		});

		expect(result.provider).toBe('openai');
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});

	it('retries on 500 then falls through', async () => {
		// 3 failures on provider 1 (initial + 2 retries), then success on provider 2
		mockFetch
			.mockResolvedValueOnce(new Response('Internal Error', { status: 500 }))
			.mockResolvedValueOnce(new Response('Internal Error', { status: 500 }))
			.mockResolvedValueOnce(new Response('Internal Error', { status: 500 }))
			.mockResolvedValueOnce(mockSuccessResponse('fallback'));

		const result = await executeFallbackChain({
			providers: [makeProvider('primary'), makeProvider('fallback')],
			body: { model: 'test', messages: [] },
			timeout: createTimeoutBudget(5000),
			log: makeLogger(),
			maxRetries: 2,
			baseBackoffMs: 10,
		});

		expect(result.provider).toBe('fallback');
	});

	it('stops on success (does not try remaining providers)', async () => {
		mockFetch.mockResolvedValue(mockSuccessResponse());

		await executeFallbackChain({
			providers: [makeProvider('a'), makeProvider('b'), makeProvider('c')],
			body: { model: 'test', messages: [] },
			timeout: createTimeoutBudget(5000),
			log: makeLogger(),
		});

		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it('throws when all providers fail', async () => {
		mockFetch.mockResolvedValue(new Response('Bad Request', { status: 400 }));

		await expect(executeFallbackChain({
			providers: [makeProvider('a'), makeProvider('b')],
			body: { model: 'test', messages: [] },
			timeout: createTimeoutBudget(5000),
			log: makeLogger(),
		})).rejects.toThrow('All 2 providers failed');
	});
});
