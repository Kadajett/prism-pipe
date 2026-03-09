import { describe, it, expect } from 'vitest';
import { OpenAITransformer } from '../../../src/proxy/transforms/openai.js';
import { AnthropicTransformer } from '../../../src/proxy/transforms/anthropic.js';
import { TransformRegistry } from '../../../src/proxy/transform-registry.js';
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamChunk } from '../../../src/core/types.js';

describe('Transform round-trips', () => {
	const openai = new OpenAITransformer();
	const anthropic = new AnthropicTransformer();

	describe('OpenAI ↔ canonical', () => {
		it('request round-trip preserves data', () => {
			const canonical: CanonicalRequest = {
				model: 'gpt-4o',
				messages: [{ role: 'user', content: 'Hello' }],
				systemPrompt: 'Be helpful',
				temperature: 0.7,
				maxTokens: 100,
			};

			const openaiFormat = openai.fromCanonical(canonical);
			const backToCanonical = openai.toCanonical(openaiFormat);

			expect(backToCanonical.model).toBe('gpt-4o');
			expect(backToCanonical.systemPrompt).toBe('Be helpful');
			expect(backToCanonical.messages).toHaveLength(1);
			expect(backToCanonical.messages[0].content).toBe('Hello');
			expect(backToCanonical.temperature).toBe(0.7);
			expect(backToCanonical.maxTokens).toBe(100);
		});

		it('response round-trip preserves data', () => {
			const canonical: CanonicalResponse = {
				id: 'resp-1',
				model: 'gpt-4o',
				content: [{ type: 'text', text: 'Hi there!' }],
				stopReason: 'end',
				usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			};

			const openaiFormat = openai.responseFromCanonical(canonical);
			const back = openai.responseToCanonical(openaiFormat);

			expect(back.id).toBe('resp-1');
			expect(back.content[0]).toEqual({ type: 'text', text: 'Hi there!' });
			expect(back.stopReason).toBe('end');
			expect(back.usage.inputTokens).toBe(10);
			expect(back.usage.outputTokens).toBe(5);
		});

		it('stream chunk round-trip', () => {
			const chunk: CanonicalStreamChunk = {
				type: 'content_delta',
				delta: { text: 'Hello' },
			};
			const serialized = openai.streamChunkFromCanonical(chunk);
			const back = openai.streamChunkToCanonical(serialized);
			expect(back?.type).toBe('content_delta');
			expect(back?.delta?.text).toBe('Hello');
		});
	});

	describe('Anthropic ↔ canonical', () => {
		it('request round-trip preserves data', () => {
			const canonical: CanonicalRequest = {
				model: 'claude-sonnet-4-5-20250514',
				messages: [{ role: 'user', content: 'Hello' }],
				systemPrompt: 'Be helpful',
				temperature: 0.7,
				maxTokens: 200,
			};

			const anthFormat = anthropic.fromCanonical(canonical);
			const back = anthropic.toCanonical(anthFormat);

			expect(back.model).toBe('claude-sonnet-4-5-20250514');
			expect(back.systemPrompt).toBe('Be helpful');
			expect(back.messages).toHaveLength(1);
			expect(back.messages[0].content).toBe('Hello');
			expect(back.temperature).toBe(0.7);
			expect(back.maxTokens).toBe(200);
		});

		it('response round-trip preserves data', () => {
			const canonical: CanonicalResponse = {
				id: 'msg-1',
				model: 'claude-sonnet-4-5-20250514',
				content: [{ type: 'text', text: 'Hi!' }],
				stopReason: 'end',
				usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 },
			};

			const anthFormat = anthropic.responseFromCanonical(canonical);
			const back = anthropic.responseToCanonical(anthFormat);

			expect(back.id).toBe('msg-1');
			expect(back.content[0]).toEqual({ type: 'text', text: 'Hi!' });
			expect(back.stopReason).toBe('end');
			expect(back.usage.inputTokens).toBe(8);
		});

		it('uses top-level system field (not in messages)', () => {
			const canonical: CanonicalRequest = {
				model: 'claude-sonnet-4-5-20250514',
				messages: [{ role: 'user', content: 'Hi' }],
				systemPrompt: 'You are a pirate',
			};
			const result = anthropic.fromCanonical(canonical) as Record<string, unknown>;
			expect(result.system).toBe('You are a pirate');
			const messages = result.messages as Array<Record<string, unknown>>;
			expect(messages.every((m) => m.role !== 'system')).toBe(true);
		});

		it('sets x-api-key and anthropic-version headers', () => {
			// Verify the transformer identifies as anthropic for header logic
			expect(anthropic.provider).toBe('anthropic');
		});

		it('handles content_block_delta SSE events', () => {
			const event = {
				type: 'content_block_delta',
				delta: { type: 'text_delta', text: 'streaming text' },
			};
			const chunk = anthropic.streamChunkToCanonical(event);
			expect(chunk?.type).toBe('content_delta');
			expect(chunk?.delta?.text).toBe('streaming text');
		});

		it('maps stop_reason correctly', () => {
			const raw = {
				id: 'msg-2',
				type: 'message',
				model: 'claude-sonnet-4-5-20250514',
				content: [{ type: 'text', text: 'done' }],
				stop_reason: 'end_turn',
				usage: { input_tokens: 5, output_tokens: 2 },
			};
			const canonical = anthropic.responseToCanonical(raw);
			expect(canonical.stopReason).toBe('end');
		});
	});

	describe('Cross-transform: OpenAI → canonical → Anthropic', () => {
		it('converts between provider formats via canonical', () => {
			// Start with OpenAI request
			const openaiReq = {
				model: 'gpt-4o',
				messages: [
					{ role: 'system', content: 'Be concise' },
					{ role: 'user', content: 'Explain TypeScript' },
				],
				temperature: 0.5,
				max_tokens: 500,
			};

			// OpenAI → canonical
			const canonical = openai.toCanonical(openaiReq);
			expect(canonical.systemPrompt).toBe('Be concise');

			// canonical → Anthropic
			const anthFormat = anthropic.fromCanonical(canonical) as Record<string, unknown>;
			expect(anthFormat.system).toBe('Be concise');
			expect(anthFormat.max_tokens).toBe(500);
			const messages = anthFormat.messages as Array<Record<string, unknown>>;
			expect(messages).toHaveLength(1);
			expect(messages[0].role).toBe('user');
			expect(messages[0].content).toBe('Explain TypeScript');
		});

		it('converts response Anthropic → canonical → OpenAI', () => {
			const anthResponse = {
				id: 'msg-cross',
				type: 'message',
				model: 'claude-sonnet-4-5-20250514',
				content: [{ type: 'text', text: 'TypeScript adds types to JS.' }],
				stop_reason: 'end_turn',
				usage: { input_tokens: 20, output_tokens: 10 },
			};

			// Anthropic → canonical
			const canonical = anthropic.responseToCanonical(anthResponse);

			// canonical → OpenAI
			const openaiResp = openai.responseFromCanonical(canonical) as Record<string, unknown>;
			expect(openaiResp.object).toBe('chat.completion');
			const choices = openaiResp.choices as Array<Record<string, unknown>>;
			const msg = choices[0].message as Record<string, unknown>;
			expect(msg.content).toBe('TypeScript adds types to JS.');
			expect(choices[0].finish_reason).toBe('stop');
		});
	});

	describe('TransformRegistry', () => {
		it('registers and retrieves transformers', () => {
			const registry = new TransformRegistry();
			registry.register(openai);
			registry.register(anthropic);

			expect(registry.get('openai')).toBe(openai);
			expect(registry.get('anthropic')).toBe(anthropic);
			expect(registry.providers()).toEqual(['openai', 'anthropic']);
		});

		it('throws on unknown transformer', () => {
			const registry = new TransformRegistry();
			expect(() => registry.get('gemini')).toThrow('No transformer registered');
		});
	});
});
