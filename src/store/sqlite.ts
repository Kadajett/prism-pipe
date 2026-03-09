import type { Store } from "./interface.js";

/** SQLite-backed store implementation. */
export class SqliteStore implements Store {
  constructor(private readonly _dbPath: string) {}

  async init(): Promise<void> {
    // TODO: open SQLite database, create tables
    throw new Error("Not implemented");
  }

  async get<T = unknown>(_key: string): Promise<T | undefined> {
    // TODO: implement get
    throw new Error("Not implemented");
  }

  async set<T = unknown>(_key: string, _value: T): Promise<void> {
    // TODO: implement set
    throw new Error("Not implemented");
  }

  async delete(_key: string): Promise<boolean> {
    // TODO: implement delete
    throw new Error("Not implemented");
  }

  async close(): Promise<void> {
    // TODO: close database connection
    throw new Error("Not implemented");
  }
}
