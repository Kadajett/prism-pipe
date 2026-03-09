/**
 * Console exporter — logs metrics to stdout for development.
 */

import type { MetricPoint, MetricsExporter } from '../types.js';

export class ConsoleExporter implements MetricsExporter {
  readonly name = 'console';

  export(points: MetricPoint[]): void {
    for (const point of points) {
      const tags = Object.entries(point.tags)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      console.log(
        `[metrics] ${point.type} ${point.name}=${point.value}${tags ? ` ${tags}` : ''}`
      );
    }
  }
}
