/**
 * Provider registry
 */
export class ProviderRegistry {
    constructor() {
        this.providers = new Map();
    }
    register(name, adapter) {
        this.providers.set(name, adapter);
    }
    get(name) {
        const adapter = this.providers.get(name);
        if (!adapter) {
            throw new Error(`Provider not found: ${name}`);
        }
        return adapter;
    }
    list() {
        return Array.from(this.providers.keys());
    }
}
export function createProviderRegistry() {
    return new ProviderRegistry();
}
//# sourceMappingURL=provider.js.map