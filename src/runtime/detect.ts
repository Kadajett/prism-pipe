/**
 * Runtime detector
 *
 * Probes the current environment to determine runtime capabilities
 * and returns the appropriate adapter.
 */

import type { RuntimeCapabilities, RuntimeName } from './capabilities.js';

/**
 * Detect the current runtime environment
 */
export function detectRuntime(): RuntimeName {
  // Cloudflare Workers: no process global, or navigator.userAgent contains 'Cloudflare-Workers'
  if (typeof process === 'undefined' || typeof (globalThis as Record<string, unknown>).caches !== 'undefined') {
    // Check for Cloudflare-specific globals
    if (typeof (globalThis as Record<string, unknown>).caches !== 'undefined') {
      return 'cloudflare-workers';
    }
  }

  // AWS Lambda: has AWS_LAMBDA_FUNCTION_NAME env var
  if (typeof process !== 'undefined' && process.env?.AWS_LAMBDA_FUNCTION_NAME) {
    return 'lambda';
  }

  // Default: Node.js
  return 'node';
}

/**
 * Probe capabilities for the current runtime
 */
export function detectCapabilities(): RuntimeCapabilities {
  const runtime = detectRuntime();

  switch (runtime) {
    case 'cloudflare-workers':
      return {
        threads: false,
        filesystem: false,
        persistentProcess: false,
        nativeNetBinding: false,
        storage: {
          sqlite: false,
          filesystem: false,
          kv: true,
          d1: true,
          dynamodb: false,
          s3: false,
        },
      };

    case 'lambda':
      return {
        threads: false,  // Available but impractical for short invocations
        filesystem: true, // /tmp is writable
        persistentProcess: false,
        nativeNetBinding: false,
        storage: {
          sqlite: false,  // No persistent fs
          filesystem: false,
          kv: false,
          d1: false,
          dynamodb: true,
          s3: true,
        },
      };

    case 'node':
    default:
      return {
        threads: true,
        filesystem: true,
        persistentProcess: true,
        nativeNetBinding: true,
        storage: {
          sqlite: true,
          filesystem: true,
          kv: false,
          d1: false,
          dynamodb: false,
          s3: false,
        },
      };
  }
}
