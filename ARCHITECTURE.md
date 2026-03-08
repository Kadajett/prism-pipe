# Prism Pipe — AI Proxy Architecture

> Configurable rate limiting, fallbacks, logging, and multi-IP egress for AI provider APIs.

## Overview

Prism Pipe is a multi-threaded Node.js reverse proxy that sits between your applications and AI providers (OpenAI, Anthropic, Google, etc.). It handles rate limiting, automatic failover, request logging, and can distribute outbound requests across multiple IP addresses to avoid per-IP throttling.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Runtime | Node.js (worker_threads + cluster) | True parallelism for CPU-bound work; cluster for multi-port binding |
| Language | TypeScript (strict) | Type safety across config, middleware, providers |
| Linter/Formatter | Biome | Fast, single-tool replacement for ESLint+Prettier |
| HTTP Framework | Express | Mature, middleware-friendly, easy to extend |
| Config | YAML + env vars | Human-readable config with env overrides |
| Logging | Pino | Structured JSON logs, low overhead |
| Rate Limiting | Custom (token bucket + sliding window) | Per-key, per-provider, per-IP granularity |
| Storage | SQLite (via better-sqlite3) | Request logs, rate limit counters, audit trail |
| Testing | Vitest | Fast, TS-native, compatible with Biome |

## Architecture Diagram

```
                          ┌─────────────────────────────────────┐
                          │          Prism Pipe Cluster          │
                          │                                     │
  Clients ──▶ :3000 ──▶  │  ┌─────────┐    ┌───────────────┐  │
                          │  │ Primary │    │ Worker Thread  │  │──▶ IP 1 ──▶ OpenAI
                          │  │ Process │───▶│ Pool (N)       │  │──▶ IP 2 ──▶ Anthropic
  Clients ──▶ :3001 ──▶  │  │         │    │                │  │──▶ IP 3 ──▶ Google
                          │  │ Express │    │ • Rate limiter │  │──▶ IP N ──▶ Fallback
                          │  │ Router  │    │ • IP rotation  │  │
                          │  │         │    │ • Retry logic  │  │
                          │  └─────────┘    └───────────────┘  │
                          │       │                             │
                          │  ┌────▼────┐                        │
                          │  │ SQLite  │ logs, counters, audit  │
                          │  └─────────┘                        │
                          └─────────────────────────────────────┘
```

## Core Modules

### 1. Multi-Threading (`src/cluster/`)

- **Primary process**: Express server, request routing, config hot-reload
- **Worker threads**: Handle outbound AI requests in parallel via `worker_threads`
- **Cluster mode** (optional): Spawn multiple primary processes bound to different ports/IPs using `node:cluster`

```
src/cluster/
  primary.ts          # Main process — Express + dispatching
  worker-pool.ts      # Manages worker_threads pool
  worker.ts           # Individual worker — makes outbound requests
  ip-binder.ts        # Binds outbound sockets to specific local IPs
```

### 2. Proxy & Routing (`src/proxy/`)

- Transparent proxying of AI API requests
- Provider detection from path/headers (e.g., `/v1/chat/completions` → OpenAI)
- Request/response transformation (normalize across providers if desired)
- Streaming support (SSE passthrough)

```
src/proxy/
  router.ts           # Express router — maps inbound paths to providers
  provider.ts          # Provider definitions (base URLs, auth, models)
  stream.ts            # SSE/streaming proxy handler
  transform.ts         # Optional request/response normalization
```

### 3. Rate Limiting (`src/rate-limit/`)

Two algorithms, configurable per provider/key:

- **Token bucket**: Burst-friendly, good for bursty workloads
- **Sliding window**: Strict enforcement, good for compliance with provider limits

Rate limits are configurable at multiple granularities:
- Per API key
- Per provider
- Per source IP
- Per model
- Global

```
src/rate-limit/
  limiter.ts           # Rate limiter interface + factory
  token-bucket.ts      # Token bucket implementation
  sliding-window.ts    # Sliding window implementation
  store.ts             # SQLite-backed counter persistence
  config.ts            # Rate limit config schema
```

### 4. Fallbacks & Retry (`src/fallback/`)

- **Provider chain**: Define ordered fallback providers (e.g., OpenAI → Anthropic → local)
- **Health checks**: Periodic pings to detect provider outages
- **Circuit breaker**: Trip after N consecutive failures, auto-recover
- **Retry with backoff**: Configurable per provider

```
src/fallback/
  chain.ts             # Fallback chain execution
  circuit-breaker.ts   # Circuit breaker pattern
  health-check.ts      # Provider health monitoring
  retry.ts             # Retry with exponential backoff
```

### 5. Multi-IP Egress (`src/network/`)

Distribute outbound requests across multiple local IP addresses to avoid per-IP rate limiting from providers.

- Bind outbound HTTP agents to specific local addresses
- Round-robin, random, or least-recently-used IP selection
- Support for IP aliases on a single NIC or multiple NICs
- Optional: SOCKS5/HTTP proxy support for external proxy pools

```
src/network/
  ip-pool.ts           # Manages available egress IPs
  agent-factory.ts     # Creates http.Agent bound to specific localAddress
  strategy.ts          # IP selection strategies (round-robin, random, LRU)
```

