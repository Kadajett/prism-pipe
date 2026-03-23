import type { MetricsEmitter } from '../core/types';
import type { Store } from '../store/interface';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures to trip the breaker. Default: 5 */
  failureThreshold?: number;
  /** How long (ms) to stay open before entering half-open. Default: 30_000 */
  resetTimeoutMs?: number;
  /** Number of test requests allowed in half-open state. Default: 1 */
  halfOpenRequests?: number;
  /** Optional metrics emitter */
  metrics?: MetricsEmitter;
  /** Optional store for state persistence */
  store?: Store;
}

/**
 * Per-provider circuit breaker with three states:
 *  - closed: normal operation
 *  - open: reject immediately (provider is down)
 *  - half-open: allow a few test requests
 */
export class CircuitBreaker {
  readonly provider: string;
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private halfOpenSuccesses = 0;
  private halfOpenAttempts = 0;
  private openedAt = 0;

  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenRequests: number;
  private readonly metrics?: MetricsEmitter;
  private readonly store?: Store;

  constructor(provider: string, opts: CircuitBreakerOptions = {}) {
    this.provider = provider;
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetTimeoutMs = opts.resetTimeoutMs ?? 30_000;
    this.halfOpenRequests = opts.halfOpenRequests ?? 1;
    this.metrics = opts.metrics;
    this.store = opts.store;
  }

  /**
   * Hydrate circuit breaker state from store.
   * Called during construction by CircuitBreakerRegistry.
   */
  async hydrate(): Promise<void> {
    if (!this.store) return;
    const record = await this.store.circuitBreakerGet(this.provider);
    if (!record) return;

    this.state = record.state;
    this.consecutiveFailures = record.consecutiveFailures;
    this.openedAt = record.openedAt ?? 0;
  }

  /** Current breaker state */
  getState(): CircuitState {
    // Check if open → half-open transition is due
    if (this.state === 'open' && Date.now() - this.openedAt >= this.resetTimeoutMs) {
      this.transitionTo('half-open');
    }
    return this.state;
  }

  /**
   * Returns true if a request is allowed through.
   * In open state, rejects immediately. In half-open, allows limited test requests.
   */
  allowRequest(): boolean {
    const current = this.getState();
    if (current === 'closed') return true;
    if (current === 'open') {
      this.metrics?.counter('prism.circuit_breaker.rejected', 1, { provider: this.provider });
      return false;
    }
    // half-open: allow up to halfOpenRequests test requests
    if (this.halfOpenAttempts < this.halfOpenRequests) {
      this.halfOpenAttempts++;
      return true;
    }
    this.metrics?.counter('prism.circuit_breaker.rejected', 1, { provider: this.provider });
    return false;
  }

  /** Record a successful request */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.halfOpenRequests) {
        this.transitionTo('closed');
      }
      return;
    }
    // In closed state, reset failure counter
    this.consecutiveFailures = 0;
  }

  /** Record a failed request */
  recordFailure(): void {
    if (this.state === 'half-open') {
      // Any failure in half-open reopens the circuit
      this.transitionTo('open');
      return;
    }
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.transitionTo('open');
    }
  }

  /** Force a state transition (for testing or manual control) */
  reset(): void {
    this.transitionTo('closed');
  }

  private transitionTo(newState: CircuitState): void {
    const old = this.state;
    if (old === newState) return;

    this.state = newState;
    this.metrics?.counter('prism.circuit_breaker.state_change', 1, {
      provider: this.provider,
      from: old,
      to: newState,
    });

    if (newState === 'open') {
      this.openedAt = Date.now();
      this.halfOpenSuccesses = 0;
      this.halfOpenAttempts = 0;
    } else if (newState === 'closed') {
      this.consecutiveFailures = 0;
      this.halfOpenSuccesses = 0;
      this.halfOpenAttempts = 0;
    } else if (newState === 'half-open') {
      this.halfOpenSuccesses = 0;
      this.halfOpenAttempts = 0;
    }

    // Persist state to store
    if (this.store) {
      void this.store.circuitBreakerSet({
        provider: this.provider,
        state: newState,
        consecutiveFailures: this.consecutiveFailures,
        openedAt: this.openedAt,
        updatedAt: Date.now(),
      });
    }
  }
}

/**
 * Registry of circuit breakers keyed by provider name.
 */
export class CircuitBreakerRegistry {
  private readonly breakers = new Map<string, CircuitBreaker>();
  private readonly defaultOpts: CircuitBreakerOptions;
  private readonly store?: Store;

  constructor(opts: CircuitBreakerOptions = {}, store?: Store) {
    this.defaultOpts = opts;
    this.store = store;
  }

  get(provider: string): CircuitBreaker {
    let cb = this.breakers.get(provider);
    if (!cb) {
      cb = new CircuitBreaker(provider, { ...this.defaultOpts, store: this.store });
      this.breakers.set(provider, cb);
    }
    return cb;
  }

  /**
   * Hydrate all circuit breaker states from store.
   * This is called by ProxyInstance after construction.
   */
  async hydrateAll(): Promise<void> {
    if (!this.store) return;
    // Hydrate all existing breakers
    const promises = [];
    for (const cb of this.breakers.values()) {
      promises.push(cb.hydrate());
    }
    await Promise.all(promises);
  }

  /** Check if a provider is available (not tripped) */
  isAvailable(provider: string): boolean {
    return this.get(provider).allowRequest();
  }

  /** Get all breakers for inspection */
  all(): ReadonlyMap<string, CircuitBreaker> {
    return this.breakers;
  }
}
