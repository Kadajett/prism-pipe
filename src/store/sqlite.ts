/**
 * SQLite implementation (stub)
 */

import type { Store, StoreEntry } from "./interface"

export class SQLiteStore implements Store {
  constructor(_dbPath: string) {
    throw new Error("Not implemented")
  }

  async set(_key: string, _value: unknown, _ttl?: number): Promise<void> {
    throw new Error("Not implemented")
  }

  async get(_key: string): Promise<unknown> {
    throw new Error("Not implemented")
  }

  async delete(_key: string): Promise<void> {
    throw new Error("Not implemented")
  }

  async exists(_key: string): Promise<boolean> {
    throw new Error("Not implemented")
  }

  async clear(): Promise<void> {
    throw new Error("Not implemented")
  }

  async list(_pattern?: string): Promise<StoreEntry[]> {
    throw new Error("Not implemented")
  }
}

export function createSQLiteStore(dbPath: string): Store {
  return new SQLiteStore(dbPath)
}
