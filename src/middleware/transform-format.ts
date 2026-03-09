import type { PipelineContext } from "../core/context.js";
import type { PipelineStep } from "../core/pipeline.js";

/** Pipeline middleware: transform request/response between provider formats. */
export class TransformFormatStep implements PipelineStep {
  readonly name = "transform-format";

  async execute(_ctx: PipelineContext, _next: () => Promise<void>): Promise<void> {
    // TODO: implement format transformation
    throw new Error("Not implemented");
  }
}
