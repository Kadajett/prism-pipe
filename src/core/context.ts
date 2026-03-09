import { ulid } from 'ulid';
import type {
	CanonicalRequest,
	CanonicalResponse,
	MetricsEmitter,
	ResolvedConfig,
	ScopedLogger,
} from './types.js';
import { type TimeoutBudget, createTimeoutBudget } from './timeout.js';

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

		this.log = opts.log ?? {
			info: (msg, data) => console.log(JSON.stringify({ level: 'info', reqId: this.id, msg, ...data })),
			warn: (msg, data) => console.warn(JSON.stringify({ level: 'warn', reqId: this.id, msg, ...data })),
			error: (msg, data) => console.error(JSON.stringify({ level: 'error', reqId: this.id, msg, ...data })),
			debug: (msg, data) => console.debug(JSON.stringify({ level: 'debug', reqId: this.id, msg, ...data })),
		};

		this.metrics = opts.metrics ?? {
			counter: () => {},
			histogram: () => {},
			gauge: () => {},
		};
	}
}
