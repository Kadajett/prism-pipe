/**
 * Transform registry interface
 */
import type { CanonicalRequest, CanonicalResponse } from "@core";
export interface Transform {
    name: string;
    transform(req: CanonicalRequest): CanonicalRequest;
}
export interface ResponseTransform {
    name: string;
    transform(res: CanonicalResponse): CanonicalResponse;
}
export declare class TransformRegistry {
    private transforms;
    private responseTransforms;
    registerRequestTransform(name: string, transform: Transform): void;
    registerResponseTransform(name: string, transform: ResponseTransform): void;
    getRequestTransform(name: string): Transform;
    getResponseTransform(name: string): ResponseTransform;
}
export declare function createTransformRegistry(): TransformRegistry;
//# sourceMappingURL=transform.d.ts.map