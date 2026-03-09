import { z } from "zod";

// ── Sub-schemas ──

export const CorsConfigSchema = z.object({
  origin: z.union([z.string(), z.array(z.string())]).default("*"),
  credentials: z.boolean().default(false),
});
export type CorsConfig = z.infer<typeof CorsConfigSchema>;

export const TimeoutConfigSchema = z.object({
  connect: z.number().positive().optional(),
  firstByte: z.number().positive().optional(),
  total: z.number().positive().optional(),
});
export type TimeoutConfig = z.infer<typeof TimeoutConfigSchema>;

export const ProviderConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  models: z.array(z.string()).optional(),
  timeout: TimeoutConfigSchema.optional(),
  fallback: z.string().optional(),
});
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const PipelineStepConfigSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type PipelineStepConfig = z.infer<typeof PipelineStepConfigSchema>;

export const RateLimitConfigSchema = z.object({
  windowMs: z.number().positive().default(60_000),
  maxRequests: z.number().positive().default(60),
  keyBy: z.enum(["ip", "apiKey", "user"]).default("ip"),
});
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

export const LoggingConfigSchema = z.object({
  level: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  output: z.enum(["stdout", "jsonl", "both"]).default("stdout"),
  jsonlPath: z.string().optional(),
});
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

export const StoreConfigSchema = z.object({
  type: z.enum(["sqlite", "memory"]).default("memory"),
  path: z.string().optional(),
});
export type StoreConfig = z.infer<typeof StoreConfigSchema>;

// ── Root schema ──

const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default("0.0.0.0"),
  cors: z.union([z.boolean(), CorsConfigSchema]).default(true),
});

// Zod v4: `.default({})` doesn't re-run inner field defaults.
// Use z.preprocess to ensure the sub-object is parsed with its own defaults.
function nestedWithDefaults<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((val) => val ?? {}, schema) as unknown as T;
}

export const PrismPipeConfigSchema = z.object({
  server: nestedWithDefaults(ServerConfigSchema),
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  pipeline: z.array(PipelineStepConfigSchema).default([]),
  rateLimits: RateLimitConfigSchema.optional(),
  logging: nestedWithDefaults(LoggingConfigSchema),
  store: nestedWithDefaults(StoreConfigSchema),
});

export type PrismPipeConfig = z.infer<typeof PrismPipeConfigSchema>;
export type ResolvedConfig = Readonly<PrismPipeConfig>;

/**
 * Validate raw config data and return a typed, frozen config.
 * Throws a descriptive error on validation failure.
 */
export function validateConfig(raw: unknown): ResolvedConfig {
  const result = PrismPipeConfigSchema.safeParse(raw);
  if (!result.success) {
    const messages = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${messages.join("\n")}`);
  }
  return Object.freeze(result.data) as ResolvedConfig;
}
