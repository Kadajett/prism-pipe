/**
 * Prometheus pull exporter — accumulates metrics in memory,
 * serves them as Prometheus text exposition format on /metrics.
 */

import type { MetricPoint, MetricsExporter } from '../types.js';

interface MetricBucket {
  type: 'counter' | 'gauge' | 'histogram';
  values: Map<string, { value: number; count: number; sum: number; buckets: Map<number, number> }>;
}

const DEFAULT_HISTOGRAM_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

export class PrometheusExporter implements MetricsExporter {
  readonly name = 'prometheus';
  private readonly metrics = new Map<string, MetricBucket>();

  export(points: MetricPoint[]): void {
    for (const point of points) {
      const sanitized = sanitizeName(point.name);
      let bucket = this.metrics.get(sanitized);
      if (!bucket) {
        bucket = { type: point.type, values: new Map() };
        this.metrics.set(sanitized, bucket);
      }

      const labelKey = serializeLabels(point.tags);
      const existing = bucket.values.get(labelKey) ?? {
        value: 0,
        count: 0,
        sum: 0,
        buckets: new Map<number, number>(),
      };

      switch (point.type) {
        case 'counter':
          existing.value += point.value;
          break;
        case 'gauge':
          existing.value = point.value;
          break;
        case 'histogram':
          existing.count += 1;
          existing.sum += point.value;
          for (const b of DEFAULT_HISTOGRAM_BUCKETS) {
            existing.buckets.set(b, (existing.buckets.get(b) ?? 0) + (point.value <= b ? 1 : 0));
          }
          existing.buckets.set(Number.POSITIVE_INFINITY, (existing.buckets.get(Number.POSITIVE_INFINITY) ?? 0) + 1);
          break;
      }

      bucket.values.set(labelKey, existing);
    }
  }

  serialize(): string {
    const lines: string[] = [];

    for (const [name, bucket] of this.metrics) {
      const promType = bucket.type === 'histogram' ? 'histogram' : bucket.type;
      lines.push(`# TYPE ${name} ${promType}`);

      for (const [labelKey, data] of bucket.values) {
        const labels = labelKey ? `{${labelKey}}` : '';

        if (bucket.type === 'histogram') {
          for (const b of DEFAULT_HISTOGRAM_BUCKETS) {
            const le = `le="${b}"`;
            const hLabels = labelKey ? `{${labelKey},${le}}` : `{${le}}`;
            lines.push(`${name}_bucket${hLabels} ${data.buckets.get(b) ?? 0}`);
          }
          const leInf = `le="+Inf"`;
          const infLabels = labelKey ? `{${labelKey},${leInf}}` : `{${leInf}}`;
          lines.push(`${name}_bucket${infLabels} ${data.buckets.get(Number.POSITIVE_INFINITY) ?? 0}`);
          lines.push(`${name}_sum${labels} ${data.sum}`);
          lines.push(`${name}_count${labels} ${data.count}`);
        } else {
          lines.push(`${name}${labels} ${data.value}`);
        }
      }
    }

    return lines.join('\n') + '\n';
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_:]/g, '_');
}

function serializeLabels(tags: Record<string, string>): string {
  const entries = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return '';
  return entries.map(([k, v]) => `${sanitizeName(k)}="${escapeLabel(v)}"`).join(',');
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
