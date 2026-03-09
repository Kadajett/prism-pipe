import { z } from 'zod';

// ── Sub-schemas ──

export const CorsConfigSchema = z.object({
  origin: z.union([z.string(), z.array(z.string())]).default('*'),
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
  keyBy: z.enum(['ip', 'apiKey', 'user']).default('ip'),
});
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

export const LoggingConfigSchema = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  output: z.enum(['stdout', 'jsonl', 'both']).default('stdout'),
  jsonlPath: z.string().optional(),
});
export type LoggingConfig = z.infer<typeof LoggingConfigSchema>;

export const StoreConfigSchema = z.object({
  type: z.enum(['sqlite', 'memory']).default('memory'),
  path: z.string().optional(),
});
export type StoreConfig = z.infer<typeof StoreConfigSchema>;

// ── Metrics / Cost / Budget schemas ──

export const ExporterConfigSchema = z.object({
  type: z.enum(['prometheus', 'otlp', 'statsd', 'console', 'custom']),
  endpoint: z.string().optional(),
  intervalMs: z.number().positive().optional(),
  module: z.string().optional(),
});
export type ExporterConfig = z.infer<typeof ExporterConfigSchema>;

export const MetricsConfigSchema = z.object({
  enabled: z.boolean().default(false),
  namespace: z.string().default('prism'),
  exporters: z.array(ExporterConfigSchema).default([]),
  remap: z.record(z.string(), z.string()).optional(),
});
export type MetricsConfig = z.infer<typeof MetricsConfigSchema>;

export const CostConfigSchema = z.object({
  enabled: z.boolean().default(false),
  headers: z.boolean().default(true),
  flatRate: z.array(z.string()).optional(),
});
export type CostConfig = z.infer<typeof CostConfigSchema>;

export const BudgetHandlerConfigSchema = z.object({
  type: z.enum(['webhook', 'log', 'custom']),
  url: z.string().optional(),
  module: z.string().optional(),
});

export const BudgetConfigSchema = z.object({
  enabled: z.boolean().default(false),
  daily: z.number().positive().optional(),
  monthly: z.number().positive().optional(),
  alertAt: z.array(z.number().min(0).max(100)).default([80, 90, 100]),
  hardLimit: z.boolean().default(false),
  handlers: z.array(BudgetHandlerConfigSchema).default([{ type: 'log' }]),
});
export type BudgetConfig = z.infer<typeof BudgetConfigSchema>;

// ── Root schema ──

const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3000),
  host: z.string().default('0.0.0.0'),
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
  metrics: nestedWithDefaults(MetricsConfigSchema),
  cost: nestedWithDefaults(CostConfigSchema),
  budget: nestedWithDefaults(BudgetConfigSchema),
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
    const messages = result.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${messages.join('\n')}`);
  }
  return Object.freeze(result.data) as ResolvedConfig;
}
