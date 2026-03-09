import { ulid } from "ulid";
export function createContext(metadata) {
    return {
        requestId: ulid(),
        startTime: Date.now(),
        metadata: metadata || {},
    };
}
//# sourceMappingURL=context.js.map