import type { PipelineContext } from "../core/context.js";
import type { PipelineStep } from "../core/pipeline.js";

/** Pipeline middleware: log requests to the store. */
export class LogRequestStep implements PipelineStep {
  readonly name = "log-request";

  async execute(_ctx: PipelineContext, _next: () => Promise<void>): Promise<void> {
    // TODO: implement request logging middleware
    throw new Error("Not implemented");
  }
}
