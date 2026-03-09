/**
 * SQLite implementation (stub)
 */
import type { Store, StoreEntry } from "./interface";
export declare class SQLiteStore implements Store {
    constructor(_dbPath: string);
    set(_key: string, _value: unknown, _ttl?: number): Promise<void>;
    get(_key: string): Promise<unknown>;
    delete(_key: string): Promise<void>;
    exists(_key: string): Promise<boolean>;
    clear(): Promise<void>;
    list(_pattern?: string): Promise<StoreEntry[]>;
}
export declare function createSQLiteStore(dbPath: string): Store;
//# sourceMappingURL=sqlite.d.ts.map