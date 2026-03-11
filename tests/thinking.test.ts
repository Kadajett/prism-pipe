import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismPipe, type ProxyInstance, type RouteResult } from '../src/lib.js';
import {
  formatAsAnthropicThinking,
  type MercuryCallOptions,
  thinkingPipeline,
} from '../src/middleware/thinking.js';
import { parseSSEText } from '../src/proxy/stream.js';

const API_KEY = process.env.INCEPTION_API_KEY ?? 'sk_d63d8dcb9855700e0cde95f8ebbca0a5';
const BASE_URL = 'https://api.inceptionlabs.ai';
const MERCURY_MODEL = 'mercury-2';

const mercuryOpts: MercuryCallOptions = {
  baseUrl: BASE_URL,
  apiKey: API_KEY,
  model: MERCURY_MODEL,
};

describe('Thinking Pipeline: Mercury-2 multi-step reasoning', () => {
  let prism: PrismPipe;
  let proxy: ProxyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    prism = new PrismPipe({
      logLevel: 'silent',
      storeType: 'memory',
    });
    prism.registerModel(MERCURY_MODEL, {
      provider: 'inception',
      inputCostPerMillion: 0,
      outputCostPerMillion: 0,
    });

    proxy = prism.createProxy({
      port: 0,
      routes: {
        '/v1/messages': async (req, res) => {
          const body = isRecord(req.body) ? req.body : {};
          const question = extractUserQuestion(body);
          const systemPrompt = typeof body.system === 'string' ? body.system : undefined;
          let usage: RouteResult['usage'];

          res.setHeader('Content-Type', 'text/event-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Connection', 'keep-alive');
          res.flushHeaders();

          const pipeline = thinkingPipeline(question, systemPrompt, mercuryOpts);
          const formatted = formatAsAnthropicThinking(
            captureUsage(pipeline, (value) => {
              usage = {
                [MERCURY_MODEL]: {
                  inputTokens: value.inputTokens,
                  outputTokens: value.outputTokens,
                },
              };
            })
          );

          for await (const event of formatted) {
            res.write(event);
          }

          res.end();

          return {
            data: null,
            usage,
          };
        },
      },
    });

    await proxy.start();
    baseUrl = `http://localhost:${proxy.status().port}`;
  });

  afterAll(async () => {
    await prism.shutdown();
  });

  it('streams thinking and answer content through a PrismPipe route', async () => {
    const before = await proxy.getUsageByRoute();
    const raw = await requestThinkingRoute({
      baseUrl,
      question: 'Explain why quicksort has O(n²) worst case but O(n log n) average case.',
    });
    const events = [...parseSSEText(raw)];
    const thinkingDeltas = events.filter((event) => event.data.includes('thinking_delta'));
    const textDeltas = events.filter((event) => event.data.includes('text_delta'));
    const after = await proxy.getUsageByRoute();
    const routeUsage = after['/v1/messages']?.[MERCURY_MODEL];
    const beforeRequests = before['/v1/messages']?.[MERCURY_MODEL]?.requests ?? 0;

    expect(thinkingDeltas.length).toBeGreaterThanOrEqual(2);
    expect(textDeltas.length).toBe(1);
    expect(raw).toContain('message_stop');
    expect(routeUsage).toBeDefined();
    expect(routeUsage?.requests).toBe(beforeRequests + 1);
    expect(routeUsage?.inputTokens ?? 0).toBeGreaterThan(0);
    expect(routeUsage?.outputTokens ?? 0).toBeGreaterThan(0);
  }, 90_000);

  it('formats output as Anthropic-style SSE thinking events through the proxy route', async () => {
    const raw = await requestThinkingRoute({
      baseUrl,
      question: 'What is the difference between TCP and UDP?',
    });
    const events = [...parseSSEText(raw)];
    const thinkingDeltas = events.filter((event) => event.data.includes('thinking_delta'));
    const textDeltas = events.filter((event) => event.data.includes('text_delta'));

    expect(raw).toContain('content_block_start');
    expect(raw).toContain('thinking_delta');
    expect(raw).toContain('text_delta');
    expect(raw).toContain('message_stop');
    expect(thinkingDeltas.length).toBeGreaterThanOrEqual(2);
    expect(textDeltas.length).toBe(1);
  }, 90_000);

  it('keeps system prompts wired through the PrismPipe route', async () => {
    const raw = await requestThinkingRoute({
      baseUrl,
      question: 'How would you implement a rate limiter for an API?',
      systemPrompt:
        'You are a senior backend engineer. Be specific about algorithms and data structures.',
    });
    const events = [...parseSSEText(raw)];
    const answer = events
      .filter((event) => event.data.includes('text_delta'))
      .map((event) => event.data)
      .join('');

    expect(answer.length).toBeGreaterThan(50);
    expect(raw.toLowerCase()).toContain('redis');
  }, 90_000);
});

async function requestThinkingRoute(opts: {
  baseUrl: string;
  question: string;
  systemPrompt?: string;
}): Promise<string> {
  const { baseUrl, question, systemPrompt } = opts;
  const response = await fetch(`${baseUrl}/v1/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MERCURY_MODEL,
      system: systemPrompt,
      stream: true,
      messages: [{ role: 'user', content: question }],
    }),
  });

  expect(response.ok).toBe(true);
  expect(response.headers.get('content-type')).toContain('text/event-stream');

  return response.text();
}

async function* captureUsage(
  pipeline: AsyncGenerator<{
    type: string;
    usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
  }>,
  onUsage: (usage: { inputTokens: number; outputTokens: number; totalTokens: number }) => void
): AsyncGenerator<{
  type: string;
  usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
}> {
  for await (const chunk of pipeline) {
    if (chunk.type === 'usage' && chunk.usage) {
      onUsage(chunk.usage);
    }

    yield chunk;
  }
}

function extractUserQuestion(body: Record<string, unknown>): string {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const firstUserMessage = messages.find((message) => {
    if (!isRecord(message)) {
      return false;
    }

    return message.role === 'user';
  });

  if (!isRecord(firstUserMessage)) {
    return '';
  }

  if (typeof firstUserMessage.content === 'string') {
    return firstUserMessage.content;
  }

  if (!Array.isArray(firstUserMessage.content)) {
    return '';
  }

  const textBlock = firstUserMessage.content.find(
    (block) => isRecord(block) && block.type === 'text'
  );
  if (!isRecord(textBlock) || typeof textBlock.text !== 'string') {
    return '';
  }

  return textBlock.text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
