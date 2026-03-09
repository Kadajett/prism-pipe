/**
 * Request logging to SQLite (stub)
 */

import type { PipelineContext } from "@core"

export interface RequestLog {
  requestId: string
  timestamp: number
  duration: number
  method: string
  path: string
  status: number
  userId?: string
  metadata?: Record<string, unknown>
}

export class RequestLogger {
  async log(_context: PipelineContext, _log: RequestLog): Promise<void> {
    throw new Error("Not implemented")
  }

  async getLogs(_userId?: string): Promise<RequestLog[]> {
    throw new Error("Not implemented")
  }
}

export function createRequestLogger(): RequestLogger {
  return new RequestLogger()
}
