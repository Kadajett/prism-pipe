/**
 * Cloudflare Workers adapter for prism-pipe
 *
 * No fs, no SQLite. Uses KV/D1 for state, fetch-based HTTP.
 *
 * Usage:
 *   export default { fetch: handler } in wrangler entry
 *
 * Environment bindings (wrangler.toml):
 *   PRISM_KV: KV namespace for config/state
 *   PRISM_D1: D1 database for structured data
 */

// Minimal Cloudflare Workers type declarations (avoids @cloudflare/workers-types dependency)
interface KVNamespace { get(key: string, options?: unknown): Promise<string | null>; put(key: string, value: string): Promise<void>; }
interface D1Database { prepare(query: string): unknown; }

interface Env {
  PRISM_KV?: KVNamespace;
  PRISM_D1?: D1Database;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  PRISM_API_KEYS?: string;
}

/**
 * Cloudflare Workers fetch handler
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check fast path
    if (url.pathname === '/health') {
      return Response.json({
        status: 'healthy',
        runtime: 'cloudflare-workers',
        version: '0.1.0',
      });
    }

    if (url.pathname === '/ready') {
      const hasProviders = !!(env.OPENAI_API_KEY || env.ANTHROPIC_API_KEY);
      return Response.json(
        {
          status: hasProviders ? 'healthy' : 'degraded',
          runtime: 'cloudflare-workers',
          version: '0.1.0',
        },
        { status: hasProviders ? 200 : 503 }
      );
    }

    // TODO: Wire to pipeline engine when #10 MVP exports are stable
    return Response.json({
      message: 'prism-pipe edge adapter',
      path: url.pathname,
      method: request.method,
    });
  },
};
