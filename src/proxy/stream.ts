/**
 * SSE streaming utilities
 */

import type { StreamChunk } from "@core"

export interface StreamOptions {
  timeout?: number
  onChunk?: (chunk: StreamChunk) => void
  onError?: (error: Error) => void
}

export async function* streamResponse(
  source: AsyncIterable<StreamChunk>,
  _options?: StreamOptions,
): AsyncGenerator<string> {
  for await (const chunk of source) {
    const formatted = `data: ${JSON.stringify(chunk)}\n\n`
    yield formatted
  }
  yield "data: [DONE]\n\n"
}

export function formatSSEChunk(chunk: StreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`
}
