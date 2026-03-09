import type { NextFunction, Request, Response } from "express"

/**
 * X-Prism-* header injection
 */

export function responseHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("X-Prism-Version", "0.1.0")
  res.setHeader("X-Prism-Name", "prism-pipe")
  next()
}
