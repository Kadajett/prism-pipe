import type { CanonicalRequest, CanonicalResponse } from "../core/types.js";

/** Transforms between provider-specific and canonical formats. */
export interface Transform {
  readonly provider: string;
  toCanonical(raw: unknown): CanonicalRequest;
  fromCanonical(response: CanonicalResponse): unknown;
}

/** Registry of format transformers keyed by provider name. */
export class TransformRegistry {
  private readonly transforms = new Map<string, Transform>();

  register(transform: Transform): void {
    this.transforms.set(transform.provider, transform);
  }

  get(provider: string): Transform | undefined {
    return this.transforms.get(provider);
  }
}
