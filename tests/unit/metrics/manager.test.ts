import { describe, expect, it, vi } from 'vitest';
import { MetricsManager } from '../../../src/metrics/manager.js';
import type { MetricPoint, MetricsExporter } from '../../../src/metrics/types.js';

function mockExporter(name = 'test'): MetricsExporter & { points: MetricPoint[] } {
  const points: MetricPoint[] = [];
  return {
    name,
    points,
    export(p: MetricPoint[]) {
      points.push(...p);
    },
  };
}

describe('MetricsManager', () => {
  it('does nothing when disabled', () => {
    const mgr = new MetricsManager({ enabled: false, namespace: 'prism', exporters: [] });
    const exp = mockExporter();
    mgr.addExporter(exp);
    mgr.counter('test', 1);
    mgr.flush();
    expect(exp.points).toHaveLength(0);
  });

  it('collects and flushes metrics to exporters', () => {
    const mgr = new MetricsManager({ enabled: true, namespace: 'prism', exporters: [] });
    const exp = mockExporter();
    mgr.addExporter(exp);

    mgr.counter('requests_total', 1, { provider: 'openai' });
    mgr.histogram('request_duration_ms', 150, { provider: 'openai' });
    mgr.gauge('active_connections', 5);
    mgr.flush();

    expect(exp.points).toHaveLength(3);
    expect(exp.points[0].name).toBe('prism.requests_total');
    expect(exp.points[0].type).toBe('counter');
    expect(exp.points[1].name).toBe('prism.request_duration_ms');
    expect(exp.points[2].value).toBe(5);
  });

  it('applies namespace remapping', () => {
    const mgr = new MetricsManager({
      enabled: true,
      namespace: 'prism',
      exporters: [],
      remap: { 'prism.requests_total': 'myapp.ai.req' },
    });
    const exp = mockExporter();
    mgr.addExporter(exp);

    mgr.counter('requests_total', 1);
    mgr.flush();

    expect(exp.points[0].name).toBe('myapp.ai.req');
  });

  it('scoped emitter merges tags', () => {
    const mgr = new MetricsManager({ enabled: true, namespace: 'prism', exporters: [] });
    const exp = mockExporter();
    mgr.addExporter(exp);

    const scoped = mgr.scoped({ provider: 'anthropic', reqId: '123' });
    scoped.counter('requests_total', 1, { model: 'claude-3' });
    mgr.flush();

    expect(exp.points[0].tags).toEqual({
      provider: 'anthropic',
      reqId: '123',
      model: 'claude-3',
    });
  });
});
