import type { CanonicalRequest, CanonicalResponse } from "./types.js";

/** Context carried through the pipeline for a single request. */
export interface PipelineContext {
  readonly requestId: string;
  readonly startTime: number;
  request: CanonicalRequest;
  response?: CanonicalResponse;
  metadata: Record<string, unknown>;
}

/** Create a new pipeline context for an incoming request. */
export function createContext(requestId: string, request: CanonicalRequest): PipelineContext {
  return {
    requestId,
    startTime: Date.now(),
    request,
    metadata: {},
  };
}
