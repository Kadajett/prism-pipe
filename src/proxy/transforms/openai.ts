import type {
	CanonicalMessage,
	CanonicalRequest,
	CanonicalResponse,
	CanonicalStreamChunk,
	ContentBlock,
	ProviderCapabilities,
} from '../../core/types.js';
import type { ProviderTransformer } from '../transform-registry.js';

/**
 * OpenAI ↔ Canonical transformer.
 * Handles: messages format, system prompt in messages array, choices[0].message
 * response shape, usage field mapping, streaming data: [DONE] sentinel.
 */
export class OpenAITransformer implements ProviderTransformer {
	readonly provider = 'openai';

	readonly capabilities: ProviderCapabilities = {
		supportsTools: true,
		supportsVision: true,
		supportsStreaming: true,
		supportsThinking: false,
		supportsSystemPrompt: true,
	};

	toCanonical(raw: unknown): CanonicalRequest {
		const r = raw as Record<string, unknown>;
		const messages = (r.messages as Array<Record<string, unknown>>) ?? [];
		const canonicalMessages: CanonicalMessage[] = [];
		let systemPrompt: string | undefined;

		for (const msg of messages) {
			const role = msg.role as string;
			if (role === 'system') {
				systemPrompt = (systemPrompt ? `${systemPrompt}\n` : '') + String(msg.content);
				continue;
			}

			const content = msg.content;
			if (typeof content === 'string') {
				canonicalMessages.push({ role: role as CanonicalMessage['role'], content });
			} else if (Array.isArray(content)) {
				const blocks: ContentBlock[] = content.map((part: Record<string, unknown>) => {
					if (part.type === 'text') return { type: 'text', text: String(part.text) };
					if (part.type === 'image_url') {
						const url = (part.image_url as Record<string, string>)?.url ?? '';
						if (url.startsWith('data:')) {
							const match = url.match(/^data:([^;]+);base64,(.+)/);
							if (match) {
								return {
									type: 'image' as const,
									source: { type: 'base64' as const, mediaType: match[1], data: match[2] },
								};
							}
						}
						return { type: 'image' as const, source: { type: 'url' as const, url } };
					}
					return { type: 'text' as const, text: JSON.stringify(part) };
				});
				canonicalMessages.push({ role: role as CanonicalMessage['role'], content: blocks });
			}

			// Handle tool calls in assistant messages
			if (role === 'assistant' && Array.isArray(msg.tool_calls)) {
				const toolBlocks: ContentBlock[] = (
					msg.tool_calls as Array<Record<string, unknown>>
				).map((tc) => ({
					type: 'tool_use' as const,
					id: String(tc.id),
					name: String((tc.function as Record<string, unknown>)?.name),
					input: JSON.parse(
						String((tc.function as Record<string, unknown>)?.arguments ?? '{}'),
					),
				}));
				// Merge with existing content
				const last = canonicalMessages[canonicalMessages.length - 1];
				if (last && last.role === 'assistant') {
					const existing = typeof last.content === 'string'
						? [{ type: 'text' as const, text: last.content }]
						: (last.content as ContentBlock[]);
					last.content = [...existing, ...toolBlocks];
				}
			}

			// Handle tool role messages
			if (role === 'tool') {
				canonicalMessages.push({
					role: 'tool',
					content: [
						{
							type: 'tool_result',
							toolUseId: String(msg.tool_call_id),
							content: String(msg.content),
						},
					],
				});
			}
		}

		const req: CanonicalRequest = {
			model: String(r.model ?? ''),
			messages: canonicalMessages,
		};
		if (systemPrompt) req.systemPrompt = systemPrompt;
		if (r.temperature != null) req.temperature = Number(r.temperature);
		if (r.max_tokens != null) req.maxTokens = Number(r.max_tokens);
		if (r.max_completion_tokens != null) req.maxTokens = Number(r.max_completion_tokens);
		if (r.top_p != null) req.topP = Number(r.top_p);
		if (r.stop) req.stopSequences = Array.isArray(r.stop) ? r.stop : [String(r.stop)];
		if (r.stream) req.stream = true;
		if (r.tools) {
			req.tools = (r.tools as Array<Record<string, unknown>>).map((t) => {
				const fn = t.function as Record<string, unknown>;
				return {
					name: String(fn.name),
					description: String(fn.description ?? ''),
					inputSchema: (fn.parameters as Record<string, unknown>) ?? {},
				};
			});
		}
		return req;
	}

