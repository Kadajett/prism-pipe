import { ulid } from "ulid";
/**
 * X-Request-ID generation (ULID)
 */
export function requestIdMiddleware(req, res, next) {
    const requestId = req.headers["x-request-id"] || ulid();
    req.id = requestId;
    res.setHeader("X-Request-ID", requestId);
    next();
}
//# sourceMappingURL=request-id.js.map