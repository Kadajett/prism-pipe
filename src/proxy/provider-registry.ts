import type { ProviderConfig } from '../core/types';

/**
 * Provider registry: register providers from config, resolve by name.
 * Wraps provider configs with lookup, validation, and timeout defaults.
 */
export class ProviderRegistry {
	private readonly providers = new Map<string, ProviderConfig>();

	register(config: ProviderConfig): void {
		if (!config.name) throw new Error('Provider config must have a name');
		if (!config.baseUrl) throw new Error(`Provider "${config.name}" must have a baseUrl`);
		this.providers.set(config.name, config);
	}

	/**
	 * Register multiple providers from a config record (e.g., from YAML config).
	 */
	registerAll(configs: Record<string, ProviderConfig>): void {
		for (const [name, config] of Object.entries(configs)) {
			this.register({ ...config, name: config.name || name });
		}
	}

	get(name: string): ProviderConfig {
		const p = this.providers.get(name);
		if (!p) throw new Error(`Provider not found: "${name}". Registered: [${this.list().join(', ')}]`);
		return p;
	}

	has(name: string): boolean {
		return this.providers.has(name);
	}

	list(): string[] {
		return [...this.providers.keys()];
	}

	/**
	 * Resolve an ordered list of provider configs from an array of names.
	 * Throws on first unknown provider.
	 */
	resolve(names: string[]): ProviderConfig[] {
		return names.map((n) => this.get(n));
	}

	clear(): void {
		this.providers.clear();
	}

	get size(): number {
		return this.providers.size;
	}
}
