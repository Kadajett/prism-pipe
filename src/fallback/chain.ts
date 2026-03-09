import type { TimeoutBudget } from '../core/timeout.js';
import type { ProviderConfig, ScopedLogger } from '../core/types.js';
import { PipelineError } from '../core/types.js';
import {
  callProvider,
  callProviderStream,
  type ProviderCallResult,
  type ProviderStreamResult,
} from '../proxy/provider.js';
import type { ProviderTransformer } from '../proxy/transform-registry.js';
import type { CircuitBreakerRegistry } from './circuit-breaker.js';

export interface FallbackChainOptions {
  providers: Array<{
    config: ProviderConfig;
    transformer: ProviderTransformer;
  }>;
  body: unknown;
  stream?: boolean;
  timeout: TimeoutBudget;
  log: ScopedLogger;
  maxRetries?: number;
  baseBackoffMs?: number;
  /** Optional circuit breaker registry — tripped providers are skipped */
  circuitBreakers?: CircuitBreakerRegistry;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try providers in order. On retryable errors, retry with backoff.
 * On fatal errors (auth, invalid_request), move to next provider.
 */
export async function executeFallbackChain(
  opts: FallbackChainOptions
): Promise<ProviderCallResult | ProviderStreamResult> {
  const { providers, body, stream, timeout, log, maxRetries = 2, baseBackoffMs = 500, circuitBreakers } = opts;
  const errors: Array<{ provider: string; error: PipelineError }> = [];

  for (const { config, transformer } of providers) {
    if (!timeout.hasTime()) break;

    // Skip tripped providers
    if (circuitBreakers && !circuitBreakers.isAvailable(config.name)) {
      log.warn(`Skipping provider ${config.name} — circuit breaker is open`);
      continue;
    }

    const breaker = circuitBreakers?.get(config.name);

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (!timeout.hasTime()) break;

      try {
        let result: ProviderCallResult | ProviderStreamResult;
        if (stream) {
          result = await callProviderStream({
            providerConfig: config,
            transformer,
            body,
            timeout,
          });
        } else {
          result = await callProvider({
            providerConfig: config,
            transformer,
            body,
            timeout,
          });
        }
        breaker?.recordSuccess();
        return result;
      } catch (err) {
        const pErr =
          err instanceof PipelineError
            ? err
            : new PipelineError(String(err), 'unknown', config.name, 500, false);

        breaker?.recordFailure();
        errors.push({ provider: config.name, error: pErr });
        log.warn(`Provider ${config.name} failed (attempt ${attempt + 1})`, {
          code: pErr.code,
          retryable: pErr.retryable,
          status: pErr.statusCode,
        });

        // Fatal errors: don't retry, move to next provider
        if (!pErr.retryable) break;

        // Retryable: backoff then retry same provider
        if (attempt < maxRetries) {
          const backoff = baseBackoffMs * 2 ** attempt;
          await sleep(Math.min(backoff, timeout.remaining()));
        }
      }
    }
  }

  // All providers exhausted
  const lastError = errors[errors.length - 1]?.error;
  throw new PipelineError(
    `All providers failed. Last error: ${lastError?.message ?? 'unknown'}`,
    lastError?.code ?? 'server_error',
    'fallback_chain',
    lastError?.statusCode ?? 502,
    false
  );
}
