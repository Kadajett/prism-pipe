/**
 * Request logging middleware (stub)
 */

import type { CanonicalRequest, CanonicalResponse, PipelineContext } from "@core"

export async function logRequestMiddleware(
  _request: CanonicalRequest,
  _context: PipelineContext,
): Promise<void> {
  throw new Error("Not implemented")
}

export async function logResponseMiddleware(
  _response: CanonicalResponse,
  _context: PipelineContext,
): Promise<void> {
  throw new Error("Not implemented")
}
