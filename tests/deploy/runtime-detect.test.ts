import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectRuntime, detectCapabilities } from '../../src/runtime/detect.js';

describe('Runtime Detector', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('detectRuntime', () => {
    it('returns "node" in standard Node.js environment', () => {
      expect(detectRuntime()).toBe('node');
    });

    it('returns "lambda" when AWS_LAMBDA_FUNCTION_NAME is set', () => {
      vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'my-function');
      expect(detectRuntime()).toBe('lambda');
    });
  });

  describe('detectCapabilities', () => {
    it('returns full capabilities for Node.js', () => {
      const caps = detectCapabilities();
      expect(caps.threads).toBe(true);
      expect(caps.filesystem).toBe(true);
      expect(caps.persistentProcess).toBe(true);
      expect(caps.nativeNetBinding).toBe(true);
      expect(caps.storage.sqlite).toBe(true);
    });

    it('returns limited capabilities for Lambda', () => {
      vi.stubEnv('AWS_LAMBDA_FUNCTION_NAME', 'my-function');
      const caps = detectCapabilities();
      expect(caps.threads).toBe(false);
      expect(caps.persistentProcess).toBe(false);
      expect(caps.nativeNetBinding).toBe(false);
      expect(caps.storage.dynamodb).toBe(true);
      expect(caps.storage.s3).toBe(true);
      expect(caps.storage.sqlite).toBe(false);
    });
  });
});
