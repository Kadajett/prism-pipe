# Prism Pipe — Architecture v2

> Pluggable AI proxy: middleware pipelines, agent composition, multi-platform deployment, configurable everything.

---

## Table of Contents

- [Philosophy](#philosophy)
- [Deployment Targets](#deployment-targets)
- [Core Concepts](#core-concepts)
- [Middleware Pipeline](#middleware-pipeline)
- [Agent Composition](#agent-composition)
- [Logging & Observability](#logging--observability)
- [Storage Backend](#storage-backend)
- [Rate Limiting](#rate-limiting)
- [Fallbacks & Circuit Breakers](#fallbacks--circuit-breakers)
- [Multi-IP Egress](#multi-ip-egress)
- [Plugin System](#plugin-system)
- [Configuration](#configuration)
- [Directory Structure](#directory-structure)
- [Platform Rollout Plan](#platform-rollout-plan)
- [Phase Plan](#phase-plan)

---

## Philosophy

1. **Sane defaults, zero config to start** — `npx prism-pipe` should work
2. **Everything is pluggable** — Storage, logging, metrics, transports, middleware
3. **Runs anywhere** — Laptop, Pi, Docker, K8s, Lambda, Cloudflare Workers
4. **Pipeline-first** — Requests flow through composable middleware, not just passthrough
5. **No vendor lock-in** — Swap any component without touching core

---

## Deployment Targets

| Platform | Runtime | Notes |
|---|---|---|
| Local (macOS/Linux/Win) | Node.js | `npx prism-pipe` or global install |
| systemd | Node.js | Ships with `.service` file, `prism-pipe install` generates it |
| Docker | Node.js | Multi-arch image (amd64, arm64 for Pi) |
| Kubernetes | Node.js | Helm chart, HPA on request latency/queue depth |
| Raspberry Pi | Node.js | ARM64 Docker or bare metal, SQLite default |
| AWS Lambda | Custom runtime | Adapter strips worker_threads, single-request mode |
| Cloudflare Workers | Workerd | Separate entry point, no fs/sqlite (uses KV/D1) |
| GitHub Actions | Node.js | Sidecar mode, logs to artifacts |

### Compatibility Strategy

```
src/
  runtime/
    node.ts            # Full runtime: worker_threads, SQLite, fs
    edge.ts            # Edge runtime: no threads, KV-backed, fetch-only
    lambda.ts          # Lambda adapter: single-invocation, no long-lived pool
    detect.ts          # Auto-detect runtime capabilities
```

The core pipeline is **runtime-agnostic** — it uses interfaces for storage, logging, and HTTP. Runtime adapters wire in the appropriate implementations:

- `node` → worker_threads, SQLite, Pino, fs config
- `edge` → single-threaded, KV store, console structured logs, env config  
- `lambda` → single-shot, DynamoDB or S3 for state, CloudWatch logs

A `capabilities` object is injected at startup:

```typescript
interface RuntimeCapabilities {
  threads: boolean;          // Can use worker_threads?
  filesystem: boolean;       // Can read/write local files?
  persistentProcess: boolean; // Long-lived or per-request?
  nativeNetBinding: boolean; // Can bind to specific local IPs?
  storage: 'sqlite' | 'kv' | 'dynamo' | 'memory';
}
```

---

## Core Concepts

### The Request Lifecycle

```
Inbound Request
    │
    ▼
┌──────────────────┐
│  Ingress Layer    │  Auth, rate limit check, request validation
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Pipeline        │  Ordered middleware chain (transform, enrich, fork, compose)
│  ┌─────────────┐ │
│  │ Middleware 1 │ │  e.g., Add system prompt
│  │ Middleware 2 │ │  e.g., Transform to Anthropic format
│  │ Middleware 3 │ │  e.g., Fork: send to thinking model + fast model
│  │ Middleware N │ │  e.g., Merge outputs
│  └─────────────┘ │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Egress Layer     │  Provider selection, IP rotation, retry, fallback
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Response Layer   │  Output transforms, logging, metrics emission
└──────────────────┘
```

---

## Middleware Pipeline

This is the n8n-style composability layer. Middleware are functions that can inspect, transform, fork, or short-circuit requests.

### Middleware Interface

```typescript
interface PipelineContext {
  request: ProxyRequest;           // Inbound request (mutable)
  response?: ProxyResponse;        // Set after upstream call
  metadata: Record<string, any>;   // Shared state across middleware
  log: ScopedLogger;               // Scoped to this request
  metrics: MetricsEmitter;         // Emit custom metrics
  config: ResolvedConfig;          // Current config snapshot
  fork: (requests: ProxyRequest[]) => Promise<ProxyResponse[]>;  // Fan-out
}

type Middleware = (
  ctx: PipelineContext,
  next: () => Promise<void>
) => Promise<void>;
```

### Built-in Middleware

| Middleware | What it does |
|---|---|
| `transform-format` | Convert between OpenAI ↔ Anthropic ↔ Google request/response shapes |
| `inject-system` | Prepend/append system prompts |
| `strip-fields` | Remove fields before forwarding (e.g., strip `metadata` that upstream doesn't understand) |
| `add-thinking` | Wrap a non-thinking model with a thinking model pre-pass |
| `cache` | Response caching with configurable key derivation |
| `guard` | Content filtering / PII detection before forwarding |
| `retry` | Retry with backoff (can also be in egress layer) |
| `log-request` | Detailed request/response logging |

### Custom Middleware

Users drop `.ts` or `.js` files in a `middleware/` directory or reference npm packages:

```yaml
pipeline:
  - name: my-custom-enricher
    path: ./middleware/enrich.ts      # Local file
  - name: transform-format
    config:                            # Built-in with config
      from: openai
      to: anthropic
  - name: "@myorg/pii-scrubber"       # npm package
    config:
      strict: true
```

---

## Agent Composition

The killer feature: combine multiple AI calls into a single logical request.

### Composition Patterns

#### 1. Chain (Sequential)
Run model A, feed output to model B.

```yaml
routes:
  /v1/smart-complete:
    compose:
      type: chain
      steps:
        - provider: mercury-2
          role: generator
        - provider: claude-sonnet
          role: reviewer
          inject: "Review this output for accuracy: {{previous.content}}"
```

#### 2. Fork-Join (Parallel + Merge)
Send to multiple models, merge outputs.

```yaml
routes:
  /v1/consensus:
    compose:
      type: fork-join
      providers:
        - openai/gpt-4o
        - anthropic/claude-sonnet
        - google/gemini-pro
      merge: best-of       # best-of | concatenate | vote | custom
      mergeModel: claude-sonnet   # Model that picks the best
```

#### 3. Thinking Wrapper
Add thinking/reasoning to any model that doesn't have it natively.

```yaml
routes:
  /v1/mercury-thinking:
    compose:
      type: thinking-wrapper
      thinker:
        provider: claude-sonnet
        prompt: "Think through this step by step, then provide a final answer."
      executor:
        provider: mercury-2
        inject: "Based on this reasoning: {{thinker.content}}\n\nGenerate: {{original.prompt}}"
```

#### 4. Tool Router
Route tool calls to different backends based on the tool.

```yaml
routes:
  /v1/tool-augmented:
    compose:
      type: tool-router
      primary: claude-sonnet
      tools:
        code_execution:
          handler: ./tools/code-sandbox.ts
        web_search:
          provider: perplexity/sonar
        image_gen:
          provider: openai/dall-e-3
```

### Custom Composers

```typescript
// middleware/my-composer.ts
import { defineComposer } from 'prism-pipe';

export default defineComposer({
  name: 'debate',
  async execute(ctx, providers) {
    const [forResponse, againstResponse] = await ctx.fork([
      { ...ctx.request, systemPrompt: 'Argue FOR this position' },
      { ...ctx.request, systemPrompt: 'Argue AGAINST this position' },
    ]);
    
    // Use a judge model to synthesize
    const judgment = await ctx.call(providers.judge, {
      messages: [
        { role: 'user', content: `FOR: ${forResponse.content}\n\nAGAINST: ${againstResponse.content}\n\nSynthesize a balanced response.` }
      ]
    });
    
    ctx.response = judgment;
  }
});
```

---

## Logging & Observability

### Architecture

```
┌─────────────────────────────────────────────┐
│              LogManager                      │
│                                             │
│  ┌─────────┐  ┌──────────┐  ┌───────────┐  │
│  │ Emitter │──│ Router   │──│ Sinks     │  │
│  │         │  │          │  │           │  │
│  │ Events  │  │ Filter   │  │ • Console │  │
│  │ with    │  │ by level │  │ • JSONL   │  │
│  │ scoped  │  │ by ns    │  │ • Pino    │  │
│  │ ns      │  │ by tag   │  │ • Loki    │  │
│  └─────────┘  └──────────┘  │ • File    │  │
│                             │ • Custom  │  │
│                             └───────────┘  │
└─────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────┐
│            MetricsManager                    │
│                                             │
│  ┌───────────┐  ┌────────────────────────┐  │
│  │ Collector │──│ Exporters              │  │
│  │           │  │ • Prometheus (pull)    │  │
│  │ Counters  │  │ • OTLP (push)         │  │
│  │ Histos    │  │ • StatsD              │  │
│  │ Gauges    │  │ • Console             │  │
│  └───────────┘  │ • Custom              │  │
│                 └────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Event Namespacing

Every event has a namespace that users can remap:

```yaml
logging:
  namespaces:
    default: "prism"                    # Base namespace
    remap:
      "prism.request": "myapp.ai.req"  # Custom namespace
      "prism.ratelimit": "myapp.ai.rl"
    
  sinks:
    - type: console
      level: info
    - type: jsonl
      path: ./logs/prism.jsonl
      level: debug
    - type: loki
      url: http://loki:3100
      level: warn
      labels:
        app: prism-pipe
        env: ${ENV}
    - type: custom
      module: ./logging/my-sink.ts

metrics:
  enabled: true                        # Can be turned off entirely
  namespace: "prism"                   # Prefix for all metrics
  exporters:
    - type: prometheus
      port: 9090
      path: /metrics
    - type: otlp
      endpoint: http://otel-collector:4318
    - type: custom
      module: ./metrics/datadog.ts
  
  # Sane defaults, all overridable
  histogramBuckets:
    latency: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000]
    tokens: [10, 50, 100, 500, 1000, 5000, 10000]

alerts:
  - name: high-error-rate
    condition: "rate(prism_request_errors_total[5m]) > 0.1"
    handler: ./alerts/slack-notify.ts   # Custom alert handler
  - name: rate-limit-exhausted
    condition: "prism_ratelimit_remaining == 0"
    handler: webhook
    url: https://hooks.slack.com/...
```

### Logging in Custom Middleware/Composers

```typescript
// Users get a scoped logger automatically
export default defineMiddleware({
  name: 'my-thing',
  async execute(ctx, next) {
    ctx.log.info('starting transform', { model: ctx.request.model });
    ctx.log.debug('full request body', { body: ctx.request.body });
    
    // Emit custom metrics
    ctx.metrics.histogram('my_thing.transform_time', elapsed);
    ctx.metrics.counter('my_thing.transforms_total', 1, { status: 'success' });
    
    await next();
  }
});
```

### GitHub Actions / CI Mode

```yaml
# Auto-detected when GITHUB_ACTIONS=true, or set explicitly
logging:
  sinks:
    - type: github-artifacts
      artifactName: prism-pipe-logs
      retentionDays: 7
    - type: github-summary         # Writes to $GITHUB_STEP_SUMMARY
      includeMetrics: true
```

---

## Storage Backend

### Pluggable Store Interface

```typescript
interface Store {
  // Rate limit counters
  rateLimitGet(key: string): Promise<RateLimitEntry | null>;
  rateLimitSet(key: string, entry: RateLimitEntry, ttlMs: number): Promise<void>;
  
  // Request log
  logRequest(entry: RequestLogEntry): Promise<void>;
  queryLogs(filter: LogFilter): Promise<RequestLogEntry[]>;
  
  // Config (for distributed setups)
  configGet(key: string): Promise<string | null>;
  configSet(key: string, value: string): Promise<void>;
  
  // Cache (for response caching middleware)
  cacheGet(key: string): Promise<CachedResponse | null>;
  cacheSet(key: string, value: CachedResponse, ttlMs: number): Promise<void>;
  
  // Lifecycle
  init(): Promise<void>;
  close(): Promise<void>;
  migrate(): Promise<void>;
}
```

### Built-in Implementations

| Backend | Best for | Config |
|---|---|---|
| SQLite (default) | Local, single-node, Pi, CI | `store: { type: sqlite, path: ./prism.db }` |
| Memory | Testing, Cloudflare Workers | `store: { type: memory }` |
| Redis | Distributed, K8s multi-replica | `store: { type: redis, url: redis://... }` |
| DynamoDB | AWS Lambda | `store: { type: dynamodb, table: prism-pipe }` |
| Cloudflare KV/D1 | Workers | `store: { type: cloudflare, binding: PRISM_KV }` |
| Custom | Anything | `store: { type: custom, module: ./store/my-store.ts }` |

```yaml
store:
  type: sqlite                    # Default
  path: ./data/prism.db
  migrations: auto                # auto | manual | skip
  # OR
  type: redis
  url: ${REDIS_URL}
  prefix: "prism:"               # Key prefix (namespace)
```

---

## Rate Limiting

### Algorithms

| Algorithm | Use Case |
|---|---|
| Token bucket | Bursty workloads, smooth average |
| Sliding window | Strict enforcement, compliance |
| Fixed window | Simple, low overhead |
| Leaky bucket | Smooth output rate |

### Granularity Layers

Rate limits stack — a request must pass ALL applicable limits:

```yaml
rateLimits:
  global:
    algorithm: token-bucket
    capacity: 1000
    refillRate: 100/s
  
  perProvider:
    openai:
      capacity: 60
      refillRate: 1/s
    anthropic:
      capacity: 40
      refillRate: 0.67/s
  
  perApiKey:
    enabled: true
    default:
      capacity: 20
      refillRate: 0.33/s
    overrides:
      "sk-premium-key":
        capacity: 100
        refillRate: 5/s
  
  perModel:
    "gpt-4o":
      capacity: 10
      refillRate: 0.17/s
      tokenLimit: 100000/min    # Token-based limiting too
  
  perSourceIP:
    enabled: true
    capacity: 30
    refillRate: 0.5/s

  # Custom dimensions
  custom:
    - dimension: "request.headers.x-team-id"
      capacity: 50
      refillRate: 1/s
```

### Rate Limit Headers

Standard headers on every response:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1709912400
Retry-After: 30           # Only on 429s
```

---

## Fallbacks & Circuit Breakers

```yaml
fallbacks:
  chains:
    default:
      - openai/gpt-4o
      - anthropic/claude-sonnet
      - google/gemini-pro
      - local/ollama          # Self-hosted fallback
    
    fast:
      - mercury-2
      - openai/gpt-4o-mini
      - anthropic/claude-haiku
  
  circuitBreaker:
    failureThreshold: 5       # Trips after 5 consecutive failures
    resetTimeoutMs: 30000     # Try again after 30s
    halfOpenRequests: 2       # Test with 2 requests before fully opening
  
  retry:
    maxAttempts: 3
    backoff: exponential      # linear | exponential | fixed
    baseDelayMs: 1000
    maxDelayMs: 30000
    retryableStatuses: [429, 500, 502, 503, 504]
```

---

## Multi-IP Egress

```yaml
egress:
  ips:
    - address: 192.168.1.100
      weight: 2                # Gets 2x traffic
    - address: 192.168.1.101
      weight: 1
    - address: 192.168.1.102
      weight: 1
      providers: [openai]     # Only use for OpenAI
  
  strategy: weighted-round-robin   # round-robin | random | lru | weighted-round-robin | least-connections
  
  # External proxy support
  proxies:
    - url: socks5://proxy1:1080
    - url: http://proxy2:8080
      auth: ${PROXY_AUTH}
```

---

## Plugin System

Everything extensible through a unified plugin interface:

```typescript
interface Plugin {
  name: string;
  version: string;
  
  // Lifecycle hooks
  onInit?(ctx: PluginContext): Promise<void>;
  onShutdown?(ctx: PluginContext): Promise<void>;
  
  // Extension points
  middleware?: Middleware[];
  composers?: Composer[];
  stores?: StoreFactory[];
  logSinks?: LogSinkFactory[];
  metricsExporters?: MetricsExporterFactory[];
  alertHandlers?: AlertHandlerFactory[];
  authProviders?: AuthProviderFactory[];
  
  // CLI extensions
  commands?: CLICommand[];
  
  // Config schema extensions (merged with base)
  configSchema?: JSONSchema;
}

// Registration
export default definePlugin({
  name: 'prism-pipe-datadog',
  metricsExporters: [datadogExporter],
  logSinks: [datadogLogSink],
  configSchema: { /* extends config with datadog-specific fields */ }
});
```

### Plugin Loading

```yaml
plugins:
  - "@prism-pipe/plugin-datadog"        # npm package
  - "./plugins/my-company-plugin.ts"    # Local file
  - "@prism-pipe/plugin-auth-jwt"       # Auth via JWT
```

---

## Configuration

### Loading Priority

1. Built-in defaults
2. `prism-pipe.yaml` (or `.json`, `.toml`)
3. `PRISM_*` environment variables
4. CLI flags
5. Remote config (optional: etcd, Consul, AWS SSM)

### Config Hot-Reload

File watcher on config file — most changes apply without restart:
- Rate limits → immediate
- Middleware pipeline → graceful drain + reload
- Provider list → immediate
- Port/threading → requires restart (warned in logs)

### Minimal Config (Zero Config Start)

```bash
# Just works — proxies to whatever OPENAI_API_KEY points at
OPENAI_API_KEY=sk-... npx prism-pipe
```

### Full Config Example

```yaml
# prism-pipe.yaml
server:
  port: 3000
  host: 0.0.0.0
  workers: auto              # auto = CPU count

runtime:
  mode: auto                 # auto | node | edge | lambda

store:
  type: sqlite
  path: ./data/prism.db

providers:
  openai:
    baseUrl: https://api.openai.com
    apiKey: ${OPENAI_API_KEY}
  anthropic:
    baseUrl: https://api.anthropic.com
    apiKey: ${ANTHROPIC_API_KEY}
  mercury:
    baseUrl: https://api.inceptionlabs.ai
    apiKey: ${MERCURY_API_KEY}
  local:
    baseUrl: http://localhost:11434
    type: ollama

pipeline:
  - transform-format
  - log-request

routes:
  /v1/chat/completions:
    provider: openai
    fallback: [anthropic, local]
  
  /v1/smart:
    compose:
      type: thinking-wrapper
      thinker: { provider: anthropic }
      executor: { provider: mercury }

logging:
  level: info
  sinks:
    - type: console
    - type: jsonl
      path: ./logs/requests.jsonl

metrics:
  enabled: true
  exporters:
    - type: prometheus
```

---

## Directory Structure

```
prism-pipe/
├── src/
│   ├── index.ts                 # Entry point
│   ├── core/
│   │   ├── pipeline.ts          # Middleware pipeline engine
│   │   ├── composer.ts          # Agent composition engine
│   │   ├── context.ts           # PipelineContext
│   │   └── types.ts             # Core type definitions
│   ├── runtime/
│   │   ├── node.ts              # Node.js runtime (threads, sqlite)
│   │   ├── edge.ts              # Edge runtime (Workers, Lambda)
│   │   ├── lambda.ts            # AWS Lambda adapter
│   │   └── detect.ts            # Capability detection
│   ├── server/
│   │   ├── express.ts           # Express server setup
│   │   ├── router.ts            # Route → pipeline mapping
│   │   └── auth.ts              # Auth middleware
│   ├── proxy/
│   │   ├── provider.ts          # Provider registry
│   │   ├── egress.ts            # Outbound request execution
│   │   ├── stream.ts            # SSE streaming
│   │   └── transform.ts         # Format converters (OpenAI↔Anthropic↔Google)
│   ├── rate-limit/
│   │   ├── limiter.ts           # Limiter factory
│   │   ├── token-bucket.ts
│   │   ├── sliding-window.ts
│   │   └── fixed-window.ts
│   ├── fallback/
│   │   ├── chain.ts
│   │   ├── circuit-breaker.ts
│   │   └── health.ts
│   ├── network/
│   │   ├── ip-pool.ts
│   │   ├── agent-factory.ts
│   │   └── proxy-support.ts     # SOCKS5/HTTP proxy
│   ├── logging/
│   │   ├── manager.ts           # LogManager
│   │   ├── sinks/
│   │   │   ├── console.ts
│   │   │   ├── jsonl.ts
│   │   │   ├── pino.ts
│   │   │   ├── loki.ts
│   │   │   └── github.ts       # Artifacts + step summary
│   │   └── namespace.ts         # Event namespace remapping
│   ├── metrics/
│   │   ├── manager.ts           # MetricsManager
│   │   ├── exporters/
│   │   │   ├── prometheus.ts
│   │   │   ├── otlp.ts
│   │   │   └── statsd.ts
│   │   └── alerts.ts            # Alert rule engine
│   ├── store/
│   │   ├── interface.ts         # Store interface
│   │   ├── sqlite.ts
│   │   ├── memory.ts
│   │   ├── redis.ts
│   │   └── dynamodb.ts
│   ├── config/
│   │   ├── loader.ts            # Multi-source config loading
│   │   ├── schema.ts            # JSON Schema validation
│   │   ├── hot-reload.ts        # File watcher
│   │   └── defaults.ts          # Built-in defaults
│   ├── plugin/
│   │   ├── loader.ts            # Plugin discovery + loading
│   │   ├── interface.ts         # Plugin type definitions
│   │   └── registry.ts          # Extension point registry
│   ├── middleware/               # Built-in middleware
│   │   ├── transform-format.ts
│   │   ├── inject-system.ts
│   │   ├── cache.ts
│   │   ├── guard.ts
│   │   └── log-request.ts
│   ├── compose/                  # Built-in composers
│   │   ├── chain.ts
│   │   ├── fork-join.ts
│   │   ├── thinking-wrapper.ts
│   │   └── tool-router.ts
│   └── cli/
│       ├── index.ts             # CLI entry (start, install, config)
│       ├── install.ts           # systemd service generator
│       └── migrate.ts           # DB migration commands
├── deploy/
│   ├── docker/
│   │   ├── Dockerfile
│   │   └── docker-compose.yml
│   ├── k8s/
│   │   └── helm/
│   │       ├── Chart.yaml
│   │       ├── values.yaml
│   │       └── templates/
│   ├── systemd/
│   │   └── prism-pipe.service.template
│   ├── cloudflare/
│   │   └── wrangler.toml
│   └── lambda/
│       └── serverless.yml
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── biome.json
├── tsconfig.json
├── package.json
├── prism-pipe.example.yaml
└── README.md
```

---

## Platform Rollout Plan

### Tier 1 — Day One (v0.1)
These MUST work at launch:

- [x] **Local Node.js** — `npx prism-pipe` or `npm i -g prism-pipe`
- [x] **Docker** — `docker run prism-pipe` (multi-arch: amd64 + arm64)
- [x] **systemd** — `prism-pipe install --systemd` generates + enables service

### Tier 2 — v0.2
- [ ] **Docker Compose** — Full stack with Prometheus + Grafana + Loki
- [ ] **Kubernetes Helm chart** — With HPA, PDB, configmap, secrets
- [ ] **Raspberry Pi** — Tested ARM64, documented memory tuning

### Tier 3 — v0.3
- [ ] **AWS Lambda** — Adapter, SAM/Serverless template
- [ ] **GitHub Actions** — Sidecar mode, artifact logging
- [ ] **CI/CD test harness** — Use as a test double for AI APIs

### Tier 4 — v0.4
- [ ] **Cloudflare Workers** — D1 store, separate entry point
- [ ] **Deno Deploy** — If demand exists
- [ ] **Fly.io** — fly.toml template

### Compatibility Testing Matrix

```yaml
# .github/workflows/compat.yml
test:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
    node: [20, 22]
    arch: [x64, arm64]
  includes:
    - name: raspberry-pi
      os: ubuntu-latest
      arch: arm64
      node: 20
    - name: docker
      container: node:20-slim
    - name: alpine
      container: node:20-alpine
```

---

## Additional Ideas

### Auth Layer
Multi-tenant API key management — users can issue keys with per-key rate limits, provider access controls, and usage tracking. Useful for teams sharing a proxy.

```yaml
auth:
  type: api-key              # api-key | jwt | oauth2 | none
  keys:
    - key: ${TEAM_A_KEY}
      name: "Team A"
      rateLimit: { capacity: 100, refillRate: 2/s }
      allowedProviders: [openai, anthropic]
    - key: ${TEAM_B_KEY}
      name: "Team B"
      rateLimit: { capacity: 50, refillRate: 1/s }
      allowedProviders: [openai]
```

### Request Replay
Store raw requests and replay them against different providers for comparison/testing. Useful for evaluating model migrations.

### Cost Tracking
Track token usage and estimated costs per key/team/provider. Dashboard or webhook alerts when budgets are hit.

### Schema Validation
Validate that AI responses match expected JSON schemas before returning to the client. Retry with the schema error if validation fails.

### Admin API
REST API for runtime management:
- `GET /admin/health` — health check
- `GET /admin/config` — current config (redacted secrets)
- `POST /admin/config` — hot-reload config
- `GET /admin/stats` — real-time stats
- `GET /admin/providers` — provider health status
- `POST /admin/cache/flush` — flush response cache

---

## Phase Plan

### Phase 1 — Foundation (v0.1)
- [ ] Project scaffold (TS, Biome, Vitest)
- [ ] Config loader (YAML + env + defaults)
- [ ] Core pipeline engine (middleware chain)
- [ ] Basic Express proxy (single provider, passthrough)
- [ ] Pino structured logging
- [ ] SQLite store (default)
- [ ] CLI (`prism-pipe start`, `prism-pipe install --systemd`)
- [ ] Docker multi-arch build
- [ ] `npx prism-pipe` zero-config start

### Phase 2 — Core Features (v0.2)
- [ ] Multi-provider routing
- [ ] Format transform middleware (OpenAI ↔ Anthropic ↔ Google)
- [ ] Rate limiting (token bucket + sliding window)
- [ ] Fallback chains + circuit breaker
- [ ] Request logging to SQLite
- [ ] Prometheus metrics endpoint
- [ ] Helm chart

### Phase 3 — Composition & Threading (v0.3)
- [ ] Agent composition engine (chain, fork-join, thinking-wrapper)
- [ ] Worker thread pool for outbound requests
- [ ] Multi-IP egress with agent pool
- [ ] SSE streaming support
- [ ] Plugin system
- [ ] Custom middleware loading
- [ ] Lambda + GitHub Actions adapters

### Phase 4 — Observability & Polish (v0.4)
- [ ] Pluggable log sinks (Loki, JSONL, GitHub artifacts)
- [ ] Pluggable metrics exporters (OTLP, StatsD)
- [ ] Event namespace remapping
- [ ] Alert engine
- [ ] Config hot-reload
- [ ] Admin API
- [ ] Auth layer (API keys)
- [ ] Cloudflare Workers adapter

### Phase 5 — Advanced (v0.5+)
- [ ] Tool router composer
- [ ] Request replay / A-B testing
- [ ] Cost tracking + budgets
- [ ] Response schema validation + retry
- [ ] Admin dashboard (web UI)
- [ ] Redis + DynamoDB store backends
- [ ] Multi-tenant management
