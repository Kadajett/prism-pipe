import { ulid } from 'ulid';
import { appLogger } from '../logging/app-logger';
import { createTimeoutBudget, type TimeoutBudget } from './timeout';
import type {
  CanonicalRequest,
  CanonicalResponse,
  MetricsEmitter,
  ResolvedConfig,
  ScopedLogger,
} from './types';

export interface PipelineContextOptions {
  request: CanonicalRequest;
  config: ResolvedConfig;
  log?: ScopedLogger;
  metrics?: MetricsEmitter;
  timeout?: TimeoutBudget;
}

export class PipelineContext {
  readonly id: string;
  readonly original: Readonly<CanonicalRequest>;
  request: CanonicalRequest;
  response?: CanonicalResponse;
  readonly metadata: Map<string, unknown>;
  readonly timeout: TimeoutBudget;
  readonly log: ScopedLogger;
  readonly metrics: MetricsEmitter;
  readonly config: ResolvedConfig;

  constructor(opts: PipelineContextOptions) {
    this.id = ulid();
    this.original = Object.freeze(structuredClone(opts.request));
    this.request = structuredClone(opts.request);
    this.metadata = new Map();
    this.config = opts.config;
    this.timeout = opts.timeout ?? createTimeoutBudget(opts.config.requestTimeout);

    if (opts.log) {
      this.log = opts.log;
    } else {
      const child = appLogger.child({ reqId: this.id, component: 'pipeline' });
      this.log = {
        info: (msg, data) => child.info(data ?? {}, msg),
        warn: (msg, data) => child.warn(data ?? {}, msg),
        error: (msg, data) => child.error(data ?? {}, msg),
        debug: (msg, data) => child.debug(data ?? {}, msg),
      };
    }

    this.metrics = opts.metrics ?? {
      counter: () => {},
      histogram: () => {},
      gauge: () => {},
    };
  }
}
