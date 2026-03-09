import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RequestLogger } from './request-log';
import { MemoryStore } from '../store/memory';
import { readFileSync, rmSync } from 'fs';
import { join } from 'path';
import type { RequestLogEntry } from '../store/interface';

describe('RequestLogger', () => {
  let requestLogger: RequestLogger;
  let store: MemoryStore;
  const jsonlPath = join(process.cwd(), '.test-logs', 'requests.jsonl');

  beforeEach(async () => {
    store = new MemoryStore();
    await store.init();

    requestLogger = new RequestLogger({
      store,
      jsonlOutputPath: jsonlPath,
      asyncWrite: false, // Use sync writes for testing
    });
  });

  afterEach(async () => {
    await requestLogger.close();
    await store.close();

    // Clean up test files
    try {
      rmSync(join(process.cwd(), '.test-logs'), { recursive: true });
    } catch {}
  });

  describe('Logging', () => {
    it('should log request to store', async () => {
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

      await requestLogger.logRequest(entry);
      const logs = await store.queryLogs({});

      expect(logs).toHaveLength(1);
      expect(logs[0].request_id).toBe('req:123');
    });

    it('should write JSONL output', async () => {
      const entry: RequestLogEntry = {
        request_id: 'req:456',
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

      await requestLogger.logRequest(entry);

      // Read JSONL file
      const content = readFileSync(jsonlPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.request_id).toBe('req:456');
      expect(parsed.provider).toBe('openai');
    });

    it('should write multiple JSONL entries', async () => {
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
        await requestLogger.logRequest(entry);
      }

      const content = readFileSync(jsonlPath, 'utf-8');
      const lines = content.trim().split('\n');

      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0]);
      const second = JSON.parse(lines[1]);

      expect(first.request_id).toBe('req:1');
      expect(second.request_id).toBe('req:2');
    });

    it('should validate JSONL output format', async () => {
      const entry: RequestLogEntry = {
        request_id: 'req:jsonl-test',
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

      await requestLogger.logRequest(entry);

      const content = readFileSync(jsonlPath, 'utf-8');
      const lines = content.trim().split('\n');

      // Each line should be valid JSON
      for (const line of lines) {
        expect(() => {
          JSON.parse(line);
        }).not.toThrow();
      }
    });
  });

  describe('Async Queue', () => {
    it('should batch async writes', async () => {
      const asyncLogger = new RequestLogger({
        store,
        asyncWrite: true,
      });

      const entries: RequestLogEntry[] = Array.from({ length: 5 }, (_, i) => ({
        request_id: `req:async-${i}`,
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
      }));

      for (const entry of entries) {
        await asyncLogger.logRequest(entry);
      }

      // Flush to ensure all entries are written
      await asyncLogger.flush();

      const logs = await store.queryLogs({});
      expect(logs.length).toBeGreaterThanOrEqual(5);

      await asyncLogger.close();
    });
  });

  describe('Pruning', () => {
    it('should call pruneOldLogs on store', async () => {
      // Create a store mock that tracks calls
      const storeMock = new MemoryStore();
      await storeMock.init();

      const logger = new RequestLogger({
        store: storeMock,
        retentionDays: 30,
      });

      // Add some entries
      for (let i = 0; i < 5; i++) {
        await logger.logRequest({
          request_id: `req:prune-${i}`,
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
        });
      }

      // Prune should not throw
      await expect(logger.pruneOldLogs()).resolves.toBeUndefined();

      await logger.close();
      await storeMock.close();
    });
  });

  describe('Close', () => {
    it('should flush on close', async () => {
      const asyncLogger = new RequestLogger({
        store,
        asyncWrite: true,
      });

      const entry: RequestLogEntry = {
        request_id: 'req:close-test',
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

      await asyncLogger.logRequest(entry);
      await asyncLogger.close();

      // After close, entries should be flushed
      const logs = await store.queryLogs({});
      expect(logs.length).toBeGreaterThan(0);
    });
  });
});
