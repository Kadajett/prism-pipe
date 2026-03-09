import type { PipelineContext } from "./context";
import type { CanonicalRequest, CanonicalResponse } from "./types";
/**
 * PipelineEngine class (stub)
 */
export declare class PipelineEngine {
    execute(_request: CanonicalRequest, _context: PipelineContext): Promise<CanonicalResponse>;
    executeStream(_request: CanonicalRequest, _context: PipelineContext): Promise<AsyncIterable<string>>;
}
export declare function createPipeline(): PipelineEngine;
//# sourceMappingURL=pipeline.d.ts.map