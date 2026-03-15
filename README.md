# 🔷 Prism Pipe

AI proxy with configurable rate limiting, provider fallbacks, structured logging, compose chains, and format transformation.

Split your AI requests like light through a prism.

## Quick Start

```bash
# Zero-config — just set your API key and go
OPENAI_API_KEY=sk-... npx prism-pipe
```

Point any OpenAI SDK at `http://localhost:3000` and it works.

### With multiple providers (automatic fallback)

```bash
OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-ant-... npx prism-pipe
```

If OpenAI is down, requests automatically fall back to Anthropic.

## Features

- **Zero config** — `OPENAI_API_KEY=sk-... npx prism-pipe` just works
- **Programmatic API** — `new PrismPipe()` for full control from TypeScript
- **Multi-port proxies** — Run multiple proxy configs in a single process
- **Compose chains** — Chain multiple providers/models per route (planner → executor → reviewer)
- **Multi-provider fallback** — Chain providers with automatic failover and circuit breaking
- **Format transformation** — Send OpenAI format, proxy to Anthropic (or vice versa)
- **Function routes** — Use `RouteHandler` functions for custom request processing
- **Rate limiting** — Token bucket per IP, configurable via `RATE_LIMIT_RPM`
- **Request logging** — Every request logged to SQLite for audit/debugging
- **Log queries** — Query request/usage logs programmatically
- **Streaming** — SSE passthrough for streaming completions
- **Auth** — Optional API key auth via `PRISM_API_KEYS`
- **Docker** — Multi-stage build, multi-arch (amd64 + arm64)

## Programmatic API

### Basic — single proxy

```typescript
import { PrismPipe } from 'prism-pipe';

const prism = new PrismPipe({ logLevel: 'info', storeType: 'sqlite' });

prism.createProxy({
  id: 'my-proxy',
  port: 3000,
  providers: {
    openai: {
      baseUrl: 'https://api.openai.com',
      apiKey: process.env.OPENAI_API_KEY!,
      format: 'openai',
    },
  },
  routes: {
    '/v1/chat/completions': { providers: ['openai'] },
  },
});

await prism.start();
```

### Multi-port — multiple proxies in one process

```typescript
const prism = new PrismPipe({ logLevel: 'info' });

// Port 3100: direct proxy
prism.createProxy({
  id: 'direct',
  port: 3100,
  providers: {
    mercury: { baseUrl: 'https://api.inceptionlabs.ai', apiKey: process.env.INCEPTION_API_KEY!, format: 'openai' },
  },
  routes: { '/v1/chat/completions': { providers: ['mercury'] } },
});

// Port 3101: compose chain (planner → executor)
prism.createProxy({
  id: 'chain',
  port: 3101,
  providers: {
    fast: { baseUrl: 'https://api.inceptionlabs.ai', apiKey: process.env.INCEPTION_API_KEY!, format: 'openai' },
    smart: { baseUrl: 'https://api.anthropic.com', apiKey: process.env.ANTHROPIC_API_KEY!, format: 'anthropic' },
  },
  routes: {
    '/v1/chat/completions': {
      compose: {
        type: 'chain',
        steps: [
          { name: 'planner', provider: 'smart', model: 'claude-opus-4-6', systemPrompt: 'Plan the solution.', timeout: 60000 },
          { name: 'executor', provider: 'fast', model: 'mercury-2', systemPrompt: 'Execute: {{steps.planner.content}}', timeout: 60000 },
        ],
      },
    },
  },
});

await prism.start();
```

### Function routes — custom request handling

```typescript
import { PrismPipe, type RouteHandler } from 'prism-pipe';

const customHandler: RouteHandler = async (req, res) => {
  // Custom logic before proxying
  res.json({ message: 'Custom response' });
};

const prism = new PrismPipe();
prism.createProxy({
  id: 'custom',
  port: 3000,
  providers: {},
  routes: { '/v1/custom': customHandler },
});
```

### Error handling

```typescript
prism.onError((event) => {
  const { error, errorClass, context } = event;
  console.error(`[${errorClass}] ${context.port}${context.route}: ${error.message}`);
});
```

### Log queries

```typescript
// Query request logs
const logs = await prism.getLogs({ limit: 100 });

// Usage by model
const usage = await prism.getUsageByModel();

// Cost by proxy
const costs = await prism.getCostByProxy();
```

