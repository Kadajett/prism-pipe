import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { callProvider, callProviderStream } from './provider';
import { createTimeoutBudget } from '../core/timeout';
import type { ProviderTransformer } from './transform-registry';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';

/**
 * Minimal transformer that passes data through for testing latency measurement.
 */
const stubTransformer: ProviderTransformer = {
  provider: 'openai',
  toCanonical: (body: unknown) => body as any,
  fromCanonical: (req: unknown) => req as any,
  responseToCanonical: (raw: any) => ({
    model: raw.model ?? 'test',
    messages: [],
    choices: raw.choices ?? [{ message: { role: 'assistant', content: 'ok' }, index: 0 }],
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    stopReason: 'stop',
  }),
  responseFromCanonical: (res: unknown) => res as any,
  streamChunkToCanonical: (raw: any) => {
    if (raw.choices?.[0]?.delta?.content) {
      return { type: 'delta' as const, content: raw.choices[0].delta.content };
    }
    return null;
  },
};

let server: Server;
let baseUrl: string;
const FAKE_DELAY_MS = 50;

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '';

    if (url.includes('/v1/chat/completions')) {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const parsed = JSON.parse(body);

        // Simulate network + inference delay
        setTimeout(() => {
          if (parsed.stream) {
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              Connection: 'keep-alive',
            });

            // Send first chunk after delay
            setTimeout(() => {
              res.write(
                'data: ' +
                  JSON.stringify({
                    choices: [{ delta: { content: 'Hello' }, index: 0 }],
                  }) +
                  '\n\n'
              );

              // Send second chunk
              setTimeout(() => {
                res.write(
                  'data: ' +
                    JSON.stringify({
                      choices: [{ delta: { content: ' world' }, index: 0 }],
                    }) +
                    '\n\n'
                );
                res.write('data: [DONE]\n\n');
                res.end();
              }, 20);
            }, FAKE_DELAY_MS);
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                model: 'test-model',
                choices: [
                  { message: { role: 'assistant', content: 'Hello' }, index: 0, finish_reason: 'stop' },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
              })
            );
          }
        }, FAKE_DELAY_MS);
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('callProvider latency measurement', () => {
  it('should measure realistic upstream latency for non-streaming calls', async () => {
    const result = await callProvider({
      providerConfig: {
        name: 'test-provider',
        baseUrl,
        apiKey: 'test-key',
        models: ['test-model'],
        enabled: true,
      },
      transformer: stubTransformer,
      body: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }] },
      timeout: createTimeoutBudget(10000),
    });

    // Latency should be at least the fake delay
    expect(result.latencyMs).toBeGreaterThanOrEqual(FAKE_DELAY_MS - 5);
    expect(result.latencyMs).toBeLessThan(5000);
    expect(result.provider).toBe('test-provider');
  });

  it('should measure upstream latency and TTFB for streaming calls', async () => {
    const result = await callProviderStream({
      providerConfig: {
        name: 'test-provider',
        baseUrl,
        apiKey: 'test-key',
        models: ['test-model'],
        enabled: true,
      },
      transformer: stubTransformer,
      body: { model: 'test-model', messages: [{ role: 'user', content: 'hi' }], stream: true },
      timeout: createTimeoutBudget(10000),
    });

    // HTTP response latency (headers received)
    expect(result.latencyMs).toBeGreaterThanOrEqual(FAKE_DELAY_MS - 5);
    expect(result.provider).toBe('test-provider');

    // Consume chunks to populate ttfbMs
    const chunks: unknown[] = [];
    for await (const chunk of result.chunks) {
      chunks.push(chunk);
    }

    // Should have received content chunks + done
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    // TTFB should be >= HTTP latency (first chunk comes after HTTP headers + additional delay)
    expect(result.ttfbMs).toBeGreaterThanOrEqual(FAKE_DELAY_MS - 5);
    // TTFB should be different from latencyMs since there's extra delay for first chunk
    expect(result.ttfbMs).toBeGreaterThanOrEqual(result.latencyMs);
  });
});
