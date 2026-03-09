/**
 * Request logging to SQLite (stub)
 */
export class RequestLogger {
    async log(_context, _log) {
        throw new Error("Not implemented");
    }
    async getLogs(_userId) {
        throw new Error("Not implemented");
    }
}
export function createRequestLogger() {
    return new RequestLogger();
}
//# sourceMappingURL=request-log.js.map