### Lifecycle

```typescript
await prism.start();      // Start all proxies
await prism.stop();       // Stop proxies (keep store open)
await prism.reload();     // Reload all proxies
await prism.shutdown();   // Stop everything + close store
```

### Migration from `createPrismPipe()` factory

The old factory function `createPrismPipe()` has been replaced by the `PrismPipe` class:

```typescript
// ❌ Old (deprecated)
import { createPrismPipe } from 'prism-pipe';
const proxy = createPrismPipe({ port: 3000, providers: { ... } });

// ✅ New
import { PrismPipe } from 'prism-pipe';
const prism = new PrismPipe({ logLevel: 'info', storeType: 'sqlite' });
const proxy = prism.createProxy({ id: 'main', port: 3000, providers: { ... }, routes: { ... } });
await prism.start();
```

Key differences:
- `PrismPipe` is a class, not a factory function
- Shared store and transform registry across all proxies
- `createProxy()` returns a `ProxyInstance` — call `prism.start()` to start all
- Global error handling via `prism.onError()`
- Usage/cost queries via `prism.getUsageByModel()`, `prism.getCostByProxy()`, etc.

## YAML Configuration

For simple setups, YAML config still works:

```bash
# Use default prism-pipe.yaml
npx prism-pipe

# Or specify a config file
PRISM_CONFIG=configs/my-config.yaml npx prism-pipe
```

```yaml
port: 3000
logLevel: info
requestTimeout: 120000

providers:
  openai:
    baseUrl: https://api.openai.com
    apiKey: ${OPENAI_API_KEY}
  anthropic:
    baseUrl: https://api.anthropic.com
    apiKey: ${ANTHROPIC_API_KEY}

routes:
  - path: /v1/chat/completions
    providers: [openai, anthropic]
```

See [`prism-pipe.example.yaml`](./prism-pipe.example.yaml) for the full reference.

## Running All Proxies

```bash
# Programmatic mode (single process, recommended)
./start-all.sh

# Legacy YAML mode (3 separate processes)
./start-all.sh --yaml
```

See [`examples/programmatic.ts`](./examples/programmatic.ts) for the full multi-port example.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/v1/chat/completions` | POST | Proxy chat completions (OpenAI or Anthropic format) |
| `/v1/models` | GET | List configured providers and models |
| `/health` | GET | Health check |

### Response Headers

| Header | Description |
|---|---|
| `X-Request-ID` | Unique request identifier |
| `X-Prism-Provider` | Provider that handled the request |
| `X-Prism-Latency` | Total latency in milliseconds |
| `X-Prism-Fallback-Used` | `true` if a fallback provider was used |
| `X-RateLimit-Limit` | Rate limit capacity |
| `X-RateLimit-Remaining` | Remaining requests |
| `X-RateLimit-Reset` | Reset timestamp (Unix seconds) |

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI API key (auto-configures provider) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (auto-configures as fallback) |
| `INCEPTION_API_KEY` | — | Inception Labs API key |
| `PORT` | `3000` | Server port |
| `LOG_LEVEL` | `info` | Log level (trace/debug/info/warn/error) |
| `RATE_LIMIT_RPM` | `60` | Requests per minute per IP |
| `PRISM_API_KEYS` | — | Comma-separated API keys for auth (empty = open) |
| `STORE_TYPE` | `sqlite` | Storage backend (`sqlite` or `memory`) |
| `STORE_PATH` | `./data/prism-pipe.db` | SQLite database path |

### Store Migration (v0.1.0+)

**Default store type changed from `memory` to `sqlite`.**

This ensures rate limits, tenant costs, and circuit breaker state survive restarts.

- **To use the old in-memory behavior**, explicitly set `STORE_TYPE=memory` or `storeType: 'memory'` in your config
- **To use the new SQLite backend** (recommended), no changes needed — it's now the default
- **Existing in-memory state is not migrated** — the first start with SQLite creates a fresh database

## Docker

```bash
docker build -t prism-pipe .
docker run -p 3000:3000 -e OPENAI_API_KEY=sk-... prism-pipe
docker compose up
```

## Development

```bash
npm install
npm run dev          # Watch mode
npm run build        # Build
npm run test:run     # Tests
npm run check        # Biome lint + format check
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## License

MIT
