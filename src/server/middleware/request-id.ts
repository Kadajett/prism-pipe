/**
 * Request ID middleware
 * Generates ULID for each request or propagates inbound X-Request-ID
 */
import type { Request, Response, NextFunction } from 'express';
import { ulid } from 'ulid';

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Use existing X-Request-ID if present, otherwise generate new ULID
  const requestId =
    (req.headers['x-request-id'] as string) || ulid();

  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);

  next();
}
