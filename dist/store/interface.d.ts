/**
 * Store interface
 */
export interface StoreEntry {
    key: string;
    value: unknown;
    ttl?: number;
    createdAt: number;
    expiresAt?: number;
}
export interface Store {
    set(key: string, value: unknown, ttl?: number): Promise<void>;
    get(key: string): Promise<unknown>;
    delete(key: string): Promise<void>;
    exists(key: string): Promise<boolean>;
    clear(): Promise<void>;
    list(pattern?: string): Promise<StoreEntry[]>;
}
//# sourceMappingURL=interface.d.ts.map