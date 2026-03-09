import Database from 'better-sqlite3';
<<<<<<< HEAD
import { existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { RateLimitEntry, RequestLogEntry, LogFilter, Store } from './interface';

/**
 * SQLite store implementation using better-sqlite3
 * Provides concurrent-read access via WAL mode
 */
=======
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RateLimitEntry, RequestLogEntry, LogFilter, Store } from './interface.js';

>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
export class SQLiteStore implements Store {
  private db?: Database.Database;
  private dbPath: string;

<<<<<<< HEAD
  constructor(dbPath: string = './data/prism-pipe.db') {
=======
  constructor(dbPath = './data/prism-pipe.db') {
>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
    this.dbPath = dbPath;
  }

  async init(): Promise<void> {
<<<<<<< HEAD
    // Ensure directory exists
=======
>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
<<<<<<< HEAD

    // Open database
    this.db = new Database(this.dbPath);

    // Enable WAL mode for concurrent reads
    this.db.pragma('journal_mode = WAL');

    // Run migrations
=======
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
    await this.migrate();
  }

  async close(): Promise<void> {
<<<<<<< HEAD
    if (this.db) {
      this.db.close();
      this.db = undefined;
    }
  }

  async migrate(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Create request_log table
=======
    this.db?.close();
    this.db = undefined;
  }

  async migrate(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
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
<<<<<<< HEAD
      
      CREATE INDEX IF NOT EXISTS idx_request_log_timestamp 
        ON request_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_request_log_provider 
        ON request_log(provider);
      CREATE INDEX IF NOT EXISTS idx_request_log_status 
        ON request_log(status);
    `);

    // Create rate_limit_state table
    this.db.exec(`
=======
      CREATE INDEX IF NOT EXISTS idx_request_log_timestamp ON request_log(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_request_log_provider ON request_log(provider);

>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
      CREATE TABLE IF NOT EXISTS rate_limit_state (
        key TEXT PRIMARY KEY,
        tokens REAL NOT NULL,
        last_refill INTEGER NOT NULL,
        reset_at INTEGER NOT NULL,
<<<<<<< HEAD
        expires_at INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_rate_limit_state_expires_at 
        ON rate_limit_state(expires_at);
    `);

    // Set up periodic cleanup of expired rate limit entries (every 10 minutes)
    // Note: In production, this should be handled by a separate cleanup job
    // For now, we'll rely on the Store interface consumer to call cleanup
  }

  async rateLimitGet(key: string): Promise<RateLimitEntry | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
      SELECT key, tokens, last_refill, reset_at 
      FROM rate_limit_state 
      WHERE key = ? AND expires_at > ?
    `);

    const now = Date.now();
    const row = stmt.get(key, now) as any;

    if (!row) {
      return null;
    }

    // Clean up expired entries
    this.db.prepare('DELETE FROM rate_limit_state WHERE expires_at <= ?').run(now);

    return {
      key: row.key,
      tokens: row.tokens,
      lastRefill: row.last_refill,
      resetAt: row.reset_at,
    };
  }

  async rateLimitSet(
    key: string,
    entry: RateLimitEntry,
    ttlMs: number = 3600000 // 1 hour default
  ): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const expiresAt = Date.now() + ttlMs;
    const stmt = this.db.prepare(`
      INSERT INTO rate_limit_state (key, tokens, last_refill, reset_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        tokens = excluded.tokens,
        last_refill = excluded.last_refill,
        reset_at = excluded.reset_at,
        expires_at = excluded.expires_at,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(key, entry.tokens, entry.lastRefill, entry.resetAt, expiresAt);
  }

  async logRequest(entry: RequestLogEntry): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const stmt = this.db.prepare(`
      INSERT INTO request_log (
        request_id, timestamp, method, path, provider, model, 
        status, latency_ms, input_tokens, output_tokens, error_class, source_ip
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      stmt.run(
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
        entry.error_class || null,
        entry.source_ip
      );
    } catch (err: any) {
      // Log duplicate request_id errors are acceptable
      if (!err.message.includes('UNIQUE constraint failed')) {
        throw err;
      }
=======
        expires_at INTEGER NOT NULL
      );
    `);
  }

  async rateLimitGet(key: string): Promise<RateLimitEntry | null> {
    if (!this.db) throw new Error('Database not initialized');
    const row = this.db.prepare(
      'SELECT key, tokens, last_refill, reset_at FROM rate_limit_state WHERE key = ? AND expires_at > ?'
    ).get(key, Date.now()) as { key: string; tokens: number; last_refill: number; reset_at: number } | undefined;
    if (!row) return null;
    return { key: row.key, tokens: row.tokens, lastRefill: row.last_refill, resetAt: row.reset_at };
  }

  async rateLimitSet(key: string, entry: RateLimitEntry, ttlMs = 3600000): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.prepare(`
      INSERT INTO rate_limit_state (key, tokens, last_refill, reset_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        tokens = excluded.tokens, last_refill = excluded.last_refill,
        reset_at = excluded.reset_at, expires_at = excluded.expires_at
    `).run(key, entry.tokens, entry.lastRefill, entry.resetAt, Date.now() + ttlMs);
  }

  async logRequest(entry: RequestLogEntry): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    try {
      this.db.prepare(`
        INSERT INTO request_log (request_id, timestamp, method, path, provider, model, status, latency_ms, input_tokens, output_tokens, error_class, source_ip)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.request_id, entry.timestamp, entry.method, entry.path,
        entry.provider, entry.model, entry.status, entry.latency_ms,
        entry.input_tokens, entry.output_tokens, entry.error_class ?? null, entry.source_ip
      );
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message.includes('UNIQUE constraint'))) throw err;
>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
    }
  }

  async queryLogs(filter: LogFilter): Promise<RequestLogEntry[]> {
<<<<<<< HEAD
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    let query = 'SELECT * FROM request_log WHERE 1=1';
    const params: any[] = [];

    if (filter.since !== undefined) {
      query += ' AND timestamp >= ?';
      params.push(filter.since);
    }
    if (filter.until !== undefined) {
      query += ' AND timestamp <= ?';
      params.push(filter.until);
    }
    if (filter.provider !== undefined) {
      query += ' AND provider = ?';
      params.push(filter.provider);
    }
    if (filter.status !== undefined) {
      query += ' AND status = ?';
      params.push(filter.status);
    }

    query += ' ORDER BY timestamp DESC';

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map((row) => ({
      request_id: row.request_id,
      timestamp: row.timestamp,
      method: row.method,
      path: row.path,
      provider: row.provider,
      model: row.model,
      status: row.status,
      latency_ms: row.latency_ms,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      error_class: row.error_class,
      source_ip: row.source_ip,
    }));
  }

  /**
   * Clean up expired rate limit entries
   */
  async cleanupExpiredEntries(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const now = Date.now();
    this.db.prepare('DELETE FROM rate_limit_state WHERE expires_at <= ?').run(now);
  }

  /**
   * Prune old request logs
   */
  async pruneOldLogs(retentionDays: number = 30): Promise<number> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const result = this.db
      .prepare('DELETE FROM request_log WHERE timestamp < ?')
      .run(cutoffTime);

    return result.changes;
=======
    if (!this.db) throw new Error('Database not initialized');
    let query = 'SELECT * FROM request_log WHERE 1=1';
    const params: unknown[] = [];
    if (filter.since !== undefined) { query += ' AND timestamp >= ?'; params.push(filter.since); }
    if (filter.until !== undefined) { query += ' AND timestamp <= ?'; params.push(filter.until); }
    if (filter.provider) { query += ' AND provider = ?'; params.push(filter.provider); }
    if (filter.status !== undefined) { query += ' AND status = ?'; params.push(filter.status); }
    query += ' ORDER BY timestamp DESC';
    return this.db.prepare(query).all(...params) as RequestLogEntry[];
>>>>>>> 549e39d (feat: MVP integration — end-to-end proxy with zero-config npx start (#10))
  }
}
