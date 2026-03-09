/**
 * System prompt injection (stub)
 */

import type { CanonicalRequest, PipelineContext } from "@core"

export async function injectSystemMiddleware(
  _request: CanonicalRequest,
  _context: PipelineContext,
): Promise<CanonicalRequest> {
  throw new Error("Not implemented")
}
