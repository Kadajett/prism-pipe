import type { PipelineContext } from "./context"
import type { CanonicalRequest, CanonicalResponse } from "./types"

/**
 * PipelineEngine class (stub)
 */

export class PipelineEngine {
  async execute(_request: CanonicalRequest, _context: PipelineContext): Promise<CanonicalResponse> {
    throw new Error("Not implemented")
  }

  async executeStream(
    _request: CanonicalRequest,
    _context: PipelineContext,
  ): Promise<AsyncIterable<string>> {
    throw new Error("Not implemented")
  }
}

export function createPipeline(): PipelineEngine {
  return new PipelineEngine()
}