	fromCanonical(req: CanonicalRequest): unknown {
		const messages: Array<Record<string, unknown>> = [];

		if (req.systemPrompt) {
			messages.push({ role: 'system', content: req.systemPrompt });
		}

		for (const msg of req.messages) {
			if (msg.role === 'system') {
				messages.push({ role: 'system', content: typeof msg.content === 'string' ? msg.content : '' });
				continue;
			}

			if (msg.role === 'tool' && Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (typeof block === 'object' && block.type === 'tool_result') {
						messages.push({
							role: 'tool',
							tool_call_id: block.toolUseId,
							content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
						});
					}
				}
				continue;
			}

			const content = msg.content;
			if (typeof content === 'string') {
				messages.push({ role: msg.role, content });
			} else if (Array.isArray(content)) {
				const toolCalls: Array<Record<string, unknown>> = [];
				const parts: Array<Record<string, unknown>> = [];

				for (const block of content) {
					if (block.type === 'text') {
						parts.push({ type: 'text', text: block.text });
					} else if (block.type === 'image') {
						const src = block.source;
						const url = src.type === 'base64'
							? `data:${src.mediaType};base64,${src.data}`
							: src.url;
						parts.push({ type: 'image_url', image_url: { url } });
					} else if (block.type === 'tool_use') {
						toolCalls.push({
							id: block.id,
							type: 'function',
							function: { name: block.name, arguments: JSON.stringify(block.input) },
						});
					}
				}

				const entry: Record<string, unknown> = { role: msg.role };
				if (parts.length > 0) entry.content = parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts;
				if (toolCalls.length > 0) entry.tool_calls = toolCalls;
				if (!entry.content && !entry.tool_calls) entry.content = '';
				messages.push(entry);
			}
		}

