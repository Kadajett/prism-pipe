import { existsSync, readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { ResolvedConfig } from '../core/types';
import { DEFAULT_CONFIG } from './defaults';

/**
 * Interpolate ${VAR} references with environment variables.
 */
function interpolateEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
    const resolved = process.env[varName.trim()];
    if (resolved === undefined) {
      throw new Error(
        `Environment variable "\${${varName.trim()}}" is not defined. ` +
          'Set it or remove the reference from config.'
      );
    }
    return resolved;
  });
}

function deepInterpolate(obj: unknown): unknown {
  if (typeof obj === 'string') return interpolateEnv(obj);
  if (Array.isArray(obj)) return obj.map(deepInterpolate);
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepInterpolate(v);
    }
    return result;
  }
  return obj;
}

/**
 * Load config from a YAML file, interpolate env vars, merge with defaults.
 */
export function loadConfig(configPath?: string): ResolvedConfig {
  const paths = configPath
    ? [configPath]
    : ['prism-pipe.yaml', 'prism-pipe.yml', 'config.yaml', 'config.yml'];

  let rawConfig: Record<string, unknown> = {};

  for (const p of paths) {
    if (existsSync(p)) {
      const content = readFileSync(p, 'utf-8');
      rawConfig = (parseYaml(content) as Record<string, unknown>) ?? {};
      break;
    }
  }

  // Interpolate env vars
  rawConfig = deepInterpolate(rawConfig) as Record<string, unknown>;

  // Merge with defaults
  const config: ResolvedConfig = {
    port: Number(rawConfig.port ?? process.env.PORT ?? DEFAULT_CONFIG.port),
    logLevel: String(rawConfig.logLevel ?? process.env.LOG_LEVEL ?? DEFAULT_CONFIG.logLevel),
    requestTimeout: Number(rawConfig.requestTimeout ?? DEFAULT_CONFIG.requestTimeout),
    providers: {},
    routes: DEFAULT_CONFIG.routes,
  };

  // Parse providers
  if (rawConfig.providers && typeof rawConfig.providers === 'object') {
    for (const [name, value] of Object.entries(rawConfig.providers as Record<string, unknown>)) {
      const p = value as Record<string, unknown>;
      config.providers[name] = {
        name,
        baseUrl: String(p.baseUrl ?? p.base_url ?? ''),
        apiKey: String(p.apiKey ?? p.api_key ?? ''),
        format: p.format as string | undefined,
        models: p.models as Record<string, string> | undefined,
        defaultModel: p.defaultModel as string | undefined,
        timeout: p.timeout ? Number(p.timeout) : undefined,
      };
    }
  }

  // Auto-configure providers from env if none specified
  if (Object.keys(config.providers).length === 0) {
    if (process.env.OPENAI_API_KEY) {
      config.providers.openai = {
        name: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: process.env.OPENAI_API_KEY,
      };
    }
    if (process.env.ANTHROPIC_API_KEY) {
      config.providers.anthropic = {
        name: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        apiKey: process.env.ANTHROPIC_API_KEY,
      };
    }
  }

  // Parse routes
  if (Array.isArray(rawConfig.routes)) {
    config.routes = (rawConfig.routes as Array<Record<string, unknown>>).map((r) => {
      const route: import('../core/types').RouteConfig = {
        path: String(r.path),
        providers: (r.providers as string[]) ?? [],
        pipeline: r.pipeline as string[] | undefined,
        systemPrompt: r.systemPrompt as string | undefined,
      };

      // Parse compose config
      if (r.compose && typeof r.compose === 'object') {
        const c = r.compose as Record<string, unknown>;
        const composeType = String(c.type ?? 'chain');
        if (composeType !== 'chain') {
          throw new Error(`Unsupported compose type: "${composeType}". Only "chain" is supported.`);
        }
        const rawSteps = c.steps as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
          throw new Error(`Compose route "${route.path}" requires at least one step.`);
        }
        route.compose = {
          type: 'chain',
          steps: rawSteps.map((s) => {
            if (!s.name || !s.provider) {
              throw new Error(`Compose steps require "name" and "provider" fields.`);
            }
            return {
              name: String(s.name),
              provider: String(s.provider),
              model: s.model ? String(s.model) : undefined,
              systemPrompt: s.systemPrompt as string | undefined,
              inputTransform: s.inputTransform as string | undefined,
              timeout: s.timeout ? Number(s.timeout) : undefined,
              onError: s.onError as 'fail' | 'skip' | 'default' | 'partial' | undefined,
              defaultContent: s.defaultContent as string | undefined,
            };
          }),
        };
      }

      return route;
    });
  }

  return config;
}
