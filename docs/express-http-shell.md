# Express HTTP Shell

The Express HTTP shell is the thin HTTP layer that handles TCP, body parsing, CORS, route matching, and response serialization. It does NOT contain business logic — route handlers create a `PipelineContext` and hand it to the pipeline engine (to be implemented in future issues).

## Features

### Express App Factory (`src/server/express.ts`)
- JSON body parsing with 10MB limit
- Raw mode for streaming (50MB limit)
- Configurable CORS (default allow-all for local dev)
- Trust proxy for reverse proxy setups
- Graceful shutdown on SIGTERM/SIGINT with configurable drain timeout (30s default)
- Startup logging: port, host, providers, middleware count

### Route Mounting (`src/server/router.ts`)
- `POST /v1/chat/completions` — Main proxy endpoint (placeholder for now)
- `GET /v1/models` — List configured models/providers
- Default route: `/v1/*` returns 404 with structured error
- Route handlers create `PipelineContext` from request

### Health Endpoints (`src/server/health.ts`)
- `GET /health` — Always 200 (Kubernetes liveness)
- `GET /ready` — 200 when providers validated (Kubernetes readiness)
- Returns: `{ status, uptime, version }`

### Middleware

#### Request ID (`src/server/middleware/request-id.ts`)
- Generates ULID for each request
- Propagates inbound `X-Request-ID` header
- Sets `X-Request-ID` response header

#### Error Handler (`src/server/middleware/error-handler.ts`)
- Maps error classes to HTTP status codes
- Structured JSON errors
- Logs with request ID
- Never leaks stack traces in production

Error response format:
```json
{
  "error": {
    "type": "rate_limit_exceeded",
    "message": "...",
    "code": "RATE_LIMITED",
    "request_id": "01JQXYZ...",
    "retry_after": 30
  }
}
```

#### Response Headers (`src/server/middleware/response-headers.ts`)
- `X-Prism-Version` — Always included
- `X-Prism-Latency` — Included in standard/verbose mode
- `X-Prism-Provider` — Included in verbose mode
- Configurable verbosity: `minimal`, `standard`, `verbose`

### CLI Entry (`src/index.ts`, `bin/prism-pipe.js`)
- `prism-pipe` or `npx prism-pipe` starts with defaults
- Command-line flags:
  - `--port, -p` — Server port
  - `--config, -c` — Config file path
  - `--help, -h` — Show help
  - `--version, -v` — Show version
- `bin` field in package.json for CLI access

## Configuration

Environment variables:
- `PORT` — Server port (default: 3000)
- `HOST` — Server host (default: 0.0.0.0)
- `CORS_ENABLED` — Enable CORS (default: true)
- `CORS_ORIGINS` — Comma-separated allowed origins (default: *)
- `TRUST_PROXY` — Trust X-Forwarded-* headers (default: false)
- `SHUTDOWN_TIMEOUT` — Graceful shutdown timeout in ms (default: 30000)
- `RESPONSE_HEADER_VERBOSITY` — minimal | standard | verbose (default: standard)
- `OPENAI_API_KEY` — OpenAI API key
- `ANTHROPIC_API_KEY` — Anthropic API key

## Usage

```bash
# Start with defaults
npm run dev

# Or build and run
npm run build
npm start

# Or use CLI directly
./bin/prism-pipe.js --port 8080

# With environment variables
PORT=8080 OPENAI_API_KEY=sk-... npm run dev
```

## Testing

```bash
# Run tests
npm run test:run

# Watch mode
npm test
```

Test coverage:
- ✅ Server starts and responds to `/health`
- ✅ Request ID generation and propagation
- ✅ Error handler returns structured JSON
- ✅ Graceful shutdown
- ✅ `/v1/models` lists providers
- ✅ CORS middleware configured
- ✅ Response headers included

## Future Work

- Pipeline engine integration (currently returns placeholder responses)
- Streaming support (SSE for `AsyncIterableIterator`)
- Default proxy behavior for `/v1/*` routes
- Provider validation on startup
