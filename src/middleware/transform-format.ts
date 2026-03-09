/**
 * Format transform middleware (stub)
 */

import type { CanonicalRequest, CanonicalResponse, PipelineContext } from "@core"

export async function transformFormatMiddleware(
  _request: CanonicalRequest,
  _context: PipelineContext,
): Promise<CanonicalRequest> {
  throw new Error("Not implemented")
}

export async function transformResponseMiddleware(
  _response: CanonicalResponse,
  _context: PipelineContext,
): Promise<CanonicalResponse> {
  throw new Error("Not implemented")
}
