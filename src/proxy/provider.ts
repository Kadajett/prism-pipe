import type { CanonicalRequest, CanonicalResponse } from "../core/types.js";

/** Interface that all provider adapters must implement. */
export interface Provider {
  readonly name: string;
  send(request: CanonicalRequest): Promise<CanonicalResponse>;
}

/** Registry of available providers keyed by name. */
export class ProviderRegistry {
  private readonly providers = new Map<string, Provider>();

  register(provider: Provider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): Provider | undefined {
    return this.providers.get(name);
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  list(): string[] {
    return [...this.providers.keys()];
  }
}
