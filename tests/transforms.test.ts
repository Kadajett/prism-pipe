import { describe, it, expect } from 'vitest';
import { OpenAITransformer } from '../src/proxy/transforms/openai.js';
import { AnthropicTransformer } from '../src/proxy/transforms/anthropic.js';
import type { CanonicalRequest, CanonicalResponse } from '../src/core/types.js';

describe('OpenAITransformer', () => {
	const t = new OpenAITransformer();

	it('converts OpenAI request to canonical', () => {
		const raw = {
			model: 'gpt-4o',
			messages: [
				{ role: 'system', content: 'You are helpful.' },
				{ role: 'user', content: 'Hello' },
			],
			temperature: 0.7,
			max_tokens: 100,
		};

		const canonical = t.toCanonical(raw);
		expect(canonical.model).toBe('gpt-4o');
		expect(canonical.systemPrompt).toBe('You are helpful.');
		expect(canonical.messages).toHaveLength(1);
		expect(canonical.messages[0].role).toBe('user');
		expect(canonical.messages[0].content).toBe('Hello');
		expect(canonical.temperature).toBe(0.7);
		expect(canonical.maxTokens).toBe(100);
	});

	it('converts canonical to OpenAI format', () => {
		const canonical: CanonicalRequest = {
			model: 'gpt-4o',
			messages: [{ role: 'user', content: 'Hello' }],
			systemPrompt: 'Be helpful.',
			temperature: 0.5,
		};

		const raw = t.fromCanonical(canonical) as Record<string, unknown>;
		const messages = raw.messages as Array<Record<string, unknown>>;
		expect(messages[0]).toEqual({ role: 'system', content: 'Be helpful.' });
		expect(messages[1]).toEqual({ role: 'user', content: 'Hello' });
	});

	it('round-trips response (canonical → openai → canonical)', () => {
		const original: CanonicalResponse = {
			id: 'resp-1',
			model: 'gpt-4o',
			content: [{ type: 'text', text: 'Hello!' }],
			stopReason: 'end',
			usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
		};

		const openai = t.responseFromCanonical(original) as Record<string, unknown>;
		const backToCanonical = t.responseToCanonical(openai);
		expect(backToCanonical.id).toBe('resp-1');
		expect(backToCanonical.content[0]).toEqual({ type: 'text', text: 'Hello!' });
		expect(backToCanonical.stopReason).toBe('end');
		expect(backToCanonical.usage.inputTokens).toBe(10);
	});

	it('handles tool calls in request round-trip', () => {
		const canonical: CanonicalRequest = {
			model: 'gpt-4o',
			messages: [{ role: 'user', content: 'What is the weather?' }],
			tools: [{
				name: 'get_weather',
				description: 'Get current weather',
				inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
			}],
		};

		const openai = t.fromCanonical(canonical) as Record<string, unknown>;
		const tools = openai.tools as Array<Record<string, unknown>>;
		expect(tools[0]).toEqual({
			type: 'function',
			function: {
				name: 'get_weather',
				description: 'Get current weather',
				parameters: { type: 'object', properties: { city: { type: 'string' } } },
			},
		});
	});

	it('handles empty messages', () => {
		const canonical = t.toCanonical({ model: 'gpt-4o', messages: [] });
		expect(canonical.messages).toHaveLength(0);
	});

	it('handles streaming [DONE] sentinel', () => {
		const chunk = t.streamChunkToCanonical('[DONE]');
		expect(chunk?.type).toBe('done');
	});

	it('handles streaming content delta', () => {
		const chunk = t.streamChunkToCanonical({
			choices: [{ index: 0, delta: { content: 'Hello' } }],
		});
		expect(chunk?.type).toBe('content_delta');
		expect(chunk?.delta?.text).toBe('Hello');
	});
});