### 6. Logging & Observability (`src/logging/`)

- **Structured logging** via Pino (JSON, leveled)
- **Request logging** to SQLite: method, path, provider, latency, tokens, status, IP used
- **Metrics endpoint** (`/metrics`): Prometheus-compatible
- **Admin dashboard** (optional): Simple web UI for logs and stats

```
src/logging/
  logger.ts            # Pino logger setup
  request-log.ts       # SQLite request logging middleware
  metrics.ts           # Prometheus metrics endpoint
  db.ts                # SQLite connection + migrations
```

### 7. Configuration (`src/config/`)

YAML-based config with JSON schema validation and env var overrides.

```yaml
# config.yaml
server:
  port: 3000
  workers: 4          # worker_threads pool size

providers:
  openai:
    baseUrl: https://api.openai.com
    apiKey: ${OPENAI_API_KEY}
    rateLimit:
      algorithm: token-bucket
      capacity: 60
      refillRate: 1     # per second
    fallback: anthropic

  anthropic:
    baseUrl: https://api.anthropic.com
    apiKey: ${ANTHROPIC_API_KEY}
    rateLimit:
      algorithm: sliding-window
      maxRequests: 100
      windowMs: 60000
    fallback: local

egress:
  ips:
    - 192.168.1.100
    - 192.168.1.101
    - 192.168.1.102
  strategy: round-robin   # round-robin | random | lru

logging:
  level: info
  db: ./prism-pipe.db
  retentionDays: 30
```

## Directory Structure

```
prism-pipe/
├── biome.json
├── package.json
├── tsconfig.json
├── config.yaml              # Default config
├── config.schema.json       # Config validation schema
├── src/
│   ├── index.ts             # Entry point
│   ├── cluster/
│   │   ├── primary.ts
│   │   ├── worker-pool.ts
│   │   ├── worker.ts
│   │   └── ip-binder.ts
│   ├── proxy/
│   │   ├── router.ts
│   │   ├── provider.ts
│   │   ├── stream.ts
│   │   └── transform.ts
│   ├── rate-limit/
│   │   ├── limiter.ts
│   │   ├── token-bucket.ts
│   │   ├── sliding-window.ts
│   │   ├── store.ts
│   │   └── config.ts
│   ├── fallback/
│   │   ├── chain.ts
│   │   ├── circuit-breaker.ts
│   │   ├── health-check.ts
│   │   └── retry.ts
│   ├── network/
│   │   ├── ip-pool.ts
│   │   ├── agent-factory.ts
│   │   └── strategy.ts
│   ├── logging/
│   │   ├── logger.ts
│   │   ├── request-log.ts
│   │   ├── metrics.ts
│   │   └── db.ts
│   └── config/
│       ├── loader.ts
│       ├── schema.ts
│       └── env.ts
├── tests/
│   ├── unit/
│   └── integration/
└── docker/
    ├── Dockerfile
    └── docker-compose.yml
```

## Key Design Decisions

### Why worker_threads over cluster for proxying?

`cluster` forks the entire process — great for binding multiple ports but heavy. `worker_threads` share memory and are lighter for offloading outbound HTTP calls. We use **both**:
- `cluster` (optional) for multi-port/multi-IP binding at the listener level
- `worker_threads` for parallel outbound request execution within each process

### Why SQLite over Redis for rate limiting?

- Zero external dependencies — single binary deployment
- Persistent across restarts (no warm-up period)
- Good enough for single-node deployments (this isn't a distributed proxy)
- If distributed rate limiting is needed later, swap the store interface to Redis

### Why Express over Fastify?

The user specified Express. Fastify would be faster but Express has broader middleware ecosystem and the proxy middleware patterns are well-established. Performance bottleneck will be upstream AI providers, not the local framework.

### Multi-IP approach

Node.js `http.Agent` accepts a `localAddress` option — we create a pool of agents, each bound to a different local IP. No iptables or kernel-level routing needed. IPs can be:
- Multiple IPs on one NIC (ip addr add)
- Multiple NICs
- Proxy servers (SOCKS5/HTTP CONNECT)

## Phase Plan

### Phase 1 — Foundation
- [ ] Project scaffold (TS, Biome, Vitest)
- [ ] Config loader (YAML + env vars)
- [ ] Basic Express proxy (single provider, passthrough)
- [ ] Pino logging

### Phase 2 — Core Features
- [ ] Multi-provider routing
- [ ] Rate limiting (token bucket)
- [ ] Fallback chains
- [ ] Request logging to SQLite

### Phase 3 — Multi-Threading & IP
- [ ] Worker thread pool for outbound requests
- [ ] Multi-IP egress with agent pool
- [ ] IP selection strategies
- [ ] Circuit breaker

### Phase 4 — Production Hardening
- [ ] Streaming (SSE) support
- [ ] Prometheus metrics
- [ ] Config hot-reload
- [ ] Docker packaging
- [ ] Health check endpoints

### Phase 5 — Extras
- [ ] Admin dashboard
- [ ] Request/response transformation (provider normalization)
- [ ] API key management (multi-tenant)
- [ ] WebSocket support
