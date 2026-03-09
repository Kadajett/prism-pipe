/**
 * PipelineContext interface + factory
 */
export interface PipelineContext {
    requestId: string;
    startTime: number;
    metadata: Record<string, unknown>;
    originalProvider?: string;
    targetProvider?: string;
    [key: string]: unknown;
}
export declare function createContext(metadata?: Record<string, unknown>): PipelineContext;
//# sourceMappingURL=context.d.ts.map