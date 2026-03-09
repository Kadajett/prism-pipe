/**
 * Runtime capabilities interface
 *
 * Describes what the current runtime environment supports.
 * Used by adapters to determine available features.
 */

export interface RuntimeCapabilities {
  /** Can use worker_threads for parallel processing */
  threads: boolean;
  /** Has filesystem access (fs module works) */
  filesystem: boolean;
  /** Process persists between requests (not single-invocation) */
  persistentProcess: boolean;
  /** Can bind to a network port directly */
  nativeNetBinding: boolean;
  /** Available storage backends */
  storage: {
    sqlite: boolean;
    filesystem: boolean;
    kv: boolean;      // Cloudflare KV, Deno KV, etc.
    d1: boolean;      // Cloudflare D1
    dynamodb: boolean; // AWS DynamoDB
    s3: boolean;       // AWS S3
  };
}

export type RuntimeName = 'node' | 'lambda' | 'cloudflare-workers' | 'unknown';

export interface RuntimeAdapter {
  name: RuntimeName;
  capabilities: RuntimeCapabilities;
  /** Initialize the adapter (set up storage, etc.) */
  init(): Promise<void>;
}
