import type { NextFunction, Request, Response } from "express"
import { ulid } from "ulid"

/**
 * X-Request-ID generation (ULID)
 */

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers["x-request-id"] || ulid()
  req.id = requestId as string
  res.setHeader("X-Request-ID", requestId)
  next()
}

declare global {
  namespace Express {
    interface Request {
      id: string
    }
  }
}
