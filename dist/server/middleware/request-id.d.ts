import type { NextFunction, Request, Response } from "express";
/**
 * X-Request-ID generation (ULID)
 */
export declare function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void;
declare global {
    namespace Express {
        interface Request {
            id: string;
        }
    }
}
//# sourceMappingURL=request-id.d.ts.map