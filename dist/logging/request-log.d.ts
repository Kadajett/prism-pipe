/**
 * Request logging to SQLite (stub)
 */
import type { PipelineContext } from "@core";
export interface RequestLog {
    requestId: string;
    timestamp: number;
    duration: number;
    method: string;
    path: string;
    status: number;
    userId?: string;
    metadata?: Record<string, unknown>;
}
export declare class RequestLogger {
    log(_context: PipelineContext, _log: RequestLog): Promise<void>;
    getLogs(_userId?: string): Promise<RequestLog[]>;
}
export declare function createRequestLogger(): RequestLogger;
//# sourceMappingURL=request-log.d.ts.map