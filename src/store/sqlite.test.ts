import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { StoreConfigSchema } from '../config/schema';
import type { RateLimitEntry, RequestLogEntry } from './interface';
import { SQLiteStore } from './sqlite';

describe('SQLiteStore', () => {
  let store: SQLiteStore;
  const testDbPath = join(process.cwd(), '.test-db', 'test.db');

  beforeEach(async () => {
    // Clean up any existing test database
    try {
      rmSync(join(process.cwd(), '.test-db'), { recursive: true });
    } catch {}

    store = new SQLiteStore(testDbPath);
    await store.init();
  });

  afterEach(async () => {
    await store.close();

    // Clean up test database
    try {
      rmSync(join(process.cwd(), '.test-db'), { recursive: true });
    } catch {}
  });

  describe('Default store type', () => {
    it('StoreConfigSchema defaults to sqlite', () => {
      const config = StoreConfigSchema.parse({});
      expect(config.type).toBe('sqlite');
    });
  });

  describe('Initialization', () => {
    it('should create database and tables on init', async () => {
      // Tables should exist after init (called in beforeEach)
      const result = await store.rateLimitGet('test');
      expect(result).toBeNull();
    });

    it('should run migrations successfully', async () => {
      await expect(store.migrate()).resolves.toBeUndefined();
    });
  });

  describe('Rate Limit Operations', () => {
    it('should store and retrieve rate limit entry', async () => {
      const entry: RateLimitEntry = {
        key: 'user:123',
        tokens: 100,
        lastRefill: Date.now(),
        resetAt: Date.now() + 3600000,
      };

      await store.rateLimitSet('user:123', entry);
      const retrieved = await store.rateLimitGet('user:123');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.key).toBe(entry.key);
      expect(retrieved?.tokens).toBe(entry.tokens);
    });

    it('should return null for non-existent key', async () => {
      const result = await store.rateLimitGet('non-existent');
      expect(result).toBeNull();
    });

    it('should expire entries based on TTL', async () => {
      const entry: RateLimitEntry = {
        key: 'user:456',
        tokens: 50,
        lastRefill: Date.now(),
        resetAt: Date.now() + 1000,
      };

      await store.rateLimitSet('user:456', entry, 100); // 100ms TTL

      // Should exist immediately
      let result = await store.rateLimitGet('user:456');
      expect(result).not.toBeNull();

      // Wait for expiry
      await new Promise((resolve) => setTimeout(resolve, 150));
      result = await store.rateLimitGet('user:456');
      expect(result).toBeNull();
    });

    it('should update existing entry', async () => {
      const entry1: RateLimitEntry = {
        key: 'user:789',
        tokens: 100,
        lastRefill: Date.now(),
        resetAt: Date.now() + 3600000,
      };

      await store.rateLimitSet('user:789', entry1);

      const entry2: RateLimitEntry = {
        key: 'user:789',
        tokens: 50,
        lastRefill: Date.now(),
        resetAt: Date.now() + 3600000,
      };

      await store.rateLimitSet('user:789', entry2, 3600000);

      const retrieved = await store.rateLimitGet('user:789');
      expect(retrieved?.tokens).toBe(50);
    });

    it('should cleanup expired entries', async () => {
      const entry: RateLimitEntry = {
        key: 'expired-key',
        tokens: 100,
        lastRefill: Date.now(),
        resetAt: Date.now() + 3600000,
      };

      await store.rateLimitSet('expired-key', entry, 100);
      await new Promise((resolve) => setTimeout(resolve, 150));
      await store.cleanupExpiredEntries();

      const result = await store.rateLimitGet('expired-key');
      expect(result).toBeNull();
    });
  });

  describe('Request Logging', () => {
    it('should log request entry', async () => {
      const entry: RequestLogEntry = {
        request_id: 'req:123',
        timestamp: Date.now(),
        method: 'POST',
        path: '/api/chat',
        provider: 'openai',
        model: 'gpt-4',
        status: 200,
        latency_ms: 150,
        input_tokens: 100,
        output_tokens: 200,
        source_ip: '192.168.1.1',
      };

      await store.logRequest(entry);
      const logs = await store.queryLogs({});

      expect(logs).toHaveLength(1);
      expect(logs[0].request_id).toBe(entry.request_id);
      expect(logs[0].provider).toBe('openai');
    });

    it('should enforce unique request IDs', async () => {
      const entry1: RequestLogEntry = {
        request_id: 'req:duplicate',
        timestamp: Date.now(),
        method: 'POST',
        path: '/api/chat',
        provider: 'openai',
        model: 'gpt-4',
        status: 200,
        latency_ms: 150,
        input_tokens: 100,
        output_tokens: 200,
        source_ip: '192.168.1.1',
      };

      const entry2: RequestLogEntry = {
        ...entry1,
        status: 201,
        latency_ms: 200,
      };

      await store.logRequest(entry1);
      await store.logRequest(entry2); // Should not error but not insert duplicate

      const logs = await store.queryLogs({});
      expect(logs.length).toBeLessThanOrEqual(1);
    });

    it('should query logs with provider filter', async () => {
      const entries: RequestLogEntry[] = [
        {
          request_id: 'req:1',
          timestamp: Date.now(),
          method: 'POST',
          path: '/api/chat',
          provider: 'openai',
          model: 'gpt-4',
          status: 200,
          latency_ms: 150,
          input_tokens: 100,
          output_tokens: 200,
          source_ip: '192.168.1.1',
        },
        {
          request_id: 'req:2',
          timestamp: Date.now(),
          method: 'POST',
          path: '/api/chat',
          provider: 'anthropic',
          model: 'claude-3',
          status: 200,
          latency_ms: 200,
          input_tokens: 150,
          output_tokens: 250,
          source_ip: '192.168.1.2',
        },
      ];

      for (const entry of entries) {
        await store.logRequest(entry);
      }

      const logs = await store.queryLogs({ provider: 'openai' });
      expect(logs).toHaveLength(1);
      expect(logs[0].provider).toBe('openai');
    });

    it('should query logs with status filter', async () => {
      const entries: RequestLogEntry[] = [
        {
          request_id: 'req:success',
          timestamp: Date.now(),
          method: 'POST',
          path: '/api/chat',
          provider: 'openai',
          model: 'gpt-4',
          status: 200,
          latency_ms: 150,
          input_tokens: 100,
          output_tokens: 200,
          source_ip: '192.168.1.1',
        },
        {
          request_id: 'req:error',
          timestamp: Date.now(),
          method: 'POST',
          path: '/api/chat',
          provider: 'openai',
          model: 'gpt-4',
          status: 500,
          latency_ms: 200,
          input_tokens: 100,
          output_tokens: 0,
          error_class: 'ServerError',
          source_ip: '192.168.1.1',
        },
      ];

      for (const entry of entries) {
        await store.logRequest(entry);
      }

      const logs = await store.queryLogs({ status: 500 });
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe(500);
      expect(logs[0].error_class).toBe('ServerError');
    });

    it('should query logs with time range filter', async () => {
      const now = Date.now();

      const entries: RequestLogEntry[] = [
        {
          request_id: 'req:old',
          timestamp: now - 10000,
          method: 'POST',
          path: '/api/chat',
          provider: 'openai',
          model: 'gpt-4',
          status: 200,
          latency_ms: 150,
          input_tokens: 100,
          output_tokens: 200,
          source_ip: '192.168.1.1',
        },
        {
          request_id: 'req:new',
          timestamp: now,
          method: 'POST',
          path: '/api/chat',
          provider: 'openai',
          model: 'gpt-4',
          status: 200,
          latency_ms: 150,
          input_tokens: 100,
          output_tokens: 200,
          source_ip: '192.168.1.1',
        },
      ];

      for (const entry of entries) {
        await store.logRequest(entry);
      }

      const logs = await store.queryLogs({ since: now - 5000, until: now + 5000 });
      expect(logs.length).toBeGreaterThan(0);

      const logsInPastOnly = await store.queryLogs({ since: now - 20000, until: now - 5000 });
      expect(logsInPastOnly).toHaveLength(1);
      expect(logsInPastOnly[0].request_id).toBe('req:old');
    });

    it('should prune old logs', async () => {
      const now = Date.now();

      const entry: RequestLogEntry = {
        request_id: 'req:old',
        timestamp: now - 35 * 24 * 60 * 60 * 1000, // 35 days ago
        method: 'POST',
        path: '/api/chat',
        provider: 'openai',
        model: 'gpt-4',
        status: 200,
        latency_ms: 150,
        input_tokens: 100,
        output_tokens: 200,
        source_ip: '192.168.1.1',
      };

      await store.logRequest(entry);

      const logsBeforePrune = await store.queryLogs({});
      expect(logsBeforePrune).toHaveLength(1);

      await store.pruneOldLogs(30);

      const logsAfterPrune = await store.queryLogs({});
      expect(logsAfterPrune).toHaveLength(0);
    });
  });

  describe('Closing', () => {
    it('should close database connection', async () => {
      await store.close();

      // After close, operations should fail
      await expect(store.rateLimitGet('test')).rejects.toThrow();
    });
  });
});
