import type { PipelineContext } from "../core/context.js";
import type { PipelineStep } from "../core/pipeline.js";

/** Pipeline middleware: inject system prompt into requests. */
export class InjectSystemStep implements PipelineStep {
  readonly name = "inject-system";

  async execute(_ctx: PipelineContext, _next: () => Promise<void>): Promise<void> {
    // TODO: implement system prompt injection
    throw new Error("Not implemented");
  }
}
