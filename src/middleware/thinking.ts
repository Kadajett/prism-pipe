/**
 * Thinking middleware: Simulates Claude-style extended thinking using
 * Mercury-2's fast inference with multi-step reasoning.
 *
 * Flow:
 *  1. Decompose: Mercury-2 structured output → reasoning steps
 *  2. Reason: Mercury-2 per-step (instant) → one-sentence summaries
 *  3. Synthesize: Mercury-2 with full context → final answer
 *  4. Stream back as thinking blocks + text block
 */

import type { CanonicalStreamChunk } from '../core/types.js';

// ─── Types ───

export interface ThinkingStep {
  summary: string;
  detail: string;
}

export interface MercuryCallOptions {
  baseUrl: string;
  apiKey: string;
  model?: string;
  reasoningEffort?: 'instant' | 'default';
}

interface StructuredDecomposition {
  steps: string[];
}

interface StepResult {
  summary: string;
  detail: string;
}

// ─── Mercury-2 API helpers ───

async function mercuryChat(
  opts: MercuryCallOptions,
  messages: Array<{ role: string; content: string }>,
  responseFormat?: Record<string, unknown>
): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const body: Record<string, unknown> = {
    model: opts.model ?? 'mercury-2',
    messages,
    stream: false,
  };
  if (opts.reasoningEffort) {
    body.reasoning_effort = opts.reasoningEffort;
  }
  if (responseFormat) {
    body.response_format = responseFormat;
  }

  const res = await fetch(`${opts.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Mercury-2 call failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const choices = data.choices as Array<Record<string, unknown>>;
  const message = choices[0].message as Record<string, string>;
  const usage = data.usage as { prompt_tokens: number; completion_tokens: number };

  return { content: message.content, usage };
}

// ─── Structured output schema for step decomposition ───

const DECOMPOSE_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'ReasoningSteps',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Concise description of each reasoning step needed',
        },
      },
      required: ['steps'],
    },
  },
};

const STEP_RESULT_SCHEMA = {
  type: 'json_schema' as const,
  json_schema: {
    name: 'StepResult',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'One-sentence summary of findings from this step',
        },
        detail: {
          type: 'string',
          description: 'Detailed reasoning and findings',
        },
      },
      required: ['summary', 'detail'],
    },
  },
};

// ─── Core thinking pipeline ───

/**
 * Execute a multi-step thinking pipeline using Mercury-2.
 * Returns an async generator that yields SSE-compatible stream chunks:
 *  - thinking_delta chunks (one per reasoning step summary)
 *  - content_delta chunks (final answer)
 *  - done chunk
 */
export async function* thinkingPipeline(
  userMessage: string,
  systemPrompt: string | undefined,
  opts: MercuryCallOptions
): AsyncGenerator<CanonicalStreamChunk> {
  let totalInput = 0;
  let totalOutput = 0;

  // ── Step 1: Decompose into reasoning steps ──
  const decomposeMessages = [
    {
      role: 'system',
      content: `You are a reasoning planner. Given a question or task, break it into 3-5 discrete reasoning steps needed to arrive at a thorough answer. Each step should be a concise action like "Analyze X", "Compare Y with Z", "Consider edge case W".${systemPrompt ? `\n\nAdditional context: ${systemPrompt}` : ''}`,
    },
    { role: 'user', content: userMessage },
  ];

  const decomposition = await mercuryChat(opts, decomposeMessages, DECOMPOSE_SCHEMA);
  totalInput += decomposition.usage.prompt_tokens;
  totalOutput += decomposition.usage.completion_tokens;

  let parsed: StructuredDecomposition;
  try {
    parsed = JSON.parse(decomposition.content) as StructuredDecomposition;
  } catch {
    // If structured output fails, fall back to single-step
    parsed = { steps: ['Analyze the question and provide a comprehensive answer'] };
  }

  // ── Step 2: Execute each reasoning step, stream summaries ──
  const completedSteps: ThinkingStep[] = [];
  const reasoningContext: string[] = [];

  for (const step of parsed.steps) {
    const stepMessages = [
      {
        role: 'system',
        content: `You are executing one step of a multi-step reasoning process. Your task for this step: "${step}"\n\nPrior reasoning so far:\n${reasoningContext.length > 0 ? reasoningContext.join('\n') : '(first step)'}`,
      },
      { role: 'user', content: userMessage },
    ];

    const stepResult = await mercuryChat(
      { ...opts, reasoningEffort: 'instant' },
      stepMessages,
      STEP_RESULT_SCHEMA
    );
    totalInput += stepResult.usage.prompt_tokens;
    totalOutput += stepResult.usage.completion_tokens;

    let stepParsed: StepResult;
    try {
      stepParsed = JSON.parse(stepResult.content) as StepResult;
    } catch {
      stepParsed = { summary: stepResult.content.slice(0, 200), detail: stepResult.content };
    }

    completedSteps.push(stepParsed);
    reasoningContext.push(`[${step}]: ${stepParsed.summary}`);

    // Stream this thinking step as a thinking_delta chunk
    yield {
      type: 'content_delta',
      delta: { text: `${stepParsed.summary}\n` },
      // We repurpose content_delta here; the caller wraps it in a thinking block
    } satisfies CanonicalStreamChunk;
  }

  // ── Step 3: Synthesize final answer ──
  const synthesizeMessages = [
    {
      role: 'system',
      content: `You are providing a final, well-reasoned answer. You have already completed the following reasoning steps:\n\n${reasoningContext.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n\nNow synthesize these findings into a clear, complete answer.${systemPrompt ? `\n\nAdditional context: ${systemPrompt}` : ''}`,
    },
    { role: 'user', content: userMessage },
  ];

  const synthesis = await mercuryChat(opts, synthesizeMessages);
  totalInput += synthesis.usage.prompt_tokens;
  totalOutput += synthesis.usage.completion_tokens;

  // Signal end of thinking, start of answer
  yield { type: 'content_delta', delta: { text: synthesis.content } };

  // Final usage + done
  yield {
    type: 'usage',
    usage: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
    },
  };
  yield { type: 'done' };
}

/**
 * Format thinking pipeline output as Anthropic-style SSE events.
 * Produces: thinking block events → text block events → message_stop
 */
export async function* formatAsAnthropicThinking(
  pipeline: AsyncGenerator<CanonicalStreamChunk>
): AsyncGenerator<string> {
  let blockIndex = 0;
  let inThinking = true;

  // Start thinking block
  yield `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: blockIndex, content_block: { type: 'thinking', thinking: '' } })}\n\n`;

  for await (const chunk of pipeline) {
    if (chunk.type === 'content_delta' && inThinking) {
      // Check if this is the final answer (after all thinking steps)
      // Heuristic: if the text doesn't end with \n, it's the final answer
      if (chunk.delta?.text && !chunk.delta.text.endsWith('\n')) {
        // End thinking block
        yield `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: blockIndex })}\n\n`;
        blockIndex++;
        inThinking = false;

        // Start text block
        yield `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } })}\n\n`;
        yield `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: blockIndex, delta: { type: 'text_delta', text: chunk.delta.text } })}\n\n`;
      } else {
        // Thinking step summary
        yield `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: blockIndex, delta: { type: 'thinking_delta', thinking: chunk.delta?.text ?? '' } })}\n\n`;
      }
    } else if (chunk.type === 'usage') {
      // Usage event
      yield `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', usage: { input_tokens: chunk.usage?.inputTokens, output_tokens: chunk.usage?.outputTokens } })}\n\n`;
    } else if (chunk.type === 'done') {
      if (inThinking) {
        yield `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: blockIndex })}\n\n`;
      }
      yield `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: blockIndex })}\n\n`;
      yield `event: message_stop\ndata: {}\n\n`;
    }
  }
}
