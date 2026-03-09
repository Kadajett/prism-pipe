/**
 * Metrics subsystem types — pluggable exporters, namespace remapping, budget alerts.
 */

export interface MetricTags {
  [key: string]: string;
}

/** A single metric observation */
export interface MetricPoint {
  name: string;
  type: 'counter' | 'histogram' | 'gauge';
  value: number;
  tags: MetricTags;
  timestamp: number;
}

/** Exporter interface — each exporter ships metrics somewhere */
export interface MetricsExporter {
  readonly name: string;
  init?(): Promise<void>;
  export(points: MetricPoint[]): void;
  /** For pull exporters (Prometheus): return current metrics as text */
  serialize?(): string;
  close?(): Promise<void>;
}

/** Namespace remapping config */
export interface NamespaceRemap {
  [eventName: string]: string;
}

/** Metrics config in prism-pipe.yaml */
export interface MetricsConfig {
  enabled: boolean;
  namespace: string;
  exporters: ExporterConfig[];
  remap?: NamespaceRemap;
}

export interface ExporterConfig {
  type: 'prometheus' | 'otlp' | 'statsd' | 'console' | 'custom';
  /** For OTLP/StatsD push endpoints */
  endpoint?: string;
  /** Push interval in ms (OTLP/StatsD) */
  intervalMs?: number;
  /** For custom exporter: module path */
  module?: string;
}

/** Cost tracking config */
export interface CostConfig {
  enabled: boolean;
  /** Inject X-Prism-Cost-USD and X-Prism-Cost-Breakdown headers */
  headers: boolean;
  /** Flat-rate providers: cost is $0 but tokens are still tracked */
  flatRate?: string[];
}

/** Budget alert thresholds */
export interface BudgetConfig {
  enabled: boolean;
  daily?: number;
  monthly?: number;
  /** Fire alerts at these percentages (e.g. [80, 90, 100]) */
  alertAt: number[];
  /** Hard enforcement: reject at 100% */
  hardLimit: boolean;
  handlers: BudgetHandlerConfig[];
}

export interface BudgetHandlerConfig {
  type: 'webhook' | 'log' | 'custom';
  url?: string;
  module?: string;
}

/** Aggregated cost record */
export interface CostRecord {
  key: string;        // apiKey or tenant ID
  provider: string;
  model: string;
  period: string;     // "2026-03-09" or "2026-03"
  periodType: 'daily' | 'monthly';
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  requestCount: number;
}

/** Budget alert event */
export interface BudgetAlert {
  key: string;
  periodType: 'daily' | 'monthly';
  period: string;
  threshold: number;
  currentSpend: number;
  limit: number;
}
