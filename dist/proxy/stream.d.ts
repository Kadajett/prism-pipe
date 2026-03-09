/**
 * SSE streaming utilities
 */
import type { StreamChunk } from "@core";
export interface StreamOptions {
    timeout?: number;
    onChunk?: (chunk: StreamChunk) => void;
    onError?: (error: Error) => void;
}
export declare function streamResponse(source: AsyncIterable<StreamChunk>, _options?: StreamOptions): AsyncGenerator<string>;
export declare function formatSSEChunk(chunk: StreamChunk): string;
//# sourceMappingURL=stream.d.ts.map