describe('AnthropicTransformer', () => {
	const t = new AnthropicTransformer();

	it('converts Anthropic request to canonical', () => {
		const raw = {
			model: 'claude-sonnet-4-20250514',
			system: 'You are helpful.',
			messages: [{ role: 'user', content: 'Hello' }],
			max_tokens: 1024,
		};

		const canonical = t.toCanonical(raw);
		expect(canonical.model).toBe('claude-sonnet-4-20250514');
		expect(canonical.systemPrompt).toBe('You are helpful.');
		expect(canonical.messages[0].content).toBe('Hello');
		expect(canonical.maxTokens).toBe(1024);
	});

	it('converts canonical to Anthropic format', () => {
		const canonical: CanonicalRequest = {
			model: 'claude-sonnet-4-20250514',
			messages: [{ role: 'user', content: 'Hello' }],
			systemPrompt: 'Be helpful.',
			maxTokens: 1024,
		};

		const raw = t.fromCanonical(canonical) as Record<string, unknown>;
		expect(raw.system).toBe('Be helpful.');
		expect(raw.max_tokens).toBe(1024);
		expect((raw.messages as Array<Record<string, unknown>>)[0]).toEqual({
			role: 'user',
			content: 'Hello',
		});
	});

	it('sets default max_tokens when not specified', () => {
		const canonical: CanonicalRequest = {
			model: 'claude-sonnet-4-20250514',
			messages: [{ role: 'user', content: 'Hello' }],
		};

		const raw = t.fromCanonical(canonical) as Record<string, unknown>;
		expect(raw.max_tokens).toBe(4096);
	});

	it('round-trips response', () => {
		const original: CanonicalResponse = {
			id: 'msg-1',
			model: 'claude-sonnet-4-20250514',
			content: [{ type: 'text', text: 'Hi!' }],
			stopReason: 'end',
			usage: { inputTokens: 10, outputTokens: 3, totalTokens: 13 },
		};

		const anthropic = t.responseFromCanonical(original);
		const back = t.responseToCanonical(anthropic);
		expect(back.id).toBe('msg-1');
		expect(back.content[0]).toEqual({ type: 'text', text: 'Hi!' });
		expect(back.stopReason).toBe('end');
	});

	it('handles content blocks with tool_use', () => {
		const raw = {
			model: 'claude-sonnet-4-20250514',
			messages: [{
				role: 'assistant',
				content: [{
					type: 'tool_use',
					id: 'tu-1',
					name: 'get_weather',
					input: { city: 'NYC' },
				}],
			}],
		};

		const canonical = t.toCanonical(raw);
		const content = canonical.messages[0].content;
		expect(Array.isArray(content)).toBe(true);
		if (Array.isArray(content)) {
			expect(content[0].type).toBe('tool_use');
		}
	});

	it('handles message_stop streaming event', () => {
		const chunk = t.streamChunkToCanonical({ type: 'message_stop' });
		expect(chunk?.type).toBe('done');
	});

	it('handles text_delta streaming event', () => {
		const chunk = t.streamChunkToCanonical({
			type: 'content_block_delta',
			delta: { type: 'text_delta', text: 'Hello' },
		});
		expect(chunk?.type).toBe('content_delta');
		expect(chunk?.delta?.text).toBe('Hello');
	});

	it('ignores ping events', () => {
		const chunk = t.streamChunkToCanonical({ type: 'ping' });
		expect(chunk).toBeNull();
	});
});

describe('Cross-provider transform', () => {
	const openai = new OpenAITransformer();
	const anthropic = new AnthropicTransformer();

	it('converts OpenAI request → canonical → Anthropic format', () => {
		const openaiReq = {
			model: 'gpt-4o',
			messages: [
				{ role: 'system', content: 'Be concise.' },
				{ role: 'user', content: 'Hello' },
			],
			max_tokens: 100,
		};

		const canonical = openai.toCanonical(openaiReq);
		const anthropicReq = anthropic.fromCanonical(canonical) as Record<string, unknown>;

		expect(anthropicReq.system).toBe('Be concise.');
		expect(anthropicReq.max_tokens).toBe(100);
		const msgs = anthropicReq.messages as Array<Record<string, unknown>>;
		expect(msgs).toHaveLength(1);
		expect(msgs[0].content).toBe('Hello');
	});

	it('converts Anthropic response → canonical → OpenAI format', () => {
		const anthropicRes = {
			id: 'msg-1',
			type: 'message',
			role: 'assistant',
			model: 'claude-sonnet-4-20250514',
			content: [{ type: 'text', text: 'Hello!' }],
			stop_reason: 'end_turn',
			usage: { input_tokens: 10, output_tokens: 5 },
		};

		const canonical = anthropic.responseToCanonical(anthropicRes);
		const openaiRes = openai.responseFromCanonical(canonical) as Record<string, unknown>;

		expect(openaiRes.object).toBe('chat.completion');
		const choices = openaiRes.choices as Array<Record<string, unknown>>;
		expect(choices[0].finish_reason).toBe('stop');
		const usage = openaiRes.usage as Record<string, number>;
		expect(usage.prompt_tokens).toBe(10);
	});
});

