/**
 * Provider registry
 */

import type { CanonicalRequest, CanonicalResponse } from "@core"

export interface ProviderAdapter {
  name: string
  transformRequest(req: CanonicalRequest): unknown
  transformResponse(res: unknown): CanonicalResponse
}

export class ProviderRegistry {
  private providers: Map<string, ProviderAdapter> = new Map()

  register(name: string, adapter: ProviderAdapter): void {
    this.providers.set(name, adapter)
  }

  get(name: string): ProviderAdapter {
    const adapter = this.providers.get(name)
    if (!adapter) {
      throw new Error(`Provider not found: ${name}`)
    }
    return adapter
  }

  list(): string[] {
    return Array.from(this.providers.keys())
  }
}

export function createProviderRegistry(): ProviderRegistry {
  return new ProviderRegistry()
}
