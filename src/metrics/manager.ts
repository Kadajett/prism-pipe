/**
 * MetricsManager — central hub. Collects metric observations, applies namespace + remapping,
 * and fans out to registered exporters. When disabled, all methods are zero-cost no-ops.
 */

import type { MetricsEmitter } from '../core/types.js';
import type {
  MetricPoint,
  MetricTags,
  MetricsConfig,
  MetricsExporter,
  NamespaceRemap,
} from './types.js';

export class MetricsManager implements MetricsEmitter {
  private readonly exporters: MetricsExporter[] = [];
  private readonly buffer: MetricPoint[] = [];
  private readonly namespace: string;
  private readonly remap: NamespaceRemap;
  private readonly enabled: boolean;

  constructor(config: MetricsConfig) {
    this.enabled = config.enabled;
    this.namespace = config.namespace || 'prism';
    this.remap = config.remap ?? {};
  }

  addExporter(exporter: MetricsExporter): void {
    this.exporters.push(exporter);
  }

  /** Create a scoped MetricsEmitter for a specific request context */
  scoped(tags: MetricTags): MetricsEmitter {
    return {
      counter: (name, value = 1, extraTags) =>
        this.counter(name, value, { ...tags, ...extraTags }),
      histogram: (name, value, extraTags) =>
        this.histogram(name, value, { ...tags, ...extraTags }),
      gauge: (name, value, extraTags) =>
        this.gauge(name, value, { ...tags, ...extraTags }),
    };
  }

  counter(name: string, value = 1, tags: MetricTags = {}): void {
    if (!this.enabled) return;
    this.record({ name, type: 'counter', value, tags, timestamp: Date.now() });
  }

  histogram(name: string, value: number, tags: MetricTags = {}): void {
    if (!this.enabled) return;
    this.record({ name, type: 'histogram', value, tags, timestamp: Date.now() });
  }

  gauge(name: string, value: number, tags: MetricTags = {}): void {
    if (!this.enabled) return;
    this.record({ name, type: 'gauge', value, tags, timestamp: Date.now() });
  }

  /** Flush buffered points to all exporters */
  flush(): void {
    if (this.buffer.length === 0) return;
    const points = this.buffer.splice(0);
    for (const exporter of this.exporters) {
      exporter.export(points);
    }
  }

  /** Get serialized metrics from a pull exporter (e.g., Prometheus) */
  serialize(exporterName?: string): string {
    const exporter = exporterName
      ? this.exporters.find((e) => e.name === exporterName)
      : this.exporters.find((e) => e.serialize);
    return exporter?.serialize?.() ?? '';
  }

  async init(): Promise<void> {
    for (const exporter of this.exporters) {
      await exporter.init?.();
    }
  }

  async close(): Promise<void> {
    this.flush();
    for (const exporter of this.exporters) {
      await exporter.close?.();
    }
  }

  private record(point: MetricPoint): void {
    // Apply namespace prefix
    const prefixed = `${this.namespace}.${point.name}`;
    // Apply remapping
    const remapped = this.remap[prefixed] ?? prefixed;
    this.buffer.push({ ...point, name: remapped });

    // Auto-flush for real-time exporters
    if (this.buffer.length >= 100) {
      this.flush();
    }
  }
}
