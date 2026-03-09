/**
 * OTLP push exporter — sends metrics to an OpenTelemetry Collector via HTTP/JSON.
 * Zero external deps: uses native fetch.
 */

import type { MetricPoint, MetricsExporter } from '../types.js';

export interface OTLPOptions {
  endpoint: string;
  headers?: Record<string, string>;
  intervalMs?: number;
}

export class OTLPExporter implements MetricsExporter {
  readonly name = 'otlp';
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;
  private buffer: MetricPoint[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;

  constructor(opts: OTLPOptions) {
    this.endpoint = opts.endpoint;
    this.headers = opts.headers ?? {};
    this.intervalMs = opts.intervalMs ?? 10_000;
  }

  async init(): Promise<void> {
    this.timer = setInterval(() => this.push(), this.intervalMs);
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref();
    }
  }

  export(points: MetricPoint[]): void {
    this.buffer.push(...points);
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.push();
  }

  private async push(): Promise<void> {
    if (this.buffer.length === 0) return;
    const points = this.buffer.splice(0);

    const resourceMetrics = {
      resource: { attributes: [] },
      scopeMetrics: [
        {
          scope: { name: 'prism-pipe' },
          metrics: points.map((p) => toOTLPMetric(p)),
        },
      ],
    };

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.headers },
        body: JSON.stringify({ resourceMetrics: [resourceMetrics] }),
      });
    } catch {
      // Silently drop on failure — metrics should not break the proxy
    }
  }
}

function toOTLPMetric(point: MetricPoint) {
  const attributes = Object.entries(point.tags).map(([key, value]) => ({
    key,
    value: { stringValue: value },
  }));

  const dataPoint = {
    attributes,
    timeUnixNano: String(point.timestamp * 1_000_000),
    asDouble: point.value,
  };

  switch (point.type) {
    case 'counter':
      return {
        name: point.name,
        sum: {
          dataPoints: [{ ...dataPoint, startTimeUnixNano: dataPoint.timeUnixNano }],
          isMonotonic: true,
          aggregationTemporality: 2, // CUMULATIVE
        },
      };
    case 'gauge':
      return { name: point.name, gauge: { dataPoints: [dataPoint] } };
    case 'histogram':
      return { name: point.name, gauge: { dataPoints: [dataPoint] } }; // Simplified
    default:
      return { name: point.name, gauge: { dataPoints: [dataPoint] } };
  }
}
