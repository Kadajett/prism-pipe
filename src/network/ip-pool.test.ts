import { describe, it, expect } from 'vitest';
import { IpPool } from './ip-pool';

describe('IpPool', () => {
  describe('round-robin', () => {
    it('cycles through IPs in order', () => {
      const pool = new IpPool({
        ips: [
          { address: '10.0.0.1' },
          { address: '10.0.0.2' },
          { address: '10.0.0.3' },
        ],
        strategy: 'round-robin',
      });

      const results = [pool.selectIp(), pool.selectIp(), pool.selectIp(), pool.selectIp()];
      expect(results.map((r) => r?.address)).toEqual([
        '10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.1',
      ]);
    });
  });

  describe('weighted-round-robin', () => {
    it('distributes based on weight', () => {
      const pool = new IpPool({
        ips: [
          { address: '10.0.0.1', weight: 2 },
          { address: '10.0.0.2', weight: 1 },
        ],
        strategy: 'weighted-round-robin',
      });

      const counts: Record<string, number> = {};
      for (let i = 0; i < 6; i++) {
        const ip = pool.selectIp();
        counts[ip!.address] = (counts[ip!.address] ?? 0) + 1;
      }
      // Weight 2 should get ~2x the requests of weight 1
      expect(counts['10.0.0.1']).toBeGreaterThan(counts['10.0.0.2']!);
    });
  });

  describe('per-provider assignment', () => {
    it('returns only IPs assigned to the provider', () => {
      const pool = new IpPool({
        ips: [
          { address: '10.0.0.1', providers: ['openai'] },
          { address: '10.0.0.2', providers: ['anthropic'] },
          { address: '10.0.0.3' }, // available for all
        ],
        strategy: 'round-robin',
      });

      // openai should get .1 and .3
      const openaiIps = new Set<string>();
      for (let i = 0; i < 4; i++) {
        openaiIps.add(pool.selectIp('openai')!.address);
      }
      expect(openaiIps).toContain('10.0.0.1');
      expect(openaiIps).toContain('10.0.0.3');
      expect(openaiIps).not.toContain('10.0.0.2');
    });
  });

  describe('rate limiting', () => {
    it('deprioritizes rate-limited IPs', () => {
      const pool = new IpPool({
        ips: [
          { address: '10.0.0.1' },
          { address: '10.0.0.2' },
        ],
        strategy: 'round-robin',
      });

      pool.markRateLimited('10.0.0.1', 60_000);

      // All requests should go to .2
      const results = new Set<string>();
      for (let i = 0; i < 4; i++) {
        results.add(pool.selectIp()!.address);
      }
      expect(results).toEqual(new Set(['10.0.0.2']));
    });

    it('restores IP after rate-limit expires', async () => {
      const pool = new IpPool({
        ips: [
          { address: '10.0.0.1' },
          { address: '10.0.0.2' },
        ],
        strategy: 'round-robin',
      });

      pool.markRateLimited('10.0.0.1', 50);
      await new Promise((r) => setTimeout(r, 70));

      const results = new Set<string>();
      for (let i = 0; i < 4; i++) {
        results.add(pool.selectIp()!.address);
      }
      expect(results).toContain('10.0.0.1');
    });

    it('clearRateLimit restores IP immediately', () => {
      const pool = new IpPool({
        ips: [{ address: '10.0.0.1' }, { address: '10.0.0.2' }],
        strategy: 'round-robin',
      });

      pool.markRateLimited('10.0.0.1', 60_000);
      pool.clearRateLimit('10.0.0.1');

      const results = new Set<string>();
      for (let i = 0; i < 4; i++) results.add(pool.selectIp()!.address);
      expect(results).toContain('10.0.0.1');
    });
  });

  describe('empty pool', () => {
    it('returns undefined when no IPs configured', () => {
      const pool = new IpPool({});
      expect(pool.selectIp()).toBeUndefined();
    });
  });

  describe('proxy selection', () => {
    it('returns proxy URL for provider', () => {
      const pool = new IpPool({
        proxies: [
          { url: 'socks5://proxy1:1080' },
          { url: 'http://proxy2:8080', providers: ['openai'] },
        ],
      });

      expect(pool.selectProxy()).toBeDefined();
      // Provider-specific
      const openaiProxy = pool.selectProxy('openai');
      expect(openaiProxy).toBeDefined();
    });

    it('returns undefined when no proxies configured', () => {
      const pool = new IpPool({});
      expect(pool.selectProxy()).toBeUndefined();
    });
  });
});