import { GeminiTransformer } from '../src/proxy/transforms/gemini.js';
import { OllamaTransformer } from '../src/proxy/transforms/ollama.js';

describe('Cross-provider transforms with Gemini and Ollama', () => {
	const openai = new OpenAITransformer();
	const anthropic = new AnthropicTransformer();
	const gemini = new GeminiTransformer();
	const ollama = new OllamaTransformer();

	it('converts OpenAI request → canonical → Gemini format', () => {
		const openaiReq = {
			model: 'gpt-4o',
			messages: [
				{ role: 'system', content: 'Be concise.' },
				{ role: 'user', content: 'Hello' },
			],
			max_tokens: 100,
		};

		const canonical = openai.toCanonical(openaiReq);
		const geminiReq = gemini.fromCanonical(canonical) as Record<string, unknown>;

		expect((geminiReq.systemInstruction as Record<string, unknown>).parts).toEqual([
			{ text: 'Be concise.' },
		]);
		const contents = geminiReq.contents as Array<Record<string, unknown>>;
		expect(contents).toHaveLength(1);
		expect(contents[0].role).toBe('user');
		const config = geminiReq.generationConfig as Record<string, unknown>;
		expect(config.maxOutputTokens).toBe(100);
	});

	it('converts Gemini response → canonical → OpenAI format', () => {
		const geminiRes = {
			candidates: [
				{
					content: { role: 'model', parts: [{ text: 'Hello!' }] },
					finishReason: 'STOP',
				},
			],
			usageMetadata: {
				promptTokenCount: 10,
				candidatesTokenCount: 5,
				totalTokenCount: 15,
			},
		};

		const canonical = gemini.responseToCanonical(geminiRes);
		const openaiRes = openai.responseFromCanonical(canonical) as Record<string, unknown>;

		expect(openaiRes.object).toBe('chat.completion');
		const choices = openaiRes.choices as Array<Record<string, unknown>>;
		expect(choices[0].finish_reason).toBe('stop');
		const message = choices[0].message as Record<string, unknown>;
		expect(message.content).toBe('Hello!');
	});

	it('converts Anthropic request → canonical → Ollama format', () => {
		const anthropicReq = {
			model: 'claude-sonnet-4-20250514',
			system: 'Be helpful.',
			messages: [{ role: 'user', content: 'Hello' }],
			max_tokens: 1024,
			temperature: 0.7,
		};

		const canonical = anthropic.toCanonical(anthropicReq);
		const ollamaReq = ollama.fromCanonical(canonical) as Record<string, unknown>;

		const messages = ollamaReq.messages as Array<Record<string, unknown>>;
		expect(messages[0]).toEqual({ role: 'system', content: 'Be helpful.' });
		expect(messages[1]).toEqual({ role: 'user', content: 'Hello' });
		const options = ollamaReq.options as Record<string, unknown>;
		expect(options.num_predict).toBe(1024);
		expect(options.temperature).toBe(0.7);
	});

	it('converts Ollama response → canonical → Anthropic format', () => {
		const ollamaRes = {
			model: 'llama2',
			message: { role: 'assistant', content: 'Hello!' },
			done: true,
			prompt_eval_count: 10,
			eval_count: 5,
		};

		const canonical = ollama.responseToCanonical(ollamaRes);
		const anthropicRes = anthropic.responseFromCanonical(canonical) as Record<string, unknown>;

		expect(anthropicRes.type).toBe('message');
		const content = anthropicRes.content as Array<Record<string, unknown>>;
		expect(content[0]).toEqual({ type: 'text', text: 'Hello!' });
		expect(anthropicRes.stop_reason).toBe('end_turn');
		const usage = anthropicRes.usage as Record<string, number>;
		expect(usage.input_tokens).toBe(10);
		expect(usage.output_tokens).toBe(5);
	});
});

