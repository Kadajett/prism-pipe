import { ulid } from "ulid"

/**
 * PipelineContext interface + factory
 */

export interface PipelineContext {
  requestId: string
  startTime: number
  metadata: Record<string, unknown>
  originalProvider?: string
  targetProvider?: string
  [key: string]: unknown
}

export function createContext(metadata?: Record<string, unknown>): PipelineContext {
  return {
    requestId: ulid(),
    startTime: Date.now(),
    metadata: metadata || {},
  }
}
