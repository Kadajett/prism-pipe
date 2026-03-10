# Public API Proposal

This document defines the intended stable public API for Prism Pipe.

It is a proposal for the API that users should build against. The current
implementation does not fully match this document yet.

## Goals

- One obvious way to build on top of Prism Pipe
- Express-like route authoring, but with AI orchestration built into handlers
- Full lifecycle at both the Prism and Proxy levels
- Built-in token and cost accounting across models, proxies, and routes
- Direct programmatic route returns instead of hand-writing response plumbing

## Core Concepts

### PrismPipe

`PrismPipe` is the root runtime container.

It owns:

- the model registry
- shared storage
- aggregate usage and cost accounting
- global logs and status
- global lifecycle for all registered proxies

### Proxy

A `Proxy` is a named listening surface.

It owns:

- a port
- a set of routes
- proxy-local model overrides
- proxy-local logs, status, usage, and cost views

One proxy should represent one application surface that a tool talks to, such as:

- `claude-code`
- `codex`
- `vscode-chat`
- `mercury-thinker`

### Route

A route is a function that returns structured output:

- `data`: the payload sent back to the caller
- `usage`: optional model-keyed usage map

Routes do not need to manually send the HTTP response unless they want to bypass
the standard Prism Pipe behavior.

## Public Surface

```ts
const prism = new PrismPipe();

prism.registerModel("claude-opus-4-6", {
  provider: "anthropic",
  inputCostPerMillion: 15,
  outputCostPerMillion: 75,
  thinkingCostPerMillion: 75,
});

const claudeCodeProxy = prism.createProxy({
  id: "claude-code",
  port: 3100,
  routes: {
    "/v1/chat/completions": async (req, ctx) => {
      return {
        data: {
          id: "chatcmpl-123",
          object: "chat.completion",
          choices: [],
        },
        usage: {
          "claude-opus-4-6": {
            inputTokens: 1200,
            outputTokens: 300,
            thinkingTokens: 200,
          },
        },
      };
    },
  },
});

await prism.start();
```

## Class API

### PrismPipe

```ts
class PrismPipe {
  constructor(config?: PrismConfig);

  createProxy(config: ProxyConfig): Proxy;
  getProxies(): Proxy[];

  registerModel(name: string, model: ModelDefinition): this;
  getModel(name: string): ResolvedModelDefinition | undefined;

  start(): Promise<void>;
  stop(): Promise<void>;
  reload(): Promise<void>;

  status(): PrismStatus;
  getLogs(query?: LogQuery): Promise<RequestLogEntry[]>;

  getUsage(query?: UsageQuery): Promise<UsageSummary>;
  getCost(query?: UsageQuery): Promise<CostSummary>;
  getUsageByModel(query?: UsageQuery): Promise<Record<string, UsageSummary>>;
  getCostByModel(query?: UsageQuery): Promise<Record<string, CostSummary>>;
  getUsageByProxy(query?: UsageQuery): Promise<Record<string, UsageSummary>>;
  getCostByProxy(query?: UsageQuery): Promise<Record<string, CostSummary>>;
}
```

### Proxy

```ts
class Proxy {
  readonly id: string;
  readonly port: number;

  registerModel(name: string, model: ModelDefinition): this;
  getModel(name: string): ResolvedModelDefinition | undefined;

  start(): Promise<void>;
  stop(): Promise<void>;
  reload(): Promise<void>;

  status(): ProxyStatus;
  getLogs(query?: LogQuery): Promise<RequestLogEntry[]>;

  getUsage(query?: UsageQuery): Promise<UsageSummary>;
  getCost(query?: UsageQuery): Promise<CostSummary>;
  getUsageByModel(query?: UsageQuery): Promise<Record<string, UsageSummary>>;
  getCostByModel(query?: UsageQuery): Promise<Record<string, CostSummary>>;
  getUsageByRoute(query?: UsageQuery): Promise<Record<string, UsageSummary>>;
  getCostByRoute(query?: UsageQuery): Promise<Record<string, CostSummary>>;
}
```

## Model Registration

Models are only needed for token and cost tracking.

If a route does not use a tracked model, it simply omits usage.

```ts
type ModelDefinition = {
  provider: string;
  inputCostPerMillion?: number;
  outputCostPerMillion?: number;
  thinkingCostPerMillion?: number;
  cacheReadCostPerMillion?: number;
  cacheWriteCostPerMillion?: number;
  metadata?: Record<string, unknown>;
};
```

### Inheritance Rules

- Prism-level model definitions are global defaults
- Proxy-level model definitions override Prism-level models with the same name
- Route-level calls resolve models against the proxy first, then Prism

This lets a proxy replace pricing or behavior for a model alias without touching
other proxies.

## Route Contract

Routes return structured results.

```ts
type RouteResult = {
  data: unknown;
  usage?: Record<string, ModelUsage>;
  meta?: {
    status?: number;
    headers?: Record<string, string>;
  };
};

type ModelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};
```