describe('Extras passthrough (response_format, etc.)', () => {
	const openai = new OpenAITransformer();

	it('captures response_format into extras during toCanonical', () => {
		const raw = {
			model: 'gpt-4o',
			messages: [{ role: 'user', content: 'List 3 colors' }],
			response_format: {
				type: 'json_schema',
				json_schema: {
					name: 'ColorList',
					strict: true,
					schema: {
						type: 'object',
						properties: { colors: { type: 'array', items: { type: 'string' } } },
						required: ['colors'],
					},
				},
			},
		};

		const canonical = openai.toCanonical(raw);
		expect(canonical.extras).toBeDefined();
		expect(canonical.extras!.response_format).toEqual(raw.response_format);
	});

	it('round-trips response_format through toCanonical → fromCanonical', () => {
		const raw = {
			model: 'mercury-2',
			messages: [{ role: 'user', content: 'List 3 colors' }],
			response_format: {
				type: 'json_schema',
				json_schema: {
					name: 'ColorList',
					strict: true,
					schema: {
						type: 'object',
						properties: { colors: { type: 'array', items: { type: 'string' } } },
						required: ['colors'],
					},
				},
			},
		};

		const canonical = openai.toCanonical(raw);
		const output = openai.fromCanonical(canonical) as Record<string, unknown>;
		expect(output.response_format).toEqual(raw.response_format);
	});

	it('round-trips multiple passthrough fields (seed, logprobs, frequency_penalty)', () => {
		const raw = {
			model: 'gpt-4o',
			messages: [{ role: 'user', content: 'Hi' }],
			temperature: 0.5,
			seed: 42,
			logprobs: true,
			top_logprobs: 3,
			frequency_penalty: 0.8,
			presence_penalty: 0.2,
			user: 'user-123',
		};

		const canonical = openai.toCanonical(raw);
		expect(canonical.temperature).toBe(0.5);
		expect(canonical.extras?.seed).toBe(42);
		expect(canonical.extras?.logprobs).toBe(true);
		expect(canonical.extras?.top_logprobs).toBe(3);
		expect(canonical.extras?.frequency_penalty).toBe(0.8);

		const output = openai.fromCanonical(canonical) as Record<string, unknown>;
		expect(output.temperature).toBe(0.5);
		expect(output.seed).toBe(42);
		expect(output.logprobs).toBe(true);
		expect(output.top_logprobs).toBe(3);
		expect(output.frequency_penalty).toBe(0.8);
		expect(output.presence_penalty).toBe(0.2);
		expect(output.user).toBe('user-123');
	});

	it('does not put known fields into extras', () => {
		const raw = {
			model: 'gpt-4o',
			messages: [{ role: 'user', content: 'Hi' }],
			temperature: 0.5,
			max_tokens: 100,
			stream: true,
		};

		const canonical = openai.toCanonical(raw);
		expect(canonical.extras).toBeUndefined();
	});

	it('extras do not overwrite explicitly mapped fields in fromCanonical', () => {
		const canonical: CanonicalRequest = {
			model: 'gpt-4o',
			messages: [{ role: 'user', content: 'Hi' }],
			temperature: 0.7,
			extras: { temperature: 999, model: 'evil-model', response_format: { type: 'json_object' } },
		};

		const output = openai.fromCanonical(canonical) as Record<string, unknown>;
		expect(output.temperature).toBe(0.7);
		expect(output.model).toBe('gpt-4o');
		expect(output.response_format).toEqual({ type: 'json_object' });
	});
});