		const result: Record<string, unknown> = { model: req.model, messages };
		if (req.temperature != null) result.temperature = req.temperature;
		if (req.maxTokens != null) result.max_tokens = req.maxTokens;
		if (req.topP != null) result.top_p = req.topP;
		if (req.stopSequences) result.stop = req.stopSequences;
		if (req.stream) result.stream = true;
		if (req.tools) {
			result.tools = req.tools.map((t) => ({
				type: 'function',
				function: { name: t.name, description: t.description, parameters: t.inputSchema },
			}));
		}
		return result;
	}

	responseToCanonical(raw: unknown): CanonicalResponse {
		const r = raw as Record<string, unknown>;
		const choice = ((r.choices as Array<Record<string, unknown>>) ?? [])[0] ?? {};
		const msg = (choice.message as Record<string, unknown>) ?? {};

		const content: ContentBlock[] = [];
		if (msg.content) content.push({ type: 'text', text: String(msg.content) });
		if (Array.isArray(msg.tool_calls)) {
			for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
				const fn = tc.function as Record<string, unknown>;
				content.push({
					type: 'tool_use',
					id: String(tc.id),
					name: String(fn.name),
					input: JSON.parse(String(fn.arguments ?? '{}')),
				});
			}
		}

		const usage = (r.usage as Record<string, number>) ?? {};
		const finishReason = String(choice.finish_reason ?? 'stop');

		const stopReasonMap: Record<string, CanonicalResponse['stopReason']> = {
			stop: 'end',
			length: 'max_tokens',
			tool_calls: 'tool_use',
			content_filter: 'content_filter',
		};

		return {
			id: String(r.id ?? ''),
			model: String(r.model ?? ''),
			content,
			stopReason: stopReasonMap[finishReason] ?? 'unknown',
			usage: {
				inputTokens: usage.prompt_tokens ?? 0,
				outputTokens: usage.completion_tokens ?? 0,
				totalTokens: usage.total_tokens ?? 0,
			},
		};
	}

	responseFromCanonical(res: CanonicalResponse): unknown {
		const message: Record<string, unknown> = { role: 'assistant' };
		const textParts = res.content.filter((b) => b.type === 'text');
		const toolParts = res.content.filter((b) => b.type === 'tool_use');

		if (textParts.length > 0) {
			message.content = textParts.map((b) => (b as { text: string }).text).join('');
		}
		if (toolParts.length > 0) {
			message.tool_calls = toolParts.map((b) => {
				const tu = b as { id: string; name: string; input: Record<string, unknown> };
				return {
					id: tu.id,
					type: 'function',
					function: { name: tu.name, arguments: JSON.stringify(tu.input) },
				};
			});
		}

		const stopReasonMap: Record<string, string> = {
			end: 'stop',
			max_tokens: 'length',
			tool_use: 'tool_calls',
			content_filter: 'content_filter',
		};

		return {
			id: res.id,
			object: 'chat.completion',
			model: res.model,
			choices: [
				{
					index: 0,
					message,
					finish_reason: stopReasonMap[res.stopReason] ?? 'stop',
				},
			],
			usage: {
				prompt_tokens: res.usage.inputTokens,
				completion_tokens: res.usage.outputTokens,
				total_tokens: res.usage.totalTokens,
			},
		};
	}

	streamChunkToCanonical(chunk: unknown): CanonicalStreamChunk | null {
		const c = chunk as Record<string, unknown>;
		// Handle [DONE]
		if (c === null || (typeof c === 'string' && c.trim() === '[DONE]')) {
			return { type: 'done' };
		}

		const choice = ((c.choices as Array<Record<string, unknown>>) ?? [])[0];
		if (!choice) {
			if (c.usage) {
				const usage = c.usage as Record<string, number>;
				return {
					type: 'usage',
					usage: {
						inputTokens: usage.prompt_tokens ?? 0,
						outputTokens: usage.completion_tokens ?? 0,
						totalTokens: usage.total_tokens ?? 0,
					},
				};
			}
			return null;
		}

		const delta = (choice.delta as Record<string, unknown>) ?? {};
		if (delta.content) {
			return { type: 'content_delta', delta: { text: String(delta.content) } };
		}
		if (delta.tool_calls) {
			const tc = (delta.tool_calls as Array<Record<string, unknown>>)[0];
			const fn = (tc?.function as Record<string, unknown>) ?? {};
			return {
				type: 'tool_use_delta',
				delta: {
					toolUseId: tc?.id ? String(tc.id) : undefined,
					toolName: fn.name ? String(fn.name) : undefined,
					inputJson: fn.arguments ? String(fn.arguments) : undefined,
				},
			};
		}

		if (choice.finish_reason) return null; // final chunk before [DONE]
		return null;
	}

	streamChunkFromCanonical(chunk: CanonicalStreamChunk): unknown {
		if (chunk.type === 'done') return '[DONE]';
		if (chunk.type === 'content_delta') {
			return {
				object: 'chat.completion.chunk',
				choices: [{ index: 0, delta: { content: chunk.delta?.text ?? '' } }],
			};
		}
		if (chunk.type === 'tool_use_delta') {
			const tc: Record<string, unknown> = { type: 'function', function: {} };
			if (chunk.delta?.toolUseId) tc.id = chunk.delta.toolUseId;
			if (chunk.delta?.toolName) (tc.function as Record<string, unknown>).name = chunk.delta.toolName;
			if (chunk.delta?.inputJson) (tc.function as Record<string, unknown>).arguments = chunk.delta.inputJson;
			return {
				object: 'chat.completion.chunk',
				choices: [{ index: 0, delta: { tool_calls: [tc] } }],
			};
		}
		if (chunk.type === 'usage' && chunk.usage) {
			return {
				object: 'chat.completion.chunk',
				usage: {
					prompt_tokens: chunk.usage.inputTokens,
					completion_tokens: chunk.usage.outputTokens,
					total_tokens: chunk.usage.totalTokens,
				},
			};
		}
		return null;
	}
}
