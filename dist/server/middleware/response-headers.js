/**
 * X-Prism-* header injection
 */
export function responseHeadersMiddleware(_req, res, next) {
    res.setHeader("X-Prism-Version", "0.1.0");
    res.setHeader("X-Prism-Name", "prism-pipe");
    next();
}
//# sourceMappingURL=response-headers.js.map