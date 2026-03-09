import type { CanonicalRequest, CanonicalResponse } from "../core/types.js";
import type { Provider } from "../proxy/provider.js";

/** Execute a request through a chain of fallback providers. */
export class FallbackChain {
  constructor(private readonly providers: Provider[]) {}

  async execute(_request: CanonicalRequest): Promise<CanonicalResponse> {
    // TODO: implement fallback chain — try providers in order
    throw new Error("Not implemented");
  }
}
