import { ProxyError } from "@core/errors";
import type { NextFunction, Request, Response } from "express";
/**
 * Express error middleware
 */
export declare function errorHandler(error: Error | ProxyError, req: Request, res: Response, _next: NextFunction): void;
//# sourceMappingURL=error-handler.d.ts.map