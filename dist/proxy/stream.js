/**
 * SSE streaming utilities
 */
export async function* streamResponse(source, _options) {
    for await (const chunk of source) {
        const formatted = `data: ${JSON.stringify(chunk)}\n\n`;
        yield formatted;
    }
    yield "data: [DONE]\n\n";
}
export function formatSSEChunk(chunk) {
    return `data: ${JSON.stringify(chunk)}\n\n`;
}
//# sourceMappingURL=stream.js.map