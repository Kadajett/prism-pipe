/**
 * Fallback chain (stub)
 */

import type { CanonicalRequest, CanonicalResponse } from "@core"

export interface FallbackProvider {
  name: string
  priority: number
  execute(request: CanonicalRequest): Promise<CanonicalResponse>
}

export class FallbackChain {
  private providers: FallbackProvider[] = []

  addProvider(provider: FallbackProvider): void {
    this.providers.push(provider)
    this.providers.sort((a, b) => a.priority - b.priority)
  }

  async execute(_request: CanonicalRequest): Promise<CanonicalResponse> {
    throw new Error("Not implemented")
  }
}

export function createFallbackChain(): FallbackChain {
  return new FallbackChain()
}
