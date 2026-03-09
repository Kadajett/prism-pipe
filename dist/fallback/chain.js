/**
 * Fallback chain (stub)
 */
export class FallbackChain {
    constructor() {
        this.providers = [];
    }
    addProvider(provider) {
        this.providers.push(provider);
        this.providers.sort((a, b) => a.priority - b.priority);
    }
    async execute(_request) {
        throw new Error("Not implemented");
    }
}
export function createFallbackChain() {
    return new FallbackChain();
}
//# sourceMappingURL=chain.js.map