import type { PipelineContext } from "./context.js";

/** A single step in the processing pipeline. */
export interface PipelineStep {
  name: string;
  execute(ctx: PipelineContext, next: () => Promise<void>): Promise<void>;
}

/** Executes an ordered chain of pipeline steps (middleware pattern). */
export class PipelineEngine {
  private readonly steps: PipelineStep[] = [];

  /** Register a step at the end of the pipeline. */
  use(step: PipelineStep): this {
    this.steps.push(step);
    return this;
  }

  /** Run all steps in order with Koa-style next() chaining. */
  async execute(_ctx: PipelineContext): Promise<void> {
    // TODO: implement middleware chain execution
    throw new Error("Not implemented");
  }
}
