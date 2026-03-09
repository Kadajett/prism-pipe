# 🔷 Prism Pipe

AI proxy with configurable rate limiting, provider fallbacks, structured logging, and multi-IP egress.

Split your AI requests like light through a prism.

## Features

- **Pipeline Engine** — Koa-style `ctx + next()` middleware for programmable request processing
- **Provider Transforms** — Automatic format conversion between OpenAI ↔ Anthropic (canonical intermediate format)
- **Fallback Chains** — Ordered provider chains with retry + backoff on failures
- **SSE Streaming** — Pass-through streaming for real-time completions
- **Feature Degradation** — Gracefully handles missing provider capabilities (tools, vision, thinking)
- **Structured Logging** — JSON request/response logging with metrics

## Quick Start

```bash
# Install dependencies
npm install

# Set your API keys
cp .env.example .env
# Edit .env with your API keys

# Start the proxy (zero-config: auto-detects API keys from env)
npm run dev
```

The proxy starts on port 3000 by default. Send requests just like you would to OpenAI:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Configuration

Copy `prism-pipe.example.yaml` to `prism-pipe.yaml` for full configuration:

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
    providers: [openai, anthropic]  # Fallback order
    pipeline: [log-request, transform-format]
```

Environment variables are interpolated with `${VAR}` syntax.

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

### Directory Structure

```
src/
  core/           # Framework-agnostic pipeline engine
    types.ts      # Canonical types (CanonicalRequest, CanonicalResponse, etc.)
    context.ts    # PipelineContext (request lifecycle state)
    pipeline.ts   # PipelineEngine (Koa-style middleware composition)
    timeout.ts    # TimeoutBudget (wall-clock tracking with slice())
  proxy/          # Provider communication
    transform-registry.ts  # Registry for provider transformers
    transforms/
      openai.ts   # OpenAI ↔ Canonical bidirectional transform
      anthropic.ts # Anthropic ↔ Canonical bidirectional transform
    provider.ts   # HTTP calls to AI providers (JSON + SSE)
    stream.ts     # SSE streaming utilities
  middleware/     # Built-in pipeline middleware
    log-request.ts      # Request/response logging
    transform-format.ts # Auto-format conversion + feature degradation
    inject-system.ts    # System prompt injection
  fallback/       # Provider fallback logic
    chain.ts      # Ordered fallback with retry + backoff
  config/         # Configuration loading
    loader.ts     # YAML config with env interpolation
    defaults.ts   # Default configuration values
  server/         # HTTP layer (Express)
    express.ts    # Express app setup (CORS, body parser, health)
    router.ts     # Route matching → pipeline execution → response
  index.ts        # Entry point
```

## Development

```bash
npm run dev       # Start with hot reload
npm test          # Run tests (vitest)
npm run test:run  # Run tests once
npm run check     # Biome lint + format check
npm run build     # TypeScript compile
```

## License

MIT
