/**
 * Fallback chain (stub)
 */
import type { CanonicalRequest, CanonicalResponse } from "@core";
export interface FallbackProvider {
    name: string;
    priority: number;
    execute(request: CanonicalRequest): Promise<CanonicalResponse>;
}
export declare class FallbackChain {
    private providers;
    addProvider(provider: FallbackProvider): void;
    execute(_request: CanonicalRequest): Promise<CanonicalResponse>;
}
export declare function createFallbackChain(): FallbackChain;
//# sourceMappingURL=chain.d.ts.map