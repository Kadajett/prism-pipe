/**
 * Provider registry
 */
import type { CanonicalRequest, CanonicalResponse } from "@core";
export interface ProviderAdapter {
    name: string;
    transformRequest(req: CanonicalRequest): unknown;
    transformResponse(res: unknown): CanonicalResponse;
}
export declare class ProviderRegistry {
    private providers;
    register(name: string, adapter: ProviderAdapter): void;
    get(name: string): ProviderAdapter;
    list(): string[];
}
export declare function createProviderRegistry(): ProviderRegistry;
//# sourceMappingURL=provider.d.ts.map