import type { PrismPipeConfig } from "./schema.js";

/**
 * Sensible defaults so prism-pipe works with zero config.
 * If OPENAI_API_KEY is present in env, auto-configures an OpenAI provider.
 */
export function getDefaults(): Partial<PrismPipeConfig> {
  const defaults: Partial<PrismPipeConfig> = {
    server: { port: 3000, host: "0.0.0.0", cors: true },
    providers: {},
    pipeline: [],
    logging: { level: "info", output: "stdout" },
    store: { type: "memory" },
  };

  // Auto-configure OpenAI if env key is present
  if (process.env.OPENAI_API_KEY) {
    defaults.providers = {
      openai: {
        baseUrl: "https://api.openai.com/v1",
        apiKey: process.env.OPENAI_API_KEY,
      },
    };
  }

  return defaults;
}
