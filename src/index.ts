export * from './config/index.js';

/**
 * CLI entry point for Prism Pipe
 */
import { parseArgs } from 'node:util';
import { startServer } from './server/express.js';
import { loadConfig } from './config/index.js';

const VERSION = '0.1.0';

async function main() {
  const { values } = parseArgs({
    options: {
      port: {
        type: 'string',
        short: 'p',
      },
      config: {
        type: 'string',
        short: 'c',
      },
      help: {
        type: 'boolean',
        short: 'h',
      },
      version: {
        type: 'boolean',
        short: 'v',
      },
    },
    allowPositionals: false,
  });

  if (values.help) {
    console.log(`
Prism Pipe v${VERSION}
AI proxy with configurable rate limiting, fallbacks, and multi-IP egress

Usage:
  prism-pipe [options]
  npx prism-pipe [options]

Options:
  -p, --port <number>      Port to listen on (default: 3000)
  -c, --config <path>      Path to config file (default: .env)
  -h, --help               Show this help message
  -v, --version            Show version number

Environment Variables:
  PORT                     Server port (default: 3000)
  HOST                     Server host (default: 0.0.0.0)
  CORS_ENABLED             Enable CORS (default: true)
  CORS_ORIGINS             Comma-separated allowed origins (default: *)
  TRUST_PROXY              Trust X-Forwarded-* headers (default: false)
  SHUTDOWN_TIMEOUT         Graceful shutdown timeout in ms (default: 30000)
  OPENAI_API_KEY           OpenAI API key
  ANTHROPIC_API_KEY        Anthropic API key

Examples:
  prism-pipe
  prism-pipe --port 8080
  PORT=8080 prism-pipe
    `);
    return;
  }

  if (values.version) {
    console.log(`v${VERSION}`);
    return;
  }

  if (values.port) {
    process.env.PORT = values.port;
  }

  const config = loadConfig();

  if (config.providers.length === 0) {
    console.warn({
      event: 'no_providers_configured',
      message:
        'No API keys found. Set OPENAI_API_KEY or ANTHROPIC_API_KEY environment variables.',
    });
  }

  try {
    await startServer(config);
  } catch (error) {
    console.error({
      event: 'server_start_failed',
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error({
    event: 'fatal_error',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
