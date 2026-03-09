import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStore } from './memory';
import type { RateLimitEntry, RequestLogEntry } from './interface';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.init();
  });

  afterEach(async () => {
    await store.close();
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

      expect(retrieved).toEqual(entry);
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

      await store.rateLimitSet('user:789', entry2);

      const retrieved = await store.rateLimitGet('user:789');
      expect(retrieved?.tokens).toBe(50);
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
      expect(logs[0]).toEqual(entry);
    });

    it('should query logs with filters', async () => {
      const now = Date.now();

      const entries: RequestLogEntry[] = [
        {
          request_id: 'req:1',
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
          request_id: 'req:2',
          timestamp: now,
          method: 'POST',
          path: '/api/chat',
          provider: 'anthropic',
          model: 'claude-3',
          status: 500,
          latency_ms: 200,
          input_tokens: 150,
          output_tokens: 0,
          error_class: 'InternalError',
          source_ip: '192.168.1.2',
        },
      ];

      for (const entry of entries) {
        await store.logRequest(entry);
      }

      // Filter by provider
      let logs = await store.queryLogs({ provider: 'openai' });
      expect(logs).toHaveLength(1);
      expect(logs[0].provider).toBe('openai');

      // Filter by status
      logs = await store.queryLogs({ status: 500 });
      expect(logs).toHaveLength(1);
      expect(logs[0].status).toBe(500);

      // Filter by time range
      logs = await store.queryLogs({ since: now - 5000, until: now + 5000 });
      expect(logs.length).toBeGreaterThan(0);
    });

    it('should handle duplicate request IDs', async () => {
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

      // Both should be stored (memory store doesn't enforce uniqueness)
      await store.logRequest(entry1);
      await store.logRequest(entry2);

      const logs = await store.queryLogs({});
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Migration', () => {
    it('should complete migration without error', async () => {
      await expect(store.migrate()).resolves.toBeUndefined();
    });
  });
});
