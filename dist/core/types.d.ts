/**
 * Core type definitions: CanonicalRequest, CanonicalResponse, ContentBlock, etc.
 */
export interface CanonicalRequest {
    model: string;
    messages: Array<{
        role: "system" | "user" | "assistant";
        content: string | ContentBlock[];
    }>;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    [key: string]: unknown;
}
export interface ContentBlock {
    type: "text" | "image" | "tool_use" | "tool_result";
    text?: string;
    [key: string]: unknown;
}
export interface CanonicalResponse {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        message: {
            role: "assistant";
            content: string | ContentBlock[];
        };
        finishReason: string;
    }>;
    usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
    };
}
export interface StreamChunk {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        delta: {
            role?: string;
            content?: string;
        };
        finishReason: string | null;
    }>;
}
//# sourceMappingURL=types.d.ts.map