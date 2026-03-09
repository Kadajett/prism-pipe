import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { LogFilter, RateLimitEntry, RequestLogEntry, Store } from './interface';

export class SQLiteStore implements Store {
  private db?: Database.Database;
  private dbPath: string;

  constructor(dbPath = './data/prism-pipe.db') {
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    await this.migrate();
  }

  async close(): Promise<void> {
    this.db?.close();
    this.db = undefined;
  }

  async migrate(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL UNIQUE,
        timestamp INTEGER NOT NULL,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        error_class TEXT,
        source_ip TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_request_log_timestamp ON request_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_request_log_provider ON request_log(provider);

      CREATE TABLE IF NOT EXISTS rate_limit_state (
        key TEXT PRIMARY KEY,
        tokens REAL NOT NULL,
        last_refill INTEGER NOT NULL,
        reset_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
  }

  async rateLimitGet(key: string): Promise<RateLimitEntry | null> {
    if (!this.db) throw new Error('Database not initialized');
    const row = this.db
      .prepare(
        'SELECT key, tokens, last_refill, reset_at FROM rate_limit_state WHERE key = ? AND expires_at > ?'
      )
      .get(key, Date.now()) as
      | { key: string; tokens: number; last_refill: number; reset_at: number }
      | undefined;
    if (!row) return null;
    return { key: row.key, tokens: row.tokens, lastRefill: row.last_refill, resetAt: row.reset_at };
  }

  async rateLimitSet(key: string, entry: RateLimitEntry, ttlMs = 3600000): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db
      .prepare(`
      INSERT INTO rate_limit_state (key, tokens, last_refill, reset_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        tokens = excluded.tokens, last_refill = excluded.last_refill,
        reset_at = excluded.reset_at, expires_at = excluded.expires_at
    `)
      .run(key, entry.tokens, entry.lastRefill, entry.resetAt, Date.now() + ttlMs);
  }

  async logRequest(entry: RequestLogEntry): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    try {
      this.db
        .prepare(`
        INSERT INTO request_log (request_id, timestamp, method, path, provider, model, status, latency_ms, input_tokens, output_tokens, error_class, source_ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
        .run(
          entry.request_id,
          entry.timestamp,
          entry.method,
          entry.path,
          entry.provider,
          entry.model,
          entry.status,
          entry.latency_ms,
          entry.input_tokens,
          entry.output_tokens,
          entry.error_class ?? null,
          entry.source_ip
        );
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message.includes('UNIQUE constraint'))) throw err;
    }
  }

  async queryLogs(filter: LogFilter): Promise<RequestLogEntry[]> {
    if (!this.db) throw new Error('Database not initialized');
    let query = 'SELECT * FROM request_log WHERE 1=1';
    const params: unknown[] = [];
    if (filter.since !== undefined) {
      query += ' AND timestamp >= ?';
      params.push(filter.since);
    }
    if (filter.until !== undefined) {
      query += ' AND timestamp <= ?';
      params.push(filter.until);
    }
    if (filter.provider) {
      query += ' AND provider = ?';
      params.push(filter.provider);
    }
    if (filter.status !== undefined) {
      query += ' AND status = ?';
      params.push(filter.status);
    }
    query += ' ORDER BY timestamp DESC';
    return this.db.prepare(query).all(...params) as RequestLogEntry[];
  }

  async cleanupExpiredEntries(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const now = Date.now();
    this.db.prepare('DELETE FROM rate_limit_state WHERE reset_at < ?').run(now);
  }

  async pruneOldLogs(maxAgeDays: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    this.db.prepare('DELETE FROM request_log WHERE timestamp < ?').run(cutoff);
  }
}
