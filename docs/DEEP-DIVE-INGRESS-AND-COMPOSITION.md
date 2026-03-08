# Deep Dive: Ingress Layer, Error Handling, Transformations & Cost Accounting

---

## Table of Contents

- [1. The Ingress Layer (Client → Proxy)](#1-the-ingress-layer-client--proxy)
- [2. Timeout Architecture](#2-timeout-architecture)
- [3. Error Handling & Recovery](#3-error-handling--recovery)
- [4. Data Transformations](#4-data-transformations)
- [5. Cost Accounting](#5-cost-accounting)

---

## 1. The Ingress Layer (Client → Proxy)

The space between the client and the first provider call is where most of the value lives. This isn't just a passthrough — it's a programmable gateway.

### Full Request Lifecycle (Detailed)

```
Client HTTP Request
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. ACCEPT                                                       │
│     • TLS termination (if configured)                            │
│     • HTTP parsing (Express)                                     │
│     • Request ID generation (ulid, propagate X-Request-ID)       │
│     • Start global timeout clock                                 │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. AUTHENTICATE                                                 │
│     • API key validation                                         │
│     • JWT verification                                           │
│     • Tenant resolution (who is this, what are their limits?)    │
│     • Attach tenant context to request                           │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  3. ADMIT                                                        │
│     • Rate limit check (all applicable layers)                   │
│     • Concurrency limit check (max in-flight per tenant)         │
│     • Request size validation                                    │
│     • Model/provider ACL check (is this tenant allowed gpt-4o?) │
│     • Budget check (has this tenant exceeded spend limit?)       │
│     │                                                            │
│     │  ❌ Rejected? → 429/403 with structured error + Retry-After│
│     │     Emit: prism.request.rejected { reason, tenant, limits }│
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. ROUTE                                                        │
│     • Match request path/headers to a route config               │
│     • Resolve pipeline: which middleware + which compose strategy │
│     • Resolve providers: primary + fallback chain                │
│     • Clone request into PipelineContext (immutable original)    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  5. PIPELINE (middleware chain — the programmable part)           │
│     │                                                            │
│     │  Each middleware gets:                                      │
│     │  • ctx.request        (mutable working copy)               │
│     │  • ctx.original       (frozen original — for diffing)      │
│     │  • ctx.timeout        (remaining ms in the budget)         │
│     │  • ctx.log            (scoped structured logger)           │
│     │  • ctx.metrics        (scoped metrics emitter)             │
│     │  • ctx.store          (storage access)                     │
│     │  • ctx.abort()        (cancel everything, return error)    │
│     │  • ctx.shortCircuit() (skip remaining middleware, return)  │
│     │  • ctx.fork()         (fan-out to multiple providers)      │
│     │  • ctx.call()         (make an AI provider call)           │
│     │                                                            │
│     │  ┌─────────────────────────────────┐                       │
│     ├──│ Pre-flight middleware            │                       │
│     │  │ (transform input, enrich, guard)│                       │
│     │  └─────────────────────────────────┘                       │
│     │                                                            │
│     │  ┌─────────────────────────────────┐                       │
│     ├──│ Composition / Provider call      │                       │
│     │  │ (chain, fork-join, etc.)        │                       │
│     │  └─────────────────────────────────┘                       │
│     │                                                            │
│     │  ┌─────────────────────────────────┐                       │
│     └──│ Post-flight middleware           │                       │
│        │ (transform output, validate)    │                       │
│        └─────────────────────────────────┘                       │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│  6. RESPOND                                                      │
│     • Serialize response (JSON or SSE stream)                    │
│     • Attach rate limit headers                                  │
│     • Attach cost headers (X-Prism-Cost, X-Prism-Tokens)        │
│     • Attach timing headers (X-Prism-Latency, X-Prism-Provider) │
│     • Log final request entry                                    │
│     • Emit metrics                                               │
└─────────────────────────────────────────────────────────────────┘
```

### What the Client Sees (Response Headers)

Every response includes metadata about what happened inside the proxy:

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-Request-ID: 01JQXYZ...
X-Prism-Provider: anthropic/claude-sonnet          # Who actually served it
X-Prism-Fallback-Used: true                        # Did we fail over?
X-Prism-Fallback-Chain: openai→anthropic           # What was tried
X-Prism-Latency: 1847                              # Total ms
X-Prism-Latency-Upstream: 1623                     # Provider ms only
X-Prism-Latency-Pipeline: 224                      # Middleware overhead
X-Prism-Tokens-In: 1500                            # Input tokens
X-Prism-Tokens-Out: 892                            # Output tokens
X-Prism-Cost-USD: 0.00234                          # Estimated cost
X-Prism-Composition: thinking-wrapper(2 calls)     # Composition info
X-Prism-Cache: miss                                # Cache status
X-RateLimit-Remaining: 42
X-RateLimit-Reset: 1709912400
```

Clients can opt out of verbose headers:
```yaml
server:
  responseHeaders: minimal   # minimal | standard | verbose
```

---

## 2. Timeout Architecture

### The Timeout Budget

Every request gets a **timeout budget** — a total wall-clock allowance that's tracked and decremented as time is spent. This is critical for composed requests where 4 sequential AI calls could each take 30s.

```typescript
interface TimeoutBudget {
  totalMs: number;          // Original budget
  remainingMs: number;      // What's left (live, computed from startTime)
  startedAt: number;        // hrtime
  deadlineAt: number;       // Absolute deadline
  
  // Check methods
  hasTime(): boolean;
  remaining(): number;
  
  // Create sub-budgets for composed calls
  slice(maxMs?: number): TimeoutBudget;  // Child budget, capped by remaining
  
  // Abort signal (wired to AbortController)
  signal: AbortSignal;
}
```

### Timeout Layers

```yaml
timeouts:
  # Layer 1: Global request timeout (the outer wall)
  request: 120s              # Max time for the entire request lifecycle
  
  # Layer 2: Per-provider timeouts
  providers:
    openai:
      connect: 5s            # TCP connection timeout
      firstByte: 30s         # Time to first byte (TTFB)
      total: 60s             # Total response time
      stream:
        idleTimeout: 15s     # Max gap between SSE chunks
    anthropic:
      connect: 5s
      firstByte: 45s         # Anthropic thinking can be slow
      total: 90s
    mercury-2:
      connect: 3s
      firstByte: 5s          # Mercury is fast
      total: 15s
    local:
      connect: 1s
      firstByte: 60s         # Ollama on a Pi might be slow
      total: 300s
  
  # Layer 3: Per-middleware timeouts
  middleware:
    default: 10s             # Any single middleware step
    overrides:
      pii-scrubber: 5s
      cache-lookup: 2s
  
  # Layer 4: Per-composition-step timeouts
  compose:
    perStep: 60s             # Each step in a chain
    perFork: 45s             # Each fork in fork-join
    merge: 15s               # The merge/judge step
```

### Custom Timeouts in User Functions

```typescript
// middleware/my-enricher.ts
export default defineMiddleware({
  name: 'my-enricher',
  
  // Declare your timeout needs
  timeout: 8000,              // Request 8s max for this middleware
  
  async execute(ctx, next) {
    // ctx.timeout is your scoped budget
    console.log(ctx.timeout.remaining());  // e.g., 45000ms left
    
    // Make an external call with timeout awareness
    const data = await fetch('https://my-api.com/enrich', {
      signal: ctx.timeout.signal,          // Auto-aborts if budget exhausted
      headers: { 'X-Timeout': String(ctx.timeout.remaining()) }
    });
    
    // Or create a sub-budget for a specific operation
    const subBudget = ctx.timeout.slice(3000);  // Max 3s, or whatever's left
    const result = await expensiveOperation({ signal: subBudget.signal });
    
    // For composed calls, the budget carries through
    const thinking = await ctx.call('anthropic/claude-sonnet', {
      messages: [...],
      timeout: ctx.timeout.slice(30000),   // 30s for this call
    });
    
    await next();
  }
});
```

### Timeout in Composition

For a 4-agent composed request, the budget splits:

```
Total budget: 120s
│
├── Step 1: Thinking model (Claude Sonnet)
│   Budget: min(60s, remaining)
│   Actual: 12s
│   Remaining: 108s
│
├── Step 2: Generator (Mercury-2)
│   Budget: min(15s, remaining)
│   Actual: 3s
│   Remaining: 105s
│
├── Step 3: Reviewer (GPT-4o) ← TIMED OUT at 60s
│   Budget: min(60s, remaining)
│   Actual: 60s (timeout!)
│   Remaining: 45s
│   → Fallback: try Claude Haiku (fast reviewer)
│   Actual: 4s
│   Remaining: 41s
│
├── Step 4: Formatter (local Ollama)
│   Budget: min(30s, remaining)
│   Actual: 8s
│   Remaining: 33s
│
└── Total: 87s, within 120s budget ✓
```

### Timeout Configuration Per-Route

```yaml
routes:
  /v1/fast:
    timeout: 15s                # Quick route, fail fast
    provider: mercury-2
    fallback: [claude-haiku]
  
  /v1/deep-analysis:
    timeout: 300s               # Long-running analysis
    compose:
      type: chain
      timeout:
        perStep: 90s            # Override per-step for this route
      steps:
        - provider: claude-sonnet
          timeout: 120s         # This step gets extra time
        - provider: gpt-4o
```

---

## 3. Error Handling & Recovery

### Error Taxonomy

Every error from a provider is classified into an actionable category:

```typescript
enum ErrorClass {
  // Retryable (same provider)
  RATE_LIMITED = 'rate_limited',         // 429 — retry after delay
  SERVER_ERROR = 'server_error',         // 500/502/503 — retry with backoff
  TIMEOUT = 'timeout',                   // No response in time — retry or fallback
  OVERLOADED = 'overloaded',            // 529 (Anthropic) — retry after delay
  
  // Fallback (different provider)
  MODEL_NOT_FOUND = 'model_not_found',   // Model doesn't exist on this provider
  CONTEXT_TOO_LONG = 'context_too_long', // Input exceeds model context window
  CONTENT_FILTERED = 'content_filtered', // Provider refused (safety filter)
  REGION_BLOCKED = 'region_blocked',     // Geo-restriction
  QUOTA_EXCEEDED = 'quota_exceeded',     // Account-level quota hit
  
  // Fatal (return to client)
  AUTH_FAILED = 'auth_failed',           // Bad API key
  INVALID_REQUEST = 'invalid_request',   // Malformed request
  BUDGET_EXCEEDED = 'budget_exceeded',   // Prism-level spend limit hit
  
  // Unknown
  UNKNOWN = 'unknown',                   // Unclassifiable — treat as retryable once
}
```

### Decision Tree: What Happens on Error

```
Provider returns error
    │
    ├── Classify error (ErrorClass)
    │
    ├── Is it RATE_LIMITED (429)?
    │   │
    │   ├── Has Retry-After header?
    │   │   ├── Yes → Wait that long (if within timeout budget)
    │   │   └── No  → Use exponential backoff
    │   │
    │   ├── Within retry attempts?
    │   │   ├── Yes → Retry same provider (maybe different IP)
    │   │   └── No  → Move to fallback chain
    │   │
    │   └── Provider returned rate limit reset time?
    │       └── Update rate limiter state (don't send more until reset)
    │
    ├── Is it TIMEOUT?
    │   │
    │   ├── Was it a connect timeout?
    │   │   └── Provider is down → Circuit breaker increment → Fallback
    │   │
    │   ├── Was it a first-byte timeout?
    │   │   └── Provider is slow → Try once more OR fallback
    │   │
    │   ├── Was it a stream idle timeout (SSE gap)?
    │   │   ├── We have partial response?
    │   │   │   ├── Enough to be useful → Return partial + header X-Prism-Partial: true
    │   │   │   └── Not enough → Fallback with retry
    │   │   └── No partial → Fallback
    │   │
    │   └── Was it the global timeout budget?
    │       └── No more time → Return 504 with what we have (if anything)
    │
    ├── Is it CONTEXT_TOO_LONG?
    │   │
    │   ├── Fallback has larger context window?
    │   │   └── Yes → Route to that provider
    │   │
    │   └── No provider can handle it?
    │       └── Return 413 with context window info for each tried provider
    │
    ├── Is it SERVER_ERROR (500/502/503)?
    │   │
    │   ├── Retry with backoff (up to N times)
    │   ├── Try different IP (if multi-IP egress)
    │   └── Then fallback chain
    │
    ├── Is it CONTENT_FILTERED?
    │   │
    │   ├── config.onContentFilter: 'fallback' | 'return' | 'retry-with-transform'
    │   ├── fallback → try next provider (different safety thresholds)
    │   ├── return → 451 to client with filter info
    │   └── retry-with-transform → run content-softener middleware, retry
    │
    └── Is it FATAL (auth, invalid request, budget)?
        └── Return error to client immediately (no retry, no fallback)
```

### Error Handling in Composed Requests

When one step in a 4-agent chain fails:

```typescript
// What the composition engine does internally
async function executeChain(steps: Step[], ctx: PipelineContext): Promise<void> {
  const results: StepResult[] = [];
  
  for (const step of steps) {
    try {
      const budget = ctx.timeout.slice(step.timeout);
      const result = await executeWithFallback(step, ctx, budget);
      results.push({ step: step.name, result, status: 'success' });
      
      // Wire output → next input
      ctx.request = step.outputTransform 
        ? step.outputTransform(result, ctx.request)
        : defaultWireNext(result, ctx.request);
        
    } catch (error) {
      const classified = classifyError(error);
      
      // Step-level error policy
      switch (step.onError ?? ctx.config.compose.defaultOnError) {
        case 'fail':
          // Whole composition fails
          throw new CompositionError(
            `Step "${step.name}" failed: ${classified.message}`,
            { completedSteps: results, failedStep: step.name, error: classified }
          );
          
        case 'skip':
          // Skip this step, continue with previous output
          results.push({ step: step.name, status: 'skipped', reason: classified });
          ctx.log.warn(`Step "${step.name}" skipped: ${classified.message}`);
          continue;
          
        case 'default':
          // Use a static default response for this step
          results.push({ step: step.name, status: 'defaulted', result: step.defaultResponse });
          ctx.request = defaultWireNext(step.defaultResponse, ctx.request);
          continue;
          
        case 'partial':
          // Return what we have so far
          ctx.response = buildPartialResponse(results);
          ctx.response.headers['X-Prism-Partial'] = 'true';
          ctx.response.headers['X-Prism-Failed-Step'] = step.name;
          return;
      }
    }
  }
  
  ctx.response = buildFinalResponse(results);
}
```

### Config for Error Behavior

```yaml
errors:
  # What to return to clients
  format: structured          # structured | passthrough | minimal
  includeProviderError: false # Don't leak upstream error details by default
  includeDebugInfo: ${DEBUG}  # Only in dev
  
  # Retry behavior
  retry:
    maxAttempts: 3
    backoff:
      type: exponential       # linear | exponential | jitter
      baseMs: 1000
      maxMs: 30000
      jitter: 0.2             # ±20% randomization
    retryOnTimeout: true
    retryOnServerError: true
    switchIpOnRetry: true     # Try a different egress IP
  
  # Fallback behavior  
  fallback:
    enabled: true
    maxProviders: 3           # Try at most 3 providers
    preserveModel: false      # Allow model substitution (e.g., gpt-4o → claude-sonnet)
    modelMapping:             # Explicit model equivalences for fallback
      "gpt-4o": "claude-sonnet-4-5"
      "claude-sonnet": "gpt-4o"
      "gpt-4o-mini": "claude-haiku"
  
  # Composition error handling
  compose:
    defaultOnError: fail      # fail | skip | default | partial
    perStep:
      thinking:
        onError: skip         # If thinking step fails, skip it
      reviewer:
        onError: default
        defaultResponse:
          content: "Review unavailable — proceeding without review."

  # Partial responses
  partial:
    enabled: true
    minUsefulTokens: 50       # Don't return partials shorter than this
    streamOnPartial: true     # If streaming, flush what we have
```

### Client-Visible Error Response

```json
{
  "error": {
    "type": "composition_partial_failure",
    "message": "Request completed partially: step 'reviewer' failed after timeout",
    "code": "COMPOSITION_STEP_TIMEOUT",
    "request_id": "01JQXYZ...",
    "composition": {
      "total_steps": 4,
      "completed_steps": 3,
      "failed_step": "reviewer",
      "steps": [
        { "name": "thinker", "provider": "anthropic/claude-sonnet", "status": "success", "latency_ms": 12400 },
        { "name": "generator", "provider": "inceptionlabs/mercury-2", "status": "success", "latency_ms": 3200 },
        { "name": "reviewer", "provider": "openai/gpt-4o", "status": "timeout", "latency_ms": 60000 },
        { "name": "formatter", "provider": null, "status": "skipped" }
      ]
    },
    "retry_advice": {
      "retryable": true,
      "suggested_wait_ms": 5000,
      "suggestion": "The reviewer step timed out. Consider increasing route timeout or switching to a faster reviewer model."
    }
  }
}
```

---

## 4. Data Transformations

### The Problem

Every AI provider has a different request/response shape. When you compose agents across providers, you need to convert between them seamlessly.

### Request Format Differences (Real Examples)

```typescript
// OpenAI format
{
  model: "gpt-4o",
  messages: [
    { role: "system", content: "You are helpful" },
    { role: "user", content: "Hello" }
  ],
  temperature: 0.7,
  max_tokens: 1000,
  stream: true
}

// Anthropic format
{
  model: "claude-sonnet-4-5-20250514",
  system: "You are helpful",                    // System is top-level, not in messages!
  messages: [
    { role: "user", content: "Hello" }
  ],
  temperature: 0.7,
  max_tokens: 1000,                             // Required (not optional like OpenAI)
  stream: true
}

// Google Gemini format
{
  contents: [                                     // "contents" not "messages"
    { role: "user", parts: [{ text: "Hello" }] } // "parts" with "text", not "content"
  ],
  systemInstruction: {                            // Yet another system prompt location
    parts: [{ text: "You are helpful" }]
  },
  generationConfig: {                             // Nested config object
    temperature: 0.7,
    maxOutputTokens: 1000                         // Different field name!
  }
}

// Ollama format
{
  model: "llama3",
  messages: [                                     // Similar to OpenAI but...
    { role: "system", content: "You are helpful" },
    { role: "user", content: "Hello" }
  ],
  options: {                                      // Params nested in "options"
    temperature: 0.7,
    num_predict: 1000                             // Different field name!
  },
  stream: true
}
```

### Response Format Differences

```typescript
// OpenAI response
{
  id: "chatcmpl-abc123",
  object: "chat.completion",
  choices: [{
    index: 0,
    message: { role: "assistant", content: "Hi there!" },
    finish_reason: "stop"
  }],
  usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 }
}

// Anthropic response
{
  id: "msg_abc123",
  type: "message",
  role: "assistant",
  content: [{ type: "text", text: "Hi there!" }],  // Array of content blocks!
  stop_reason: "end_turn",                           // Different field name
  usage: { input_tokens: 12, output_tokens: 8 }     // Different field names
}

// Gemini response
{
  candidates: [{
    content: { parts: [{ text: "Hi there!" }], role: "model" },  // "model" not "assistant"
    finishReason: "STOP",                                         // SCREAMING_CASE
  }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 8 } // camelCase everything
}
```

### The Transform Engine

```typescript
// Canonical internal format — all transforms go through this
interface CanonicalRequest {
  model: string;
  systemPrompt?: string;
  messages: CanonicalMessage[];
  params: {
    temperature?: number;
    maxOutputTokens?: number;
    topP?: number;
    topK?: number;
    stop?: string[];
    stream?: boolean;
    tools?: CanonicalTool[];
    responseFormat?: ResponseFormat;
  };
  // Provider-specific passthrough (for features only one provider has)
  providerExtensions?: Record<string, unknown>;
}

interface CanonicalMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: ContentBlock[];    // Always normalized to blocks
  toolCalls?: ToolCall[];
  toolCallId?: string;
  metadata?: Record<string, unknown>;
}

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: ImageSource }
  | { type: 'file'; source: FileSource }
  | { type: 'thinking'; text: string; budget?: string }  // Thinking blocks
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: ContentBlock[] };

interface CanonicalResponse {
  id: string;
  content: ContentBlock[];
  stopReason: 'stop' | 'max_tokens' | 'tool_use' | 'content_filter' | 'error';
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    thinkingTokens?: number;    // For extended thinking
  };
  model: string;                 // Actual model used (might differ from requested)
  provider: string;
  latencyMs: number;
}
```

### Transform Registry

```typescript
// Each provider has a bidirectional transformer
interface ProviderTransformer {
  name: string;
  
  // Inbound: provider format → canonical
  toCanonical(raw: unknown): CanonicalRequest;
  responseToCanonical(raw: unknown): CanonicalResponse;
  
  // Outbound: canonical → provider format
  fromCanonical(canonical: CanonicalRequest): unknown;
  responseFromCanonical(canonical: CanonicalResponse): unknown;
  
  // Streaming
  streamChunkToCanonical(chunk: unknown): CanonicalStreamChunk;
  streamChunkFromCanonical(chunk: CanonicalStreamChunk): unknown;
  
  // Feature support declaration
  capabilities: {
    vision: boolean;
    tools: boolean;
    thinking: boolean;
    caching: boolean;
    streaming: boolean;
    multimodal: ('image' | 'audio' | 'video' | 'file')[];
    maxContextTokens: number;
    systemPromptLocation: 'messages' | 'top-level' | 'instruction';
  };
}
```

### How Transforms Work in Composition

A 4-agent chain across different providers:

```
Step 1: Claude Sonnet (Anthropic)
  Input:  Client sent OpenAI format
          → toCanonical(openai, request)         [OpenAI → Canonical]
          → fromCanonical(anthropic, canonical)  [Canonical → Anthropic]
  Output: Anthropic response
          → responseToCanonical(anthropic, resp) [Anthropic → Canonical]
                    │
                    ▼
Step 2: Mercury-2 (Inception)
  Input:  Previous canonical output → wire into new canonical request
          → fromCanonical(inception, canonical)  [Canonical → Inception format]
  Output: Inception response
          → responseToCanonical(inception, resp)
                    │
                    ▼
Step 3: GPT-4o (OpenAI)
  Input:  Previous canonical output → fromCanonical(openai, canonical)
  Output: → responseToCanonical(openai, resp)
                    │
                    ▼
Step 4: Ollama (local)
  Input:  → fromCanonical(ollama, canonical)
  Output: → responseToCanonical(ollama, resp)
                    │
                    ▼
Final:   → responseFromCanonical(openai, resp)   [Canonical → OpenAI for client]
         (client requested OpenAI format, so we respond in OpenAI format)
```

### Model-to-Model Wiring (The Tricky Part)

When chaining models, how does output become input? The composition config defines this:

```yaml
routes:
  /v1/deep-chain:
    compose:
      type: chain
      # What format does the CLIENT speak? Responses go back in this format.
      clientFormat: openai
      
      steps:
        - name: thinker
          provider: anthropic/claude-sonnet
          # How to build this step's input from the original request
          inputTransform:
            type: inject-system
            systemPrompt: "Think step by step about this problem."
          # No outputTransform = raw content passes to next step
          
        - name: generator
          provider: inception/mercury-2
          inputTransform:
            type: template
            # Reference previous step outputs with {{steps.NAME.content}}
            userMessage: |
              Based on this analysis:
              <thinking>
              {{steps.thinker.content}}
              </thinking>
              
              Now generate a response to: {{original.lastUserMessage}}
          
        - name: reviewer
          provider: openai/gpt-4o
          inputTransform:
            type: template
            systemPrompt: "You are a code reviewer. Check for bugs and improvements."
            userMessage: |
              Review this code:
              {{steps.generator.content}}
          outputTransform:
            type: merge
            template: |
              {{steps.generator.content}}
              
              ---
              **Review Notes:**
              {{steps.reviewer.content}}
          
        - name: formatter
          provider: local/ollama
          inputTransform:
            type: template
            systemPrompt: "Format this as clean markdown."
            userMessage: "{{previous.content}}"
```

### Custom Transform Functions

```typescript
// transforms/my-transform.ts
import { defineTransform } from 'prism-pipe';

export default defineTransform({
  name: 'add-rag-context',
  
  async transform(ctx: TransformContext): Promise<CanonicalRequest> {
    const { request, previous, original, store, log } = ctx;
    
    // Fetch context from your vector DB
    const query = original.lastUserMessage;
    const docs = await fetchRelevantDocs(query);
    
    // Inject as system context
    return {
      ...request,
      systemPrompt: `${request.systemPrompt}\n\nRelevant context:\n${docs.map(d => d.text).join('\n')}`,
    };
  }
});
```

### Handling Feature Gaps Between Providers

What if the client sends tool calls but the fallback provider doesn't support tools?

```typescript
// The transform engine handles this automatically
function fromCanonical(provider: string, canonical: CanonicalRequest): unknown {
  const transformer = getTransformer(provider);
  const capabilities = transformer.capabilities;
  
  // Feature degradation
  if (canonical.params.tools && !capabilities.tools) {
    // Convert tool definitions to system prompt instructions
    canonical.systemPrompt += formatToolsAsSystemPrompt(canonical.params.tools);
    delete canonical.params.tools;
    
    // Emit warning
    ctx.log.warn('Provider does not support native tools, falling back to prompt-based tools', {
      provider,
      toolCount: canonical.params.tools.length
    });
  }
  
  if (canonical.messages.some(m => m.content.some(c => c.type === 'image')) && !capabilities.vision) {
    // Remove images, add text description if available
    ctx.log.warn('Provider does not support vision, images removed', { provider });
  }
  
  if (canonical.params.thinking && !capabilities.thinking) {
    // Can't do native thinking — add thinking-prompt wrapper
    canonical.systemPrompt = `Think through your response step by step in <thinking> tags before answering.\n\n${canonical.systemPrompt}`;
  }
  
  return transformer.fromCanonical(canonical);
}
```

---

## 5. Cost Accounting

### The Cost Model

Every AI call has a cost. For composed requests, costs accumulate across steps.

```typescript
interface CostEntry {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  thinkingTokens?: number;
  
  // Pricing (resolved at call time)
  pricing: {
    inputPerMillion: number;      // $/M input tokens
    outputPerMillion: number;     // $/M output tokens
    cacheReadPerMillion?: number;
    cacheWritePerMillion?: number;
    thinkingPerMillion?: number;  // Extended thinking pricing
  };
  
  // Calculated
  costUSD: number;
  
  // For flat-rate / subscription models
  pricingModel: 'per-token' | 'flat-rate' | 'unknown';
  flatRateNote?: string;          // e.g., "Claude Max subscription"
}

interface RequestCost {
  steps: CostEntry[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUSD: number;
  hasFlatRateComponents: boolean;
  flatRateNote?: string;
}
```

### Pricing Database

Built-in, auto-updated pricing:

```yaml
# Built into prism-pipe, overridable in config
pricing:
  autoUpdate: true              # Fetch latest from pricing API weekly
  source: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
  
  overrides:
    # Manual overrides or custom models
    "anthropic/claude-sonnet-4-5":
      input: 3.00               # $/M tokens
      output: 15.00
      cacheRead: 0.30
      cacheWrite: 3.75
      thinking: 15.00           # Thinking tokens priced same as output
    
    "openai/gpt-4o":
      input: 2.50
      output: 10.00
    
    "inceptionlabs/mercury-2":
      input: 0.00               # Free during beta? Or priced differently
      output: 0.00
      note: "Pricing TBD"
    
    # Flat rate / subscription models
    "anthropic/claude-code-max":
      pricingModel: flat-rate
      note: "Claude Max subscription ($200/mo). No per-token cost."
      estimatedInputPerMillion: 0.00    # For cost comparison purposes
      estimatedOutputPerMillion: 0.00
      monthlyRate: 200.00
      # Track tokens for usage metrics even if cost is $0
      trackTokens: true
```

### Example: 4-Agent Composed Request Cost

Let's trace a real scenario: **thinking-enhanced creative writing with review**.

Route config:
```yaml
routes:
  /v1/deep-creative:
    compose:
      type: chain
      steps:
        - name: planner
          provider: anthropic/claude-sonnet-4-5
          config:
            thinking: { budget: 10000 }    # Extended thinking
        - name: writer
          provider: anthropic/claude-code-max    # Claude Max subscription
        - name: critic
          provider: openai/gpt-4o
        - name: polisher
          provider: inceptionlabs/mercury-2
```

The user sends a 2,000-token prompt. Here's what happens:

```
┌──────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Planner (Claude Sonnet 4.5 with Extended Thinking)             │
│                                                                          │
│  Input tokens:    2,000 (original prompt)                                │
│  Thinking tokens: 8,500 (internal reasoning)                             │
│  Output tokens:   1,200 (structured plan)                                │
│                                                                          │
│  Pricing:                                                                │
│    Input:    2,000 × $3.00/M  = $0.006000                                │
│    Thinking: 8,500 × $15.00/M = $0.127500                               │
│    Output:   1,200 × $15.00/M = $0.018000                                │
│                                                                          │
│  Step cost: $0.151500                                                    │
├──────────────────────────────────────────────────────────────────────────┤
│  STEP 2: Writer (Claude Max — flat rate subscription)                    │
│                                                                          │
│  Input tokens:    3,200 (original prompt + plan from step 1)             │
│  Output tokens:   4,500 (creative writing output)                        │
│                                                                          │
│  Pricing: FLAT RATE (Claude Max $200/mo subscription)                    │
│    Input:    3,200 × $0.00/M  = $0.000000                                │
│    Output:   4,500 × $0.00/M  = $0.000000                                │
│                                                                          │
│  Step cost: $0.000000 (subscription)                                     │
│  ⚠ Note: Tokens tracked for usage metrics, not billed per-token         │
├──────────────────────────────────────────────────────────────────────────┤
│  STEP 3: Critic (GPT-4o)                                                 │
│                                                                          │
│  Input tokens:    5,700 (writing output + "review this" prompt)          │
│  Output tokens:     800 (review notes)                                   │
│                                                                          │
│  Pricing:                                                                │
│    Input:    5,700 × $2.50/M  = $0.014250                                │
│    Output:     800 × $10.00/M = $0.008000                                │
│                                                                          │
│  Step cost: $0.022250                                                    │
├──────────────────────────────────────────────────────────────────────────┤
│  STEP 4: Polisher (Mercury-2)                                            │
│                                                                          │
│  Input tokens:    5,500 (writing + review notes)                         │
│  Output tokens:   4,800 (final polished output)                          │
│                                                                          │
│  Pricing: $0.00 (free beta / TBD)                                        │
│    Input:    5,500 × $0.00/M  = $0.000000                                │
│    Output:   4,800 × $0.00/M  = $0.000000                                │
│                                                                          │
│  Step cost: $0.000000                                                    │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════  │
│  TOTAL REQUEST SUMMARY                                                   │
│  ═══════════════════════════════════════════════════════════════════════  │
│                                                                          │
│  Total input tokens:    16,400                                           │
│  Total thinking tokens:  8,500                                           │
│  Total output tokens:   11,300                                           │
│  Total tokens:          36,200                                           │
│                                                                          │
│  Per-token cost:   $0.173750                                             │
│  Flat-rate cost:   $0.000000 (covered by Claude Max subscription)        │
│  ─────────────────────────────────                                       │
│  Total cost:       $0.173750                                             │
│                                                                          │
│  ⚠ Note: Step 2 used 7,700 tokens under Claude Max subscription.        │
│    If billed per-token at standard Claude rates, this would have been    │
│    an additional $0.077100 ($3/M in + $15/M out).                        │
│    Monthly subscription amortization: $200/mo ÷ estimated monthly        │
│    tokens = effective per-token rate for comparison.                      │
│                                                                          │
│  Latency: 14.2s total (12.4s + 3.1s + 4.8s + 2.1s, overlap: 8.2s)     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Cost Response Headers

```http
X-Prism-Cost-USD: 0.173750
X-Prism-Cost-Breakdown: planner:0.151500,writer:0.000000(flat),critic:0.022250,polisher:0.000000
X-Prism-Tokens-Total: 36200
X-Prism-Tokens-In: 16400
X-Prism-Tokens-Out: 11300
X-Prism-Tokens-Thinking: 8500
X-Prism-Has-Flat-Rate: true
```

### Cost Tracking & Budgets

```yaml
costs:
  tracking:
    enabled: true
    granularity: per-request     # per-request | per-minute | per-hour
    store: true                  # Persist to store for querying
  
  budgets:
    global:
      daily: 50.00              # $50/day across all tenants
      monthly: 1000.00
      alert:
        at: [50%, 80%, 95%]     # Alert at these thresholds
        handler: webhook
        url: https://hooks.slack.com/...
    
    perTenant:
      default:
        daily: 10.00
        monthly: 200.00
      overrides:
        "team-ml":
          daily: 100.00
          monthly: 2000.00
    
    perModel:
      "gpt-4o":
        daily: 20.00            # Cap expensive model usage
  
  flatRate:
    # Track subscription utilization
    "claude-max":
      monthlyRate: 200.00
      trackUtilization: true     # Report: "You used 450K tokens on Claude Max, 
                                 #   equivalent to $X at standard rates"
    
  # Admin endpoint: GET /admin/costs?range=7d&groupBy=tenant
  adminApi: true
```

### Cost in Custom Middleware

```typescript
export default defineMiddleware({
  name: 'cost-guard',
  async execute(ctx, next) {
    await next();
    
    // After the pipeline completes, check cost
    const cost = ctx.response?.cost;
    if (cost && cost.totalCostUSD > 1.00) {
      ctx.log.warn('Expensive request', { 
        cost: cost.totalCostUSD, 
        tenant: ctx.tenant?.name,
        steps: cost.steps.map(s => `${s.provider}: $${s.costUSD}`)
      });
      ctx.metrics.counter('prism.expensive_requests_total', 1);
    }
  }
});
```

---

## Open Questions / Decisions Needed

1. **Client SDK?** — Should we ship a JS/Python client that wraps the proxy with type-safe composition helpers? Or is it purely an HTTP proxy that any OpenAI SDK can talk to?

2. **Streaming in composition** — For a 4-step chain, do we stream step 4's output to the client while steps 1-3 are buffered? Or buffer everything and stream the final output? Current design: buffer intermediate, stream final.

3. **WebSocket support** — Some providers (Gemini) use WebSockets for real-time. Do we proxy those or only HTTP/SSE?

4. **Plugin marketplace** — Should there be a registry for community middleware/transforms? Or just npm packages?

5. **Claude Max / flat-rate amortization** — How to fairly attribute flat-rate subscription costs in multi-tenant setups? Options: (a) $0 per request, (b) amortized by usage share, (c) configurable per tenant.

6. **Composition DSL** — Is YAML enough for defining complex compositions, or do we need a visual builder / graph editor?
