import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker, CircuitBreakerRegistry } from './circuit-breaker';
import { MemoryStore } from '../store/memory';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker('test-provider', {
      failureThreshold: 3,
      resetTimeoutMs: 100,
      halfOpenRequests: 1,
    });
  });

  it('starts in closed state', () => {
    expect(cb.getState()).toBe('closed');
    expect(cb.allowRequest()).toBe(true);
  });

  it('trips after N consecutive failures', () => {
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    cb.recordFailure(); // 3rd = threshold
    expect(cb.getState()).toBe('open');
    expect(cb.allowRequest()).toBe(false);
  });

  it('resets failure count on success', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess(); // resets counter
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed'); // only 2 consecutive, not 3
  });

  it('transitions to half-open after reset timeout', async () => {
    // Trip it
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    // Wait for reset timeout
    await new Promise((r) => setTimeout(r, 120));
    expect(cb.getState()).toBe('half-open');
  });

  it('half-open allows limited test requests', async () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    await new Promise((r) => setTimeout(r, 120));

    expect(cb.getState()).toBe('half-open');
    expect(cb.allowRequest()).toBe(true); // 1 test request
    expect(cb.allowRequest()).toBe(false); // no more
  });

  it('half-open → closed on success', async () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    await new Promise((r) => setTimeout(r, 120));

    cb.allowRequest(); // consume the test slot
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
  });

  it('half-open → open on failure', async () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    await new Promise((r) => setTimeout(r, 120));

    cb.allowRequest();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });

  it('emits metrics on state changes and rejections', () => {
    const counter = vi.fn();
    const metrics = { counter, histogram: vi.fn(), gauge: vi.fn() };
    const cb2 = new CircuitBreaker('metriced', { failureThreshold: 2, metrics });

    cb2.recordFailure();
    cb2.recordFailure(); // trips
    expect(counter).toHaveBeenCalledWith('prism.circuit_breaker.state_change', 1, {
      provider: 'metriced',
      from: 'closed',
      to: 'open',
    });

    cb2.allowRequest(); // rejected
    expect(counter).toHaveBeenCalledWith('prism.circuit_breaker.rejected', 1, {
      provider: 'metriced',
    });
  });

  it('reset() restores to closed', () => {
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.allowRequest()).toBe(true);
  });
});

describe('CircuitBreakerRegistry', () => {
  it('creates and caches breakers per provider', () => {
    const reg = new CircuitBreakerRegistry({ failureThreshold: 2 });
    const a = reg.get('openai');
    const b = reg.get('openai');
    expect(a).toBe(b);
    expect(reg.get('anthropic')).not.toBe(a);
  });

  it('isAvailable reflects breaker state', () => {
    const reg = new CircuitBreakerRegistry({ failureThreshold: 2 });
    expect(reg.isAvailable('openai')).toBe(true);
    reg.get('openai').recordFailure();
    reg.get('openai').recordFailure();
    expect(reg.isAvailable('openai')).toBe(false);
  });

  it('persists circuit breaker state on transition', async () => {
    const store = new MemoryStore();
    const reg = new CircuitBreakerRegistry({ failureThreshold: 2, store });
    const cb = reg.get('openai');
    
    cb.recordFailure();
    cb.recordFailure(); // trips to open
    
    // Give the fire-and-forget persistence time to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    const persisted = await store.circuitBreakerGet('openai');
    expect(persisted).not.toBeNull();
    expect(persisted!.state).toBe('open');
    expect(persisted!.consecutiveFailures).toBe(2);
  });

  it('restores circuit breaker state from store', async () => {
    const store = new MemoryStore();
    
    // Store a persisted open state
    await store.circuitBreakerSet('provider1', {
      provider: 'provider1',
      state: 'open',
      consecutiveFailures: 2,
      openedAt: Date.now(),
    });

    // Create a new registry and get the breaker
    const reg = new CircuitBreakerRegistry({ failureThreshold: 3, store });
    const cb = reg.get('provider1');
    
    // Give the async hydration time to complete
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should be restored to open state
    expect(cb.getState()).toBe('open');
    expect(cb.allowRequest()).toBe(false);
  });
});
