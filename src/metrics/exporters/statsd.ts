/**
 * StatsD push exporter — sends metrics via UDP to a StatsD-compatible server.
 * Lightweight: uses Node dgram, no external deps.
 */

import { createSocket, type Socket } from 'node:dgram';
import type { MetricPoint, MetricsExporter } from '../types.js';

export interface StatsDOptions {
  host: string;
  port: number;
}

export class StatsDExporter implements MetricsExporter {
  readonly name = 'statsd';
  private socket: Socket | null = null;
  private readonly host: string;
  private readonly port: number;

  constructor(opts: StatsDOptions) {
    this.host = opts.host;
    this.port = opts.port;
  }

  async init(): Promise<void> {
    this.socket = createSocket('udp4');
    this.socket.unref(); // Don't keep process alive
  }

  export(points: MetricPoint[]): void {
    if (!this.socket) return;
    const lines: string[] = [];

    for (const point of points) {
      const name = point.name.replace(/[^a-zA-Z0-9_.]/g, '_');
      const tags = Object.entries(point.tags)
        .map(([k, v]) => `${k}:${v}`)
        .join(',');
      const tagSuffix = tags ? `|#${tags}` : '';

      switch (point.type) {
        case 'counter':
          lines.push(`${name}:${point.value}|c${tagSuffix}`);
          break;
        case 'histogram':
          lines.push(`${name}:${point.value}|ms${tagSuffix}`);
          break;
        case 'gauge':
          lines.push(`${name}:${point.value}|g${tagSuffix}`);
          break;
      }
    }

    if (lines.length > 0) {
      const payload = Buffer.from(lines.join('\n'));
      this.socket.send(payload, this.port, this.host);
    }
  }

  async close(): Promise<void> {
    this.socket?.close();
    this.socket = null;
  }
}
