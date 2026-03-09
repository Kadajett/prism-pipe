import { ProxyError, RateLimitError, TimeoutError, ValidationError } from "@core/errors";
import { logger } from "@logging/logger";
/**
 * Express error middleware
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(error, req, res, _next) {
    logger.error({
        error: error.message,
        requestId: req.id,
        path: req.path,
        method: req.method,
    }, "Request error");
    if (error instanceof ValidationError) {
        res.status(400).json({
            error: {
                type: "validation_error",
                message: error.message,
                fields: error.fields,
            },
        });
        return;
    }
    if (error instanceof TimeoutError) {
        res.status(504).json({
            error: {
                type: "timeout_error",
                message: error.message,
            },
        });
        return;
    }
    if (error instanceof RateLimitError) {
        res.status(429).json({
            error: {
                type: "rate_limit_error",
                message: error.message,
            },
        });
        return;
    }
    if (error instanceof ProxyError) {
        res.status(error.status || 500).json({
            error: {
                type: "proxy_error",
                code: error.code,
                message: error.message,
            },
        });
        return;
    }
    res.status(500).json({
        error: {
            type: "internal_error",
            message: "An unexpected error occurred",
        },
    });
}
//# sourceMappingURL=error-handler.js.map