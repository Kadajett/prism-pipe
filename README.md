# 🔷 Prism Pipe

AI proxy with configurable rate limiting, provider fallbacks, structured logging, and format transformation.

Split your AI requests like light through a prism.

## Quick Start

```bash
# Zero-config — just set your API key and go
OPENAI_API_KEY=sk-... npx prism-pipe
```

That's it. Point any OpenAI SDK at `http://localhost:3000` and it works.

### With multiple providers (automatic fallback)

```bash
OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-ant-... npx prism-pipe
```

If OpenAI is down, requests automatically fall back to Anthropic.

## Features

- **Zero config** — `OPENAI_API_KEY=sk-... npx prism-pipe` just works
- **Multi-provider fallback** — Chain providers with automatic failover and circuit breaking
- **Format transformation** — Send OpenAI format, proxy to Anthropic (or vice versa)
- **Rate limiting** — Token bucket per IP, configurable via `RATE_LIMIT_RPM`
- **Request logging** — Every request logged to SQLite for audit/debugging
- **Streaming** — SSE passthrough for streaming completions
- **Auth** — Optional API key auth via `PRISM_API_KEYS`
- **Docker** — Multi-stage build, multi-arch (amd64 + arm64)

## Usage

### As a drop-in OpenAI proxy

```python
import openai
client = openai.OpenAI(base_url="http://localhost:3000/v1", api_key="anything")
resp = client.chat.completions.create(model="gpt-4o", messages=[{"role": "user", "content": "Hello"}])
```

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/v1/chat/completions` | POST | Proxy chat completions (OpenAI or Anthropic format) |
| `/v1/models` | GET | List configured providers and models |
| `/health` | GET | Health check |

### Response Headers

Every response includes:

| Header | Description |
|---|---|
| `X-Request-ID` | Unique request identifier |
| `X-Prism-Provider` | Provider that handled the request |
| `X-Prism-Latency` | Total latency in milliseconds |
| `X-Prism-Fallback-Used` | `true` if a fallback provider was used |
| `X-RateLimit-Limit` | Rate limit capacity |
| `X-RateLimit-Remaining` | Remaining requests |
| `X-RateLimit-Reset` | Reset timestamp (Unix seconds) |

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI API key (auto-configures provider) |
| `ANTHROPIC_API_KEY` | — | Anthropic API key (auto-configures as fallback) |
| `PORT` | `3000` | Server port |
| `LOG_LEVEL` | `info` | Log level (trace/debug/info/warn/error) |
| `RATE_LIMIT_RPM` | `60` | Requests per minute per IP |
| `PRISM_API_KEYS` | — | Comma-separated API keys for auth (empty = open) |
| `STORE_TYPE` | `sqlite` | Storage backend (`sqlite` or `memory`) |
| `STORE_PATH` | `./data/prism-pipe.db` | SQLite database path |

### Config File

For advanced configuration, create `prism-pipe.yaml`:

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

## Docker

```bash
# Build
docker build -t prism-pipe .

# Run
docker run -p 3000:3000 -e OPENAI_API_KEY=sk-... prism-pipe

# Docker Compose
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

For the proposed future-facing programmatic surface, see [docs/PUBLIC-API.md](./docs/PUBLIC-API.md).

## License

MIT
