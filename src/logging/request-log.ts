import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { Store } from '../store/interface';
import type { RequestLogEntry } from '../store/interface';
import type { ScopedLogger } from './interface';

/**
 * Request logger configuration
 */
export interface RequestLoggerConfig {
  store: Store;
  logger?: ScopedLogger;
  jsonlOutputPath?: string; // If provided, append JSON lines to this file
  retentionDays?: number; // Default: 30
  asyncWrite?: boolean; // Default: true
}

/**
 * Request logger that writes to SQLite and optionally JSONL
 */
export class RequestLogger {
  private store: Store;
  private logger?: ScopedLogger;
  private jsonlOutputPath?: string;
  private retentionDays: number;
  private asyncWrite: boolean;
  private writeQueue: RequestLogEntry[] = [];
  private flushInterval?: NodeJS.Timeout;

  constructor(config: RequestLoggerConfig) {
    this.store = config.store;
    this.logger = config.logger;
    this.jsonlOutputPath = config.jsonlOutputPath;
    this.retentionDays = config.retentionDays || 30;
    this.asyncWrite = config.asyncWrite !== false;

    if (this.asyncWrite) {
      // Flush queue every 5 seconds or on shutdown
      this.flushInterval = setInterval(() => this.flush(), 5000);
    }
  }

  /**
   * Log a request
   */
  async logRequest(entry: RequestLogEntry): Promise<void> {
    if (this.asyncWrite) {
      this.writeQueue.push(entry);
      if (this.writeQueue.length >= 100) {
        await this.flush();
      }
    } else {
      await this.writeEntry(entry);
    }
  }

  /**
   * Flush queued entries to storage
   */
  async flush(): Promise<void> {
    if (this.writeQueue.length === 0) {
      return;
    }

    const entries = this.writeQueue.splice(0);

    try {
      for (const entry of entries) {
        await this.writeEntry(entry);
      }
    } catch (err) {
      this.logger?.error('Failed to flush request logs', { error: String(err) });
      // Re-queue failed entries? For now, just log the error
    }
  }

  /**
   * Write a single entry to storage
   */
  private async writeEntry(entry: RequestLogEntry): Promise<void> {
    await this.store.logRequest(entry);

    if (this.jsonlOutputPath) {
      this.writeJsonl(entry);
    }
  }

  /**
   * Append entry as JSON line to JSONL file
   */
  private writeJsonl(entry: RequestLogEntry): void {
    try {
      const dir = dirname(this.jsonlOutputPath!);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const jsonLine = JSON.stringify(entry) + '\n';
      appendFileSync(this.jsonlOutputPath!, jsonLine, 'utf-8');
    } catch (err) {
      this.logger?.error('Failed to write JSONL log', {
        error: String(err),
        path: this.jsonlOutputPath,
      });
    }
  }

  /**
   * Prune old logs based on retention policy
   */
  async pruneOldLogs(): Promise<void> {
    try {
      const cutoffTime = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
      // This method is specific to SQLite store
      if ('pruneOldLogs' in this.store) {
        await (this.store as any).pruneOldLogs(this.retentionDays);
      }
    } catch (err) {
      this.logger?.error('Failed to prune old logs', { error: String(err) });
    }
  }

  /**
   * Cleanup: flush and stop interval
   */
  async close(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    await this.flush();
  }
}