### Rules

- If `usage` is omitted, the route is treated as having no tracked model usage
- If `usage` is present, each key must be a model name
- Any model with zero pricing still contributes to token totals but adds zero cost
- This allows tracking tokens for private, local, or non-billed models without
  inventing fake pricing

## Context Helpers

Routes should have direct helpers for model calls and result shaping.

```ts
type RouteContext = {
  proxy: Proxy;
  prism: PrismPipe;
  requestId: string;
  routePath: string;
  models: {
    call(model: string, input: ModelCallInput): Promise<ModelCallResult>;
  };
  ok(data: unknown, usage?: Record<string, ModelUsage>): RouteResult;
  fail(status: number, message: string, usage?: Record<string, ModelUsage>): never;
};
```

`models.call()` should return both the provider response and normalized usage for
that model. The route can then merge usage from many internal calls into the
single outward response.

## Accounting Model

Every handled request produces a usage ledger entry with dimensions such as:

- proxy id
- route path
- model name
- request id
- tenant id
- token totals
- computed cost

From that ledger, Prism Pipe can aggregate:

- total usage across the whole Prism instance
- total cost across the whole Prism instance
- usage/cost by proxy
- usage/cost by route
- usage/cost by model

This supports the core use case where one outward request is fulfilled by many
internal model calls.

## Status Model

### Prism status

`prism.status()` should return:

- running or stopped state
- all registered proxies
- which proxies are currently listening
- aggregate request counts
- aggregate token counts
- aggregate cost totals

### Proxy status

`proxy.status()` should return:

- running or stopped state
- bound port
- route list
- last start time
- last reload time
- request totals
- token totals
- cost totals
- per-model breakdown

## Legacy Compatibility

The legacy `createPrismPipe()` API can remain as a compatibility layer.

However, this class-based API is intended to become the primary and preferred
programmatic surface.

## Example: Mercury Thinker

This example shows how a single proxy with a single route can turn a cheap,
non-thinking model into a "thinking" endpoint by orchestrating multiple internal
calls and returning one final response.

It is modeled after the `mercury-thinker` project in this workspace.

```ts
import { PrismPipe } from "prism-pipe";

const prism = new PrismPipe();

prism.registerModel("mercury-2", {
  provider: "inception",
  inputCostPerMillion: 0.25,
  outputCostPerMillion: 1.0,
});

const mercuryThinker = prism.createProxy({
  id: "mercury-thinker",
  port: 3100,
  routes: {
    "/v1/chat/completions": async (req, ctx) => {
      const body = req.body as {
        model?: string;
        messages: Array<{ role: string; content: string }>;
      };

      const planner = await ctx.models.call("mercury-2", {
        messages: [
          {
            role: "system",
            content: "Break the problem into a short plan before solving it.",
          },
          ...body.messages,
        ],
      });

      const thinker = await ctx.models.call("mercury-2", {
        messages: [
          {
            role: "system",
            content: "Think step by step, using the plan as scratchpad context.",
          },
          {
            role: "assistant",
            content: planner.data.choices[0].message.content,
          },
          ...body.messages,
        ],
      });

      const reviewer = await ctx.models.call("mercury-2", {
        messages: [
          {
            role: "system",
            content: "Rewrite the draft into a clean final answer for the user.",
          },
          {
            role: "assistant",
            content: thinker.data.choices[0].message.content,
          },
          ...body.messages,
        ],
      });

      return ctx.ok(
        {
          id: reviewer.data.id,
          object: "chat.completion",
          model: "mercury-thinker",
          choices: reviewer.data.choices,
        },
        {
          "mercury-2": {
            inputTokens:
              (planner.usage.inputTokens ?? 0) +
              (thinker.usage.inputTokens ?? 0) +
              (reviewer.usage.inputTokens ?? 0),
            outputTokens:
              (planner.usage.outputTokens ?? 0) +
              (thinker.usage.outputTokens ?? 0) +
              (reviewer.usage.outputTokens ?? 0),
            thinkingTokens:
              (planner.usage.thinkingTokens ?? 0) +
              (thinker.usage.thinkingTokens ?? 0) +
              (reviewer.usage.thinkingTokens ?? 0),
          },
        },
      );
    },
  },
});

await mercuryThinker.start();

console.log(mercuryThinker.status());
console.log(await mercuryThinker.getUsageByModel());
console.log(await prism.getCostByProxy());
```

### Why this example matters

From the outside, the caller sees one normal chat-completions endpoint.

Inside Prism Pipe, that single route can:

- decompose the problem
- think through the solution
- review and rewrite the answer
- aggregate usage across all internal model calls
- expose total token and cost accounting through the Prism and Proxy APIs

That is the intended developer experience: simple outward routes with powerful
internal orchestration and trustworthy accounting.
