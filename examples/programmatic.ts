#!/usr/bin/env tsx
/**
 * Programmatic example: run all 3 proxy configs as a single process.
 *
 * This replaces running 3 separate YAML config processes via start-all.sh.
 * Usage: INCEPTION_API_KEY=... ANTHROPIC_API_KEY=... tsx examples/programmatic.ts
 */

import { PrismPipe } from '../src/lib';

const prism = new PrismPipe({ logLevel: 'info', storeType: 'sqlite' });

// ── Port 3100: Mercury Direct ──────────────────────────────────────────────
prism.createProxy({
  id: 'mercury-direct',
  port: 3100,
  providers: {
    mercury: {
      name: 'mercury',
      baseUrl: 'https://api.inceptionlabs.ai',
      apiKey: process.env.INCEPTION_API_KEY!,
      format: 'openai',
    },
  },
  routes: {
    '/v1/chat/completions': { providers: ['mercury'] },
  },
});

// ── Port 3101: Opus → Mercury → Opus (planner/executor/reviewer) ──────────
prism.createProxy({
  id: 'opus-mercury-opus',
  port: 3101,
  providers: {
    mercury: {
      name: 'mercury',
      baseUrl: 'https://api.inceptionlabs.ai',
      apiKey: process.env.INCEPTION_API_KEY!,
      format: 'openai',
    },
    opus: {
      name: 'opus',
      baseUrl: 'https://api.anthropic.com',
      apiKey: process.env.ANTHROPIC_API_KEY!,
      format: 'anthropic',
    },
  },
  routes: {
    '/v1/chat/completions': {
      compose: {
        type: 'chain',
        steps: [
          {
            name: 'planner',
            provider: 'opus',
            model: 'claude-opus-4-6',
            systemPrompt: [
              'You are a senior software architect. Your job is to PLAN, not code.',
              '',
              "Given the user's task, produce a clear, ordered plan with:",
              '1. What files need to be read first (for context)',
              '2. What changes need to be made (specific files, functions, line-level detail)',
              '3. What the success criteria are (how to verify it works)',
              '4. Anti-patterns to avoid',
              '',
              'Be specific about file paths relative to the workspace root.',
              'Do NOT write code — just plan. The executor will implement.',
            ].join('\n'),
            inputTransform: '{{original.lastUserMessage}}',
            timeout: 60000,
          },
          {
            name: 'executor',
            provider: 'mercury',
            model: 'mercury-2',
            systemPrompt: [
              'You are a fast, precise code executor. You receive a plan from an architect.',
              '',
              'PLAN:',
              '{{steps.planner.content}}',
              '',
              'Execute EXACTLY what the plan says. Write complete, working code.',
              'For each file change, output the COMPLETE file content with clear markers:',
              '',
              '=== FILE: path/to/file.ts ===',
              '(complete file content here)',
              '=== END FILE ===',
              '',
              'Do not deviate from the plan. Do not add features not in the plan.',
            ].join('\n'),
            inputTransform:
              'Execute this plan:\n\n{{steps.planner.content}}\n\nOriginal task: {{original.lastUserMessage}}',
            timeout: 60000,
          },
          {
            name: 'reviewer',
            provider: 'opus',
            model: 'claude-opus-4-6',
            systemPrompt: [
              'You are a senior code reviewer. You have:',
              '1. The original task',
              "2. The architect's plan",
              "3. The executor's implementation",
              '',
              'Review for: correctness, completeness, edge cases, security, style.',
              'If GOOD: summarize what was done.',
              'If ISSUES: list them clearly and include "NEEDS_REVISION".',
            ].join('\n'),
            inputTransform: [
              '## Original Task',
              '{{original.lastUserMessage}}',
              '',
              '## Architect Plan',
              '{{steps.planner.content}}',
              '',
              '## Executor Implementation',
              '{{steps.executor.content}}',
              '',
              'Review the implementation against the plan and original task.',
            ].join('\n'),
            timeout: 60000,
          },
        ],
      },
    },
  },
});

// ── Port 3102: Fast Think (thinker → executor) ────────────────────────────
prism.createProxy({
  id: 'fast-think',
  port: 3102,
  providers: {
    mercury: {
      name: 'mercury',
      baseUrl: 'https://api.inceptionlabs.ai',
      apiKey: process.env.INCEPTION_API_KEY!,
      format: 'openai',
    },
  },
  routes: {
    '/v1/chat/completions': {
      compose: {
        type: 'chain',
        steps: [
          {
            name: 'thinker',
            provider: 'mercury',
            model: 'mercury-2',
            systemPrompt: [
              'Think step by step about how to solve this task.',
              'List the key considerations, potential issues, and your approach.',
              'Do NOT write the final answer yet — just think through it.',
            ].join('\n'),
            inputTransform:
              'Think through this problem step by step:\n\n{{original.lastUserMessage}}',
            timeout: 30000,
          },
          {
            name: 'executor',
            provider: 'mercury',
            model: 'mercury-2',
            systemPrompt: [
              'You previously thought through this problem. Now execute.',
              '',
              'Your thinking:',
              '{{steps.thinker.content}}',
              '',
              'Now produce the final, complete answer.',
            ].join('\n'),
            inputTransform:
              'Based on your analysis:\n{{steps.thinker.content}}\n\nNow produce the final answer for: {{original.lastUserMessage}}',
            timeout: 30000,
          },
        ],
      },
    },
  },
});

// ── Global error handler ──────────────────────────────────────────────────
prism.onError((event) => {
  const { error, context } = event;
  console.error(`[${context.port ?? '?'}${context.route ?? ''}] ${error.message}`);
});

// ── Start ─────────────────────────────────────────────────────────────────
console.log('Starting Prism Pipe (programmatic mode)...');
await prism.start();
console.log('✅ All proxies running:');
for (const proxy of prism.getProxies()) {
  const s = proxy.status();
  console.log(`  ${s.id} → :${s.port} [${s.state}]`);
}

// Graceful shutdown
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    console.log(`\n${signal} received, shutting down...`);
    await prism.shutdown();
    process.exit(0);
  });
}
