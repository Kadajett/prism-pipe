import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import type { LogFilter, LogQuery, RateLimitEntry, RequestLogEntry, Store, UsageAggregate, CostRecord } from './interface';

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
      CREATE INDEX IF NOT EXISTS idx_request_log_model ON request_log(model);

      CREATE TABLE IF NOT EXISTS rate_limit_state (
        key TEXT PRIMARY KEY,
        tokens REAL NOT NULL,
        last_refill INTEGER NOT NULL,
        reset_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tenant_costs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        month TEXT NOT NULL,
        cost_usd REAL NOT NULL,
        provider TEXT,
        model TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tenant_costs_tenant ON tenant_costs(tenant_id, month);
    `);

    // Add new columns if they don't exist (safe migration for existing DBs)
    const columns = this.db.prepare("PRAGMA table_info(request_log)").all() as { name: string }[];
    const colNames = new Set(columns.map(c => c.name));
    const newCols: [string, string][] = [
      ['port', 'TEXT'],
      ['proxy_id', 'TEXT'],
      ['route_path', 'TEXT'],
      ['tenant_id', 'TEXT'],
      ['compose_steps', 'INTEGER'],
      ['fallback_used', 'INTEGER'],
      ['upstream_latency_ms', 'INTEGER'],
    ];
    for (const [col, type] of newCols) {
      if (!colNames.has(col)) {
        this.db.exec(`ALTER TABLE request_log ADD COLUMN ${col} ${type}`);
      }
    }
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
        INSERT INTO request_log (request_id, timestamp, method, path, provider, model, status, latency_ms, input_tokens, output_tokens, error_class, source_ip, port, proxy_id, route_path, tenant_id, compose_steps, fallback_used, upstream_latency_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          entry.source_ip,
          entry.port ?? null,
          entry.proxy_id ?? null,
          entry.route_path ?? null,
          entry.tenant_id ?? null,
          entry.compose_steps ?? null,
          entry.fallback_used != null ? (entry.fallback_used ? 1 : 0) : null,
          entry.upstream_latency_ms ?? null
        );
    } catch (err: unknown) {
      if (!(err instanceof Error && err.message.includes('UNIQUE constraint'))) throw err;
    }
  }

  private buildWhereClause(filter: LogFilter | LogQuery): { where: string; params: unknown[] } {
    let where = ' WHERE 1=1';
    const params: unknown[] = [];
    if (filter.since !== undefined) {
      where += ' AND timestamp >= ?';
      params.push(filter.since);
    }
    if (filter.until !== undefined) {
      where += ' AND timestamp <= ?';
      params.push(filter.until);
    }
    if (filter.provider) {
      where += ' AND provider = ?';
      params.push(filter.provider);
    }
    if (filter.status !== undefined) {
      where += ' AND status = ?';
      params.push(filter.status);
    }
    // LogQuery-specific fields
    const q = filter as LogQuery;
    if (q.search) {
      where += ' AND (path LIKE ? OR provider LIKE ? OR model LIKE ?)';
      const term = `%${q.search}%`;
      params.push(term, term, term);
    }
    if (q.model) {
      where += ' AND model = ?';
      params.push(q.model);
    }
    if (q.errorClass) {
      where += ' AND error_class = ?';
      params.push(q.errorClass);
    }
    return { where, params };
  }

  async queryLogs(filter: LogFilter | LogQuery): Promise<RequestLogEntry[]> {
    if (!this.db) throw new Error('Database not initialized');
    const { where, params } = this.buildWhereClause(filter);
    const q = filter as LogQuery;
    let query = `SELECT * FROM request_log${where} ORDER BY timestamp DESC`;
    if (q.limit !== undefined) {
      query += ` LIMIT ${q.limit}`;
    }
    if (q.offset !== undefined) {
      query += ` OFFSET ${q.offset}`;
    }
    const rows = this.db.prepare(query).all(...params) as (RequestLogEntry & { fallback_used?: number | null })[];
    return rows.map(r => ({
      ...r,
      fallback_used: r.fallback_used != null ? Boolean(r.fallback_used) : undefined,
    }));
  }

  async countLogs(filter: LogFilter | LogQuery): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    const { where, params } = this.buildWhereClause(filter);
    const row = this.db.prepare(`SELECT COUNT(*) as count FROM request_log${where}`).get(...params) as { count: number };
    return row.count;
  }

  async aggregateUsage(filter: LogFilter | LogQuery): Promise<UsageAggregate> {
    if (!this.db) throw new Error('Database not initialized');
    const { where, params } = this.buildWhereClause(filter);
    const row = this.db.prepare(
      `SELECT COUNT(*) as totalRequests, COALESCE(SUM(input_tokens),0) as totalInputTokens, COALESCE(SUM(output_tokens),0) as totalOutputTokens, COALESCE(SUM(latency_ms),0) as totalLatencyMs FROM request_log${where}`
    ).get(...params) as { totalRequests: number; totalInputTokens: number; totalOutputTokens: number; totalLatencyMs: number };
    return {
      ...row,
      avgLatencyMs: row.totalRequests > 0 ? row.totalLatencyMs / row.totalRequests : 0,
    };
  }

  async deleteLogs(filter: LogFilter | LogQuery): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    const { where, params } = this.buildWhereClause(filter);
    const result = this.db.prepare(`DELETE FROM request_log${where}`).run(...params);
    return result.changes;
  }

  async recordCost(record: CostRecord): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.prepare(
      `INSERT INTO tenant_costs (tenant_id, month, cost_usd, provider, model) VALUES (?, ?, ?, ?, ?)`
    ).run(record.tenantId, record.month, record.costUsd, record.provider ?? null, record.model ?? null);
  }

  async queryCosts(filter: { tenantId?: string; month?: string }): Promise<CostRecord[]> {
    if (!this.db) throw new Error('Database not initialized');
    let query = 'SELECT tenant_id, month, cost_usd, provider, model FROM tenant_costs WHERE 1=1';
    const params: unknown[] = [];
    if (filter.tenantId) {
      query += ' AND tenant_id = ?';
      params.push(filter.tenantId);
    }
    if (filter.month) {
      query += ' AND month = ?';
      params.push(filter.month);
    }
    query += ' ORDER BY month DESC';
    const rows = this.db.prepare(query).all(...params) as { tenant_id: string; month: string; cost_usd: number; provider: string | null; model: string | null }[];
    return rows.map(r => ({
      tenantId: r.tenant_id,
      month: r.month,
      costUsd: r.cost_usd,
      provider: r.provider ?? undefined,
      model: r.model ?? undefined,
    }));
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
