import { describe, expect, it } from 'vitest';
import { parseSSEText, writeSSEStream } from '../../../src/proxy/stream.js';
import { AnthropicTransformer } from '../../../src/proxy/transforms/anthropic.js';
import { OpenAITransformer } from '../../../src/proxy/transforms/openai.js';

describe('SSE Parsing', () => {
  it('parses OpenAI-style SSE chunks', () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":" world"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');

    const events = [...parseSSEText(sse)];
    expect(events).toHaveLength(3);
    expect(events[0].data).toContain('Hello');
    expect(events[1].data).toContain(' world');
    expect(events[2].data).toBe('[DONE]');
  });

  it('parses Anthropic-style SSE with event types', () => {
    const sse = [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi"}}',
      '',
      'event: message_stop',
      'data: {}',
      '',
    ].join('\n');

    const events = [...parseSSEText(sse)];
    expect(events).toHaveLength(2);
    expect(events[0].event).toBe('content_block_delta');
    expect(events[0].data).toContain('text_delta');
    expect(events[1].event).toBe('message_stop');
  });

  it('skips comment lines', () => {
    const sse = ': this is a comment\ndata: {"test":true}\n\n';
    const events = [...parseSSEText(sse)];
    expect(events).toHaveLength(1);
    expect(events[0].data).toBe('{"test":true}');
  });

  it('handles empty input', () => {
    expect([...parseSSEText('')]).toHaveLength(0);
    expect([...parseSSEText('\n\n')]).toHaveLength(0);
  });

  describe('Transformer chunk parsing produces correct canonical chunks', () => {
    const openai = new OpenAITransformer();
    const anthropic = new AnthropicTransformer();

    it('OpenAI content delta', () => {
      const chunk = openai.streamChunkToCanonical({
        choices: [{ delta: { content: 'test' } }],
      });
      expect(chunk).toEqual({ type: 'content_delta', delta: { text: 'test' } });
    });

    it('OpenAI tool call delta', () => {
      const chunk = openai.streamChunkToCanonical({
        choices: [
          {
            delta: {
              tool_calls: [{ id: 'tc-1', function: { name: 'search', arguments: '{"q":' } }],
            },
          },
        ],
      });
      expect(chunk?.type).toBe('tool_use_delta');
      expect(chunk?.delta?.toolUseId).toBe('tc-1');
      expect(chunk?.delta?.toolName).toBe('search');
    });

    it('OpenAI [DONE] produces done chunk', () => {
      const chunk = openai.streamChunkFromCanonical({ type: 'done' });
      expect(chunk).toBe('[DONE]');
    });

    it('Anthropic content_block_delta → content_delta', () => {
      const chunk = anthropic.streamChunkToCanonical({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'hello' },
      });
      expect(chunk).toEqual({ type: 'content_delta', delta: { text: 'hello' } });
    });

    it('Anthropic message_stop → done', () => {
      const chunk = anthropic.streamChunkToCanonical({ type: 'message_stop' });
      expect(chunk).toEqual({ type: 'done' });
    });

    it('Anthropic ping → null (ignored)', () => {
      const chunk = anthropic.streamChunkToCanonical({ type: 'ping' });
      expect(chunk).toBeNull();
    });

    it('Anthropic message_delta → usage', () => {
      const chunk = anthropic.streamChunkToCanonical({
        type: 'message_delta',
        usage: { input_tokens: 10, output_tokens: 20 },
      });
      expect(chunk?.type).toBe('usage');
      expect(chunk?.usage?.outputTokens).toBe(20);
    });
  });

  describe('writeSSEStream', () => {
    it('returns the final usage summary while streaming OpenAI chunks', async () => {
      const openai = new OpenAITransformer();
      let body = '';
      const headers = new Map<string, string>();
      let flushed = false;
      let ended = false;

      const res = {
        end() {
          ended = true;
        },
        flushHeaders() {
          flushed = true;
        },
        setHeader(name: string, value: string) {
          headers.set(name, value);
        },
        write(chunk: string) {
          body += chunk;
        },
      } as unknown as import('express').Response;

      async function* chunks() {
        yield { type: 'content_delta', delta: { text: 'Hello' } } as const;
        yield {
          type: 'usage',
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
        } as const;
        yield { type: 'done' } as const;
      }

      const usage = await writeSSEStream(res, chunks(), openai);

      expect(headers.get('Content-Type')).toBe('text/event-stream');
      expect(flushed).toBe(true);
      expect(ended).toBe(true);
      expect(body).toContain('"content":"Hello"');
      expect(body).toContain('"total_tokens":30');
      expect(body).toContain('[DONE]');
      expect(usage).toEqual({ inputTokens: 10, outputTokens: 20, totalTokens: 30 });
    });
  });
});
