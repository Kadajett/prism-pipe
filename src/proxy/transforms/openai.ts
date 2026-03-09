import type { CanonicalRequest, CanonicalResponse } from "../../core/types.js";
import type { Transform } from "../transform.js";

/** OpenAI format transformer. */
export class OpenAITransform implements Transform {
  readonly provider = "openai";

  toCanonical(_raw: unknown): CanonicalRequest {
    // TODO: implement OpenAI → canonical transformation
    throw new Error("Not implemented");
  }

  fromCanonical(_response: CanonicalResponse): unknown {
    // TODO: implement canonical → OpenAI transformation
    throw new Error("Not implemented");
  }
}
