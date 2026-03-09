import { describe, expect, it } from 'vitest';
import { PrometheusExporter } from '../../../src/metrics/exporters/prometheus.js';

describe('PrometheusExporter', () => {
  it('serializes counters in Prometheus text format', () => {
    const exp = new PrometheusExporter();
    exp.export([
      { name: 'prism_requests_total', type: 'counter', value: 5, tags: { provider: 'openai' }, timestamp: Date.now() },
      { name: 'prism_requests_total', type: 'counter', value: 3, tags: { provider: 'anthropic' }, timestamp: Date.now() },
    ]);

    const output = exp.serialize();
    expect(output).toContain('# TYPE prism_requests_total counter');
    expect(output).toContain('prism_requests_total{provider="openai"} 5');
    expect(output).toContain('prism_requests_total{provider="anthropic"} 3');
  });

  it('serializes gauges', () => {
    const exp = new PrometheusExporter();
    exp.export([
      { name: 'prism_active', type: 'gauge', value: 42, tags: {}, timestamp: Date.now() },
    ]);

    const output = exp.serialize();
    expect(output).toContain('# TYPE prism_active gauge');
    expect(output).toContain('prism_active 42');
  });

  it('serializes histograms with buckets', () => {
    const exp = new PrometheusExporter();
    exp.export([
      { name: 'prism_duration_ms', type: 'histogram', value: 150, tags: {}, timestamp: Date.now() },
      { name: 'prism_duration_ms', type: 'histogram', value: 50, tags: {}, timestamp: Date.now() },
    ]);

    const output = exp.serialize();
    expect(output).toContain('# TYPE prism_duration_ms histogram');
    expect(output).toContain('prism_duration_ms_bucket{le="100"} 1');
    expect(output).toContain('prism_duration_ms_bucket{le="250"} 2');
    expect(output).toContain('prism_duration_ms_bucket{le="+Inf"} 2');
    expect(output).toContain('prism_duration_ms_sum 200');
    expect(output).toContain('prism_duration_ms_count 2');
  });

  it('accumulates counter values for same label set', () => {
    const exp = new PrometheusExporter();
    exp.export([
      { name: 'prism_tokens', type: 'counter', value: 100, tags: { model: 'gpt-4o' }, timestamp: Date.now() },
    ]);
    exp.export([
      { name: 'prism_tokens', type: 'counter', value: 200, tags: { model: 'gpt-4o' }, timestamp: Date.now() },
    ]);

    const output = exp.serialize();
    expect(output).toContain('prism_tokens{model="gpt-4o"} 300');
  });

  it('sanitizes metric names with dots', () => {
    const exp = new PrometheusExporter();
    exp.export([
      { name: 'prism.requests.total', type: 'counter', value: 1, tags: {}, timestamp: Date.now() },
    ]);

    const output = exp.serialize();
    expect(output).toContain('prism_requests_total 1');
  });
});
