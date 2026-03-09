import { readFileSync, existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { ResolvedConfig, ProviderConfig, RouteConfig } from '../core/types.js';
import { DEFAULT_CONFIG } from './defaults.js';

/**
 * Interpolate ${VAR} references with environment variables.
 */
function interpolateEnv(value: string): string {
	return value.replace(/\$\{([^}]+)\}/g, (_, varName) => {
		const name = varName.trim();
		const val = process.env[name];
		if (val === undefined) {
			throw new Error(`Missing required environment variable: ${name}`);
		}
		return val;
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
				type: p.type ? String(p.type) : undefined,
				baseUrl: String(p.baseUrl ?? p.base_url ?? ''),
				apiKey: String(p.apiKey ?? p.api_key ?? ''),
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
		config.routes = (rawConfig.routes as Array<Record<string, unknown>>).map((r) => ({
			path: String(r.path),
			providers: (r.providers as string[]) ?? [],
			pipeline: r.pipeline as string[] | undefined,
			systemPrompt: r.systemPrompt as string | undefined,
		}));
	}

	// Basic validation
	validateConfig(config);

	return config;
}

function validateConfig(config: ResolvedConfig): void {
	if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
		throw new Error(`Invalid port: ${config.port}. Must be an integer between 1 and 65535.`);
	}

	const validLogLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];
	if (!validLogLevels.includes(config.logLevel)) {
		throw new Error(`Invalid logLevel: "${config.logLevel}". Must be one of: ${validLogLevels.join(', ')}`);
	}

	if (config.requestTimeout < 1000 || config.requestTimeout > 600000) {
		throw new Error(`Invalid requestTimeout: ${config.requestTimeout}. Must be between 1000ms and 600000ms.`);
	}

	for (const [name, provider] of Object.entries(config.providers)) {
		if (!provider.baseUrl) {
			throw new Error(`Provider "${name}" is missing baseUrl.`);
		}
		if (!provider.apiKey) {
			throw new Error(`Provider "${name}" is missing apiKey.`);
		}
	}

	for (const route of config.routes) {
		if (!route.path || !route.path.startsWith('/')) {
			throw new Error(`Route path "${route.path}" must start with "/".`);
		}
	}
}
