# 🔷 Prism Pipe

AI proxy with configurable rate limiting, provider fallbacks, structured logging, and multi-IP egress.

Split your AI requests like light through a prism.

## Features

- **Multi-threaded** — Worker threads for parallel outbound requests
- **Rate limiting** — Token bucket & sliding window, per-key/provider/IP/model
- **Fallbacks** — Ordered provider chains with circuit breakers
- **Multi-IP egress** — Distribute requests across multiple IPs
- **Logging** — Structured (Pino) + SQLite request audit trail
- **Streaming** — SSE passthrough for streaming completions

## Quick Start

```bash
cp .env.example .env
# Edit .env with your API keys
npm install
npm run dev
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full design.

## License

MIT
