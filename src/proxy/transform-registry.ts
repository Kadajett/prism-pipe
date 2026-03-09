import type {
	CanonicalRequest,
	CanonicalResponse,
	CanonicalStreamChunk,
	ProviderCapabilities,
} from '../core/types.js';

export interface ProviderTransformer {
	readonly provider: string;
	readonly capabilities: ProviderCapabilities;
	toCanonical(raw: unknown): CanonicalRequest;
	fromCanonical(req: CanonicalRequest): unknown;
	responseToCanonical(raw: unknown): CanonicalResponse;
	responseFromCanonical(res: CanonicalResponse): unknown;
	streamChunkToCanonical(chunk: unknown): CanonicalStreamChunk | null;
	streamChunkFromCanonical(chunk: CanonicalStreamChunk): unknown;
}

export class TransformRegistry {
	private readonly transformers = new Map<string, ProviderTransformer>();

	register(transformer: ProviderTransformer): void {
		this.transformers.set(transformer.provider, transformer);
	}

	get(provider: string): ProviderTransformer {
		const t = this.transformers.get(provider);
		if (!t) throw new Error(`No transformer registered for provider: ${provider}`);
		return t;
	}

	has(provider: string): boolean {
		return this.transformers.has(provider);
	}

	providers(): string[] {
		return [...this.transformers.keys()];
	}
}
