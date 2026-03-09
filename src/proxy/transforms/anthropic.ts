import type { CanonicalRequest, CanonicalResponse } from "../../core/types.js";
import type { Transform } from "../transform.js";

/** Anthropic format transformer. */
export class AnthropicTransform implements Transform {
  readonly provider = "anthropic";

  toCanonical(_raw: unknown): CanonicalRequest {
    // TODO: implement Anthropic → canonical transformation
    throw new Error("Not implemented");
  }

  fromCanonical(_response: CanonicalResponse): unknown {
    // TODO: implement canonical → Anthropic transformation
    throw new Error("Not implemented");
  }
}
