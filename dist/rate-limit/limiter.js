/**
 * Rate limiter interface + factory
 */
export class AbstractLimiter {
}
export function createLimiter(type = "token-bucket") {
    if (type === "token-bucket") {
        throw new Error("Not implemented");
    }
    throw new Error(`Unknown limiter type: ${type}`);
}
//# sourceMappingURL=limiter.js.map