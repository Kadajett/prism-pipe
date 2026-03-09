/**
 * SQLite implementation (stub)
 */
export class SQLiteStore {
    constructor(_dbPath) {
        throw new Error("Not implemented");
    }
    async set(_key, _value, _ttl) {
        throw new Error("Not implemented");
    }
    async get(_key) {
        throw new Error("Not implemented");
    }
    async delete(_key) {
        throw new Error("Not implemented");
    }
    async exists(_key) {
        throw new Error("Not implemented");
    }
    async clear() {
        throw new Error("Not implemented");
    }
    async list(_pattern) {
        throw new Error("Not implemented");
    }
}
export function createSQLiteStore(dbPath) {
    return new SQLiteStore(dbPath);
}
//# sourceMappingURL=sqlite.js